import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisModule } from '../../redis/redis.module';
import { RedisService } from '../../redis/redis.service';
import { RedisSeatLockAdapter } from '../seat-lock/adapters/redis-seat-lock.adapter';
import { PrismaOrderAdapter } from './adapters/prisma-order.adapter';
import { RedisSeatHoldAdapter } from './adapters/redis-seat-hold.adapter';
import { CreateOrderUseCase } from './application/create-order.use-case';
import { ExpireOrderUseCase } from './application/expire-order.use-case';
import { EXPIRATION_PUBLISHER_PORT } from './application/ports/expiration-publisher.port';
import {
  ORDER_REPOSITORY_PORT,
  OrderRepositoryPort,
} from './application/ports/order-repository.port';
import { SEAT_HOLD_PORT } from './application/ports/seat-hold.port';
import {
  OrderKeyConsumedError,
  SeatHoldExpiredError,
  SeatNotPriceableError,
} from './domain/order.errors';

const BOOKING_WINDOW_SECONDS = 120;

describe('Order integration (UC10)', () => {
  let moduleRef: TestingModule;
  let createOrder: CreateOrderUseCase;
  let expireOrder: ExpireOrderUseCase;
  let repo: OrderRepositoryPort;
  let prisma: PrismaService;
  let redis: RedisService;

  const publisher = {
    publishExpiration: jest.fn().mockResolvedValue(undefined),
  };

  let eventId: string;
  let organizerUserId: string;
  let ticketTypeId: string;
  let buyerId: string;
  let seatIds: string[] = [];
  const UNIT_PRICE = '100.50';

  beforeAll(async () => {
    process.env.BOOKING_WINDOW_SECONDS = String(BOOKING_WINDOW_SECONDS);
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
      ],
      providers: [
        CreateOrderUseCase,
        ExpireOrderUseCase,
        { provide: ORDER_REPOSITORY_PORT, useClass: PrismaOrderAdapter },
        { provide: SEAT_HOLD_PORT, useClass: RedisSeatHoldAdapter },
        { provide: EXPIRATION_PUBLISHER_PORT, useValue: publisher },
      ],
    }).compile();

    createOrder = moduleRef.get(CreateOrderUseCase);
    expireOrder = moduleRef.get(ExpireOrderUseCase);
    repo = moduleRef.get(ORDER_REPOSITORY_PORT);
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
        title: 'UC10 Test Event',
        startTime: new Date(Date.now() + 24 * 3600 * 1000),
        endTime: new Date(Date.now() + 25 * 3600 * 1000),
      },
    });
    eventId = event.id;
    const ticketType = await prisma.ticketType.create({
      data: {
        eventId,
        name: 'GA',
        price: UNIT_PRICE,
        quantity: 100,
        saleStartTime: new Date(Date.now() - 3600 * 1000),
        saleEndTime: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    ticketTypeId = ticketType.id;

    const buyer = await prisma.user.create({
      data: {
        email: `buyer-${randomUUID()}@test.local`,
        passwordHash: 'x',
        fullName: 'Buyer',
      },
    });
    buyerId = buyer.id;

    const seats = await Promise.all(
      Array.from({ length: 6 }).map((_, i) =>
        prisma.seat.create({ data: { eventId, ticketTypeId, label: `S${i}` } }),
      ),
    );
    seatIds = seats.map((s) => s.id);
  });

  afterAll(async () => {
    await cleanupOrders();
    await prisma.seatLock.deleteMany({ where: { seat: { eventId } } });
    await prisma.seat.deleteMany({ where: { eventId } });
    await prisma.ticketType.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.organizerProfile.deleteMany({
      where: { userId: organizerUserId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [organizerUserId, buyerId] } },
    });
    await flushHoldKeys(redis, eventId);
    await moduleRef.close();
  });

  beforeEach(async () => {
    publisher.publishExpiration.mockClear();
    await cleanupOrders();
    await prisma.seatLock.deleteMany({ where: { seat: { eventId } } });
    await flushHoldKeys(redis, eventId);
  });

  it('idempotency: 50 concurrent requests with the same key → exactly 1 order', async () => {
    const seatId = seatIds[0];
    await holdSeat(
      redis,
      prisma,
      eventId,
      seatId,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    const idempotencyKey = `idem-${randomUUID()}`;

    const settled = await Promise.allSettled(
      Array.from({ length: 50 }).map(() =>
        createOrder.execute({
          userId: buyerId,
          eventId,
          seatIds: [seatId],
          idempotencyKey,
        }),
      ),
    );

    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(50);
    const orderIds = new Set(
      fulfilled.map(
        (r) =>
          (r as PromiseFulfilledResult<{ order: { id: string } }>).value.order
            .id,
      ),
    );
    expect(orderIds.size).toBe(1);

    const created = settled.filter(
      (r) =>
        r.status === 'fulfilled' &&
        !(r as PromiseFulfilledResult<{ replayed: boolean }>).value.replayed,
    );
    expect(created).toHaveLength(1);

    const dbCount = await prisma.order.count({ where: { idempotencyKey } });
    expect(dbCount).toBe(1);
  }, 20000);

  it('seat hold expired: no lock → SEAT_HOLD_EXPIRED, no order created', async () => {
    const seatId = seatIds[1];
    // intentionally do NOT hold the seat
    const idempotencyKey = `idem-${randomUUID()}`;
    await expect(
      createOrder.execute({
        userId: buyerId,
        eventId,
        seatIds: [seatId],
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(SeatHoldExpiredError);

    const dbCount = await prisma.order.count({ where: { idempotencyKey } });
    expect(dbCount).toBe(0);
  });

  it('TTL sync: two seats held with different TTLs → equal after create', async () => {
    const a = seatIds[2];
    const b = seatIds[3];
    await holdSeat(redis, prisma, eventId, a, buyerId, 30);
    await holdSeat(redis, prisma, eventId, b, buyerId, 90);

    await createOrder.execute({
      userId: buyerId,
      eventId,
      seatIds: [a, b],
      idempotencyKey: `idem-${randomUUID()}`,
    });

    const ttlA = await redis.ttl(RedisSeatLockAdapter.lockKey(eventId, a));
    const ttlB = await redis.ttl(RedisSeatLockAdapter.lockKey(eventId, b));
    expect(Math.abs(ttlA - ttlB)).toBeLessThanOrEqual(2);
    expect(ttlA).toBeGreaterThan(90); // reset upward to the booking window
  });

  it('timeout cleanup is idempotent: EXPIRED + locks released, second call no-op', async () => {
    const seatId = seatIds[4];
    await holdSeat(
      redis,
      prisma,
      eventId,
      seatId,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    const { order } = await createOrder.execute({
      userId: buyerId,
      eventId,
      seatIds: [seatId],
      idempotencyKey: `idem-${randomUUID()}`,
    });
    expect(publisher.publishExpiration).toHaveBeenCalledWith(order.id);

    await expireOrder.execute({ orderId: order.id });

    const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(dbOrder?.status).toBe('EXPIRED');
    const lockOwner = await redis.get(
      RedisSeatLockAdapter.lockKey(eventId, seatId),
    );
    expect(lockOwner).toBeNull();
    const userSetCard = await redis['client'].scard(
      RedisSeatLockAdapter.userSetKey(eventId, buyerId),
    );
    expect(userSetCard).toBe(0);
    const audit = await prisma.seatLock.findFirst({
      where: { seatId, userId: buyerId },
    });
    expect(audit?.status).toBe('EXPIRED');

    // second delivery → idempotent no-op (still EXPIRED, no throw)
    await expect(
      expireOrder.execute({ orderId: order.id }),
    ).resolves.toBeUndefined();
    const after = await prisma.order.findUnique({ where: { id: order.id } });
    expect(after?.status).toBe('EXPIRED');
  });

  it('Option β: confirmHold rejects → transaction rolls back, no order row', async () => {
    const seatId = seatIds[5];
    await holdSeat(
      redis,
      prisma,
      eventId,
      seatId,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    const idempotencyKey = `idem-${randomUUID()}`;
    const pricing = await repo.loadSeatPricing(eventId, [seatId]);

    const before = await prisma.order.count({ where: { eventId } });
    await expect(
      repo.create(
        {
          userId: buyerId,
          eventId,
          idempotencyKey,
          expiresAt: new Date(Date.now() + BOOKING_WINDOW_SECONDS * 1000),
          items: pricing,
        },
        async () => {
          throw new Error('simulated TTL-sync failure');
        },
      ),
    ).rejects.toThrow('simulated TTL-sync failure');

    const after = await prisma.order.count({ where: { eventId } });
    expect(after).toBe(before);
    const orphan = await prisma.order.findFirst({ where: { idempotencyKey } });
    expect(orphan).toBeNull();
  });

  it('same idempotencyKey across different users → independent orders (per-user scope)', async () => {
    const idempotencyKey = `idem-${randomUUID()}`;
    const buyerSeat = seatIds[0];
    const otherSeat = seatIds[1];
    await holdSeat(
      redis,
      prisma,
      eventId,
      buyerSeat,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    await holdSeat(
      redis,
      prisma,
      eventId,
      otherSeat,
      organizerUserId,
      BOOKING_WINDOW_SECONDS,
    );

    const first = await createOrder.execute({
      userId: buyerId,
      eventId,
      seatIds: [buyerSeat],
      idempotencyKey,
    });

    // The key is now scoped per user (@@unique([userId, idempotencyKey])), so the
    // organizer reusing the same key string is NOT a collision — it creates its
    // own order rather than replaying or conflicting.
    const second = await createOrder.execute({
      userId: organizerUserId,
      eventId,
      seatIds: [otherSeat],
      idempotencyKey,
    });

    expect(second.replayed).toBe(false);
    expect(second.order.id).not.toBe(first.order.id);
  });

  it('replaying a key whose order already EXPIRED → ORDER_KEY_CONSUMED', async () => {
    const seatId = seatIds[2];
    const idempotencyKey = `idem-${randomUUID()}`;
    await holdSeat(
      redis,
      prisma,
      eventId,
      seatId,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    const { order } = await createOrder.execute({
      userId: buyerId,
      eventId,
      seatIds: [seatId],
      idempotencyKey,
    });
    await expireOrder.execute({ orderId: order.id });

    // re-hold (expire released it) then retry the SAME key
    await holdSeat(
      redis,
      prisma,
      eventId,
      seatId,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    await expect(
      createOrder.execute({
        userId: buyerId,
        eventId,
        seatIds: [seatId],
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(OrderKeyConsumedError);
  });

  it('seat without a ticket type → SEAT_NOT_PRICEABLE', async () => {
    const seat = await prisma.seat.create({
      data: { eventId, label: 'no-price' },
    });
    await holdSeat(
      redis,
      prisma,
      eventId,
      seat.id,
      buyerId,
      BOOKING_WINDOW_SECONDS,
    );
    await expect(
      createOrder.execute({
        userId: buyerId,
        eventId,
        seatIds: [seat.id],
        idempotencyKey: `idem-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(SeatNotPriceableError);
  });

  async function cleanupOrders(): Promise<void> {
    await prisma.order.deleteMany({ where: { eventId } });
  }
});

async function holdSeat(
  redis: RedisService,
  prisma: PrismaService,
  eventId: string,
  seatId: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(
    RedisSeatLockAdapter.lockKey(eventId, seatId),
    userId,
    ttlSeconds,
  );
  const client = redis['client'] as {
    sadd: (k: string, m: string) => Promise<number>;
  };
  await client.sadd(RedisSeatLockAdapter.eventSetKey(eventId), seatId);
  await client.sadd(RedisSeatLockAdapter.userSetKey(eventId, userId), seatId);
  await prisma.seatLock.create({
    data: {
      seatId,
      userId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      status: 'ACTIVE',
    },
  });
}

async function flushHoldKeys(
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
