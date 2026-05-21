import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisModule } from '../../redis/redis.module';
import { RedisService } from '../../redis/redis.service';
import { RedisSeatLockAdapter } from './adapters/redis-seat-lock.adapter';
import { LockSeatUseCase } from './application/lock-seat.use-case';
import { ReleaseSeatUseCase } from './application/release-seat.use-case';
import {
  SeatTakenError,
  TicketLimitReachedError,
} from './domain/seat-lock.errors';
import { SeatLockModule } from './seat-lock.module';

const MAX_PER_USER = 4;

describe('SeatLock integration (UC09)', () => {
  let moduleRef: TestingModule;
  let lockUseCase: LockSeatUseCase;
  let releaseUseCase: ReleaseSeatUseCase;
  let prisma: PrismaService;
  let redis: RedisService;

  let eventId: string;
  let organizerUserId: string;
  let primaryUserId: string;
  let extraUserIds: string[] = [];
  let seatIds: string[] = [];

  beforeAll(async () => {
    process.env.MAX_SEATS_PER_USER = String(MAX_PER_USER);
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
        SeatLockModule,
      ],
    }).compile();

    lockUseCase = moduleRef.get(LockSeatUseCase);
    releaseUseCase = moduleRef.get(ReleaseSeatUseCase);
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);

    // Organizer + event setup
    const organizer = await prisma.user.create({
      data: {
        email: `org-${randomUUID()}@test.local`,
        passwordHash: 'x',
        fullName: 'Org Owner',
      },
    });
    organizerUserId = organizer.id;
    const orgProfile = await prisma.organizerProfile.create({
      data: { userId: organizer.id, orgName: 'Test Org' },
    });
    const event = await prisma.event.create({
      data: {
        organizerId: orgProfile.id,
        title: 'Integration Test Event',
        startTime: new Date(Date.now() + 24 * 3600 * 1000),
        endTime: new Date(Date.now() + 25 * 3600 * 1000),
      },
    });
    eventId = event.id;

    // Primary user (used in limit/idempotent/release tests)
    const primary = await prisma.user.create({
      data: {
        email: `primary-${randomUUID()}@test.local`,
        passwordHash: 'x',
        fullName: 'Primary',
      },
    });
    primaryUserId = primary.id;

    // 100 contender users for double-booking test
    const contenders = Array.from({ length: 100 }).map((_, i) => ({
      email: `contender-${i}-${randomUUID()}@test.local`,
      passwordHash: 'x',
      fullName: `C${i}`,
    }));
    await prisma.user.createMany({ data: contenders });
    const contenderRows = await prisma.user.findMany({
      where: { email: { in: contenders.map((c) => c.email) } },
      select: { id: true },
    });
    extraUserIds = contenderRows.map((r) => r.id);

    // Seats: 1 contested + (MAX+2) for per-user limit + 1 for release = MAX+4
    const seatCount = MAX_PER_USER + 4;
    const seats = await Promise.all(
      Array.from({ length: seatCount }).map((_, i) =>
        prisma.seat.create({
          data: { eventId, label: `S${i}` },
        }),
      ),
    );
    seatIds = seats.map((s) => s.id);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.seatLock.deleteMany({ where: { seat: { eventId } } });
    await prisma.seat.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.organizerProfile.deleteMany({
      where: { userId: organizerUserId },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [organizerUserId, primaryUserId, ...extraUserIds] },
      },
    });
    await flushSeatLockKeys(redis, eventId);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await prisma.seatLock.deleteMany({ where: { seat: { eventId } } });
    await flushSeatLockKeys(redis, eventId);
  });

  it('double-booking: 100 users compete for the same seat → exactly 1 wins', async () => {
    const seatId = seatIds[0];
    const settled = await Promise.allSettled(
      extraUserIds.map((userId) =>
        lockUseCase.execute({ userId, eventId, seatId }),
      ),
    );
    const successes = settled.filter((r) => r.status === 'fulfilled');
    const seatTakenErrors = settled.filter(
      (r) =>
        r.status === 'rejected' &&
        (r as PromiseRejectedResult).reason instanceof SeatTakenError,
    );
    expect(successes).toHaveLength(1);
    expect(seatTakenErrors).toHaveLength(99);

    const owner = await redis.get(
      RedisSeatLockAdapter.lockKey(eventId, seatId),
    );
    expect(owner).not.toBeNull();
    const winnerUserId = (
      successes[0] as PromiseFulfilledResult<{ seatId: string }>
    ).value;
    expect(extraUserIds).toContain(owner);
    expect(winnerUserId.seatId).toBe(seatId);
  });

  it('per-user limit: MAX OK, (MAX+1) → TICKET_LIMIT_REACHED', async () => {
    const userId = primaryUserId;
    const limitSeats = seatIds.slice(1, 1 + MAX_PER_USER + 1);
    for (let i = 0; i < MAX_PER_USER; i++) {
      await expect(
        lockUseCase.execute({ userId, eventId, seatId: limitSeats[i] }),
      ).resolves.toMatchObject({ seatId: limitSeats[i] });
    }
    await expect(
      lockUseCase.execute({
        userId,
        eventId,
        seatId: limitSeats[MAX_PER_USER],
      }),
    ).rejects.toBeInstanceOf(TicketLimitReachedError);

    const card = await redis['client'].scard(
      RedisSeatLockAdapter.userSetKey(eventId, userId),
    );
    expect(card).toBe(MAX_PER_USER);
  });

  it('idempotent re-hold: same user locks the same seat twice → success, no double count', async () => {
    const userId = primaryUserId;
    const seatId = seatIds[1];
    await lockUseCase.execute({ userId, eventId, seatId });
    const cardBefore = await redis['client'].scard(
      RedisSeatLockAdapter.userSetKey(eventId, userId),
    );
    await expect(
      lockUseCase.execute({ userId, eventId, seatId }),
    ).resolves.toMatchObject({ seatId });
    const cardAfter = await redis['client'].scard(
      RedisSeatLockAdapter.userSetKey(eventId, userId),
    );
    expect(cardAfter).toBe(cardBefore);

    const active = await prisma.seatLock.count({
      where: { seatId, userId, status: 'ACTIVE' },
    });
    expect(active).toBe(1);
  });

  it('release: after release seat can be locked again and user-set decrements', async () => {
    const userId = primaryUserId;
    const seatId = seatIds[2];
    await lockUseCase.execute({ userId, eventId, seatId });
    const cardBefore = await redis['client'].scard(
      RedisSeatLockAdapter.userSetKey(eventId, userId),
    );

    await releaseUseCase.execute({ userId, eventId, seatId });

    const owner = await redis.get(
      RedisSeatLockAdapter.lockKey(eventId, seatId),
    );
    expect(owner).toBeNull();
    const cardAfter = await redis['client'].scard(
      RedisSeatLockAdapter.userSetKey(eventId, userId),
    );
    expect(cardAfter).toBe(cardBefore - 1);

    // Another user can lock now
    const other = extraUserIds[0];
    await expect(
      lockUseCase.execute({ userId: other, eventId, seatId }),
    ).resolves.toMatchObject({ seatId });
  });
});

async function flushSeatLockKeys(
  redis: RedisService,
  eventId: string,
): Promise<void> {
  const client = redis['client'] as {
    keys: (p: string) => Promise<string[]>;
    del: (...k: string[]) => Promise<number>;
  };
  const patterns = [
    `lock:event:${eventId}:*`,
    `held:event:${eventId}`,
    `held:event:${eventId}:*`,
  ];
  for (const p of patterns) {
    const ks = await client.keys(p);
    if (ks.length) await client.del(...ks);
  }
}
