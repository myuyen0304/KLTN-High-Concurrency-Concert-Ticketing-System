import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { RedisQueueStoreAdapter } from './adapters/redis-queue-store.adapter';
import { AdmissionUseCase } from './application/admission.use-case';
import { JoinQueueUseCase } from './application/join-queue.use-case';
import { QueueModule } from './queue.module';

describe('Queue integration (UC07)', () => {
  let moduleRef: TestingModule;
  let joinUseCase: JoinQueueUseCase;
  let admission: AdmissionUseCase;
  let prisma: PrismaService;
  let redis: RedisService;

  let organizerUserId: string;
  let fifoEventId: string; // maxConcurrent 100 — FIFO + idempotent
  let capEventId: string; // maxConcurrent 10 — CAP
  let refillEventId: string; // maxConcurrent 10 — refill

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
        QueueModule,
      ],
    }).compile();

    joinUseCase = moduleRef.get(JoinQueueUseCase);
    admission = moduleRef.get(AdmissionUseCase);
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

    fifoEventId = await createEventWithRoom(prisma, orgProfile.id, 100, 30);
    capEventId = await createEventWithRoom(prisma, orgProfile.id, 10, 30);
    refillEventId = await createEventWithRoom(prisma, orgProfile.id, 10, 30);
  }, 30000);

  afterAll(async () => {
    const eventIds = [fifoEventId, capEventId, refillEventId];
    for (const id of eventIds) await flushQueueKeys(redis, id);
    await prisma.waitingRoom.deleteMany({
      where: { eventId: { in: eventIds } },
    });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.organizerProfile.deleteMany({
      where: { userId: organizerUserId },
    });
    await prisma.user.deleteMany({ where: { id: organizerUserId } });
    await moduleRef.close();
  });

  it('FIFO: 50 concurrent joins are admitted in join order', async () => {
    const users = Array.from({ length: 50 }, () => randomUUID());
    const joins = await Promise.all(
      users.map((userId) =>
        joinUseCase.execute({ userId, eventId: fifoEventId }),
      ),
    );
    const positionByUser = new Map<string, number>();
    users.forEach((u, i) => positionByUser.set(u, joins[i].position));

    // Positions assigned at join must be a clean 1..50 permutation.
    const positions = [...positionByUser.values()].sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

    const expectedOrder = [...users].sort(
      (a, b) => positionByUser.get(a)! - positionByUser.get(b)!,
    );
    // cap 100 → all 50 admitted in one cycle, in ascending-score (FIFO) order
    const admitted = await admission.admitForEvent(fifoEventId);
    expect(admitted).toEqual(expectedOrder);
  }, 20000);

  it('CAP: 100 join but never more than maxConcurrent (10) are admitted', async () => {
    const users = Array.from({ length: 100 }, () => randomUUID());
    await Promise.all(
      users.map((userId) =>
        joinUseCase.execute({ userId, eventId: capEventId }),
      ),
    );

    const admitted = await admission.admitForEvent(capEventId);
    expect(admitted).toHaveLength(10);
    const card = await redis['client'].scard(
      RedisQueueStoreAdapter.activeKey(capEventId),
    );
    expect(card).toBe(10);

    // running again while full admits no one
    const again = await admission.admitForEvent(capEventId);
    expect(again).toHaveLength(0);
    expect(
      await redis['client'].scard(RedisQueueStoreAdapter.activeKey(capEventId)),
    ).toBe(10);
  }, 20000);

  it('Refill: freeing exactly one slot admits exactly one next person', async () => {
    const users = Array.from({ length: 15 }, () => randomUUID());
    for (const userId of users) {
      await joinUseCase.execute({ userId, eventId: refillEventId });
    }
    const firstBatch = await admission.admitForEvent(refillEventId);
    expect(firstBatch).toHaveLength(10);

    // free one slot by deleting one admitted user's token
    const freed = firstBatch[0];
    await redis.del(RedisQueueStoreAdapter.tokenKey(refillEventId, freed));

    const secondBatch = await admission.admitForEvent(refillEventId);
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]).not.toBe(freed);
    expect(
      await redis['client'].scard(
        RedisQueueStoreAdapter.activeKey(refillEventId),
      ),
    ).toBe(10);
  }, 20000);

  it('Idempotent join: same user twice → same position, queue size unchanged', async () => {
    const userId = randomUUID();
    const first = await joinUseCase.execute({ userId, eventId: fifoEventId });
    const cardBefore = await redis['client'].zcard(
      RedisQueueStoreAdapter.queueKey(fifoEventId),
    );
    const second = await joinUseCase.execute({ userId, eventId: fifoEventId });
    const cardAfter = await redis['client'].zcard(
      RedisQueueStoreAdapter.queueKey(fifoEventId),
    );
    expect(second.position).toBe(first.position);
    expect(cardAfter).toBe(cardBefore);
  });
});

async function createEventWithRoom(
  prisma: PrismaService,
  organizerId: string,
  maxConcurrent: number,
  bookingWindow: number,
): Promise<string> {
  const event = await prisma.event.create({
    data: {
      organizerId,
      title: `Queue Test ${randomUUID()}`,
      startTime: new Date(Date.now() + 24 * 3600 * 1000),
      endTime: new Date(Date.now() + 25 * 3600 * 1000),
    },
  });
  await prisma.waitingRoom.create({
    data: { eventId: event.id, isOpen: true, maxConcurrent, bookingWindow },
  });
  return event.id;
}

async function flushQueueKeys(
  redis: RedisService,
  eventId: string,
): Promise<void> {
  const client = redis['client'] as {
    keys: (p: string) => Promise<string[]>;
    del: (...k: string[]) => Promise<number>;
  };
  const patterns = [
    `queue:event:${eventId}`,
    `queue:event:${eventId}:seq`,
    `active:event:${eventId}`,
    `token:event:${eventId}:user:*`,
  ];
  for (const p of patterns) {
    const ks = await client.keys(p);
    if (ks.length) await client.del(...ks);
  }
}
