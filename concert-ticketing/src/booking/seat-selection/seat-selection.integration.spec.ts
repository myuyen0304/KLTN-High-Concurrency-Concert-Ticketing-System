import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisModule } from '../../redis/redis.module';
import { RedisService } from '../../redis/redis.service';
import { RedisSeatLockAdapter } from '../seat-lock/adapters/redis-seat-lock.adapter';
import { LockSeatUseCase } from '../seat-lock/application/lock-seat.use-case';
import { SeatLockModule } from '../seat-lock/seat-lock.module';
import { SeatMapQueryService } from './seat-map-query.service';
import { SeatSelectionModule } from './seat-selection.module';

describe('SeatSelection integration (UC08)', () => {
  let moduleRef: TestingModule;
  let query: SeatMapQueryService;
  let lockUseCase: LockSeatUseCase;
  let prisma: PrismaService;
  let redis: RedisService;

  let eventId: string;
  let organizerUserId: string;
  let holderUserId: string;
  let buyerUserId: string;

  let soldSeatId: string;
  let liveHeldSeatId: string;
  let staleHeldSeatId: string;
  let availableSeatId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
        SeatLockModule,
        SeatSelectionModule,
      ],
    }).compile();

    query = moduleRef.get(SeatMapQueryService);
    lockUseCase = moduleRef.get(LockSeatUseCase);
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);

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
        title: 'UC08 Test Event',
        startTime: new Date(Date.now() + 24 * 3600 * 1000),
        endTime: new Date(Date.now() + 25 * 3600 * 1000),
      },
    });
    eventId = event.id;

    const holder = await prisma.user.create({
      data: {
        email: `holder-${randomUUID()}@test.local`,
        passwordHash: 'x',
        fullName: 'Holder',
      },
    });
    holderUserId = holder.id;
    const buyer = await prisma.user.create({
      data: {
        email: `buyer-${randomUUID()}@test.local`,
        passwordHash: 'x',
        fullName: 'Buyer',
      },
    });
    buyerUserId = buyer.id;

    const [sold, live, stale, avail] = await Promise.all([
      prisma.seat.create({ data: { eventId, label: 'SOLD', status: 'SOLD' } }),
      prisma.seat.create({ data: { eventId, label: 'LIVE' } }),
      prisma.seat.create({ data: { eventId, label: 'STALE' } }),
      prisma.seat.create({ data: { eventId, label: 'AVAIL' } }),
    ]);
    soldSeatId = sold.id;
    liveHeldSeatId = live.id;
    staleHeldSeatId = stale.id;
    availableSeatId = avail.id;
  });

  afterAll(async () => {
    await prisma.seatLock.deleteMany({ where: { seat: { eventId } } });
    await prisma.seat.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.organizerProfile.deleteMany({
      where: { userId: organizerUserId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [organizerUserId, holderUserId, buyerUserId] } },
    });
    await flushSeatLockKeys(redis, eventId);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await flushSeatLockKeys(redis, eventId);
  });

  it('merge: SOLD (DB) + live HELD (Redis) + stale held member + AVAILABLE → correct statuses', async () => {
    const client = redis['client'] as {
      sadd: (k: string, m: string) => Promise<number>;
    };
    // live held: both the set member AND a living lock key exist
    await client.sadd(
      RedisSeatLockAdapter.eventSetKey(eventId),
      liveHeldSeatId,
    );
    await redis.set(
      RedisSeatLockAdapter.lockKey(eventId, liveHeldSeatId),
      holderUserId,
      900,
    );
    // stale held: set member ONLY, lock key already gone (drift) → must be AVAILABLE
    await client.sadd(
      RedisSeatLockAdapter.eventSetKey(eventId),
      staleHeldSeatId,
    );

    const map = await query.getSeatMap(eventId);
    const byId = new Map(map.map((s) => [s.seatId, s.status]));

    expect(byId.get(soldSeatId)).toBe('SOLD');
    expect(byId.get(liveHeldSeatId)).toBe('HELD');
    expect(byId.get(staleHeldSeatId)).toBe('AVAILABLE');
    expect(byId.get(availableSeatId)).toBe('AVAILABLE');
  });

  it('click → lock (UC09) → seat shows HELD on next query', async () => {
    const before = await query.getSeatMap(eventId);
    expect(before.find((s) => s.seatId === availableSeatId)?.status).toBe(
      'AVAILABLE',
    );

    const result = await lockUseCase.execute({
      userId: buyerUserId,
      eventId,
      seatId: availableSeatId,
    });
    expect(result.seatId).toBe(availableSeatId);

    const after = await query.getSeatMap(eventId);
    expect(after.find((s) => s.seatId === availableSeatId)?.status).toBe(
      'HELD',
    );
  });

  it('unknown event → 404', async () => {
    await expect(query.getSeatMap(randomUUID())).rejects.toThrow(
      'Sự kiện không tồn tại',
    );
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
