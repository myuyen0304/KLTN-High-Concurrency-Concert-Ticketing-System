import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { RedisSeatLockAdapter } from '../booking/seat-lock/adapters/redis-seat-lock.adapter';
import { MockSignatureAdapter } from './adapters/mock-signature.adapter';
import { PrismaPaymentAdapter } from './adapters/prisma-payment.adapter';
import { PrismaTicketAdapter } from './adapters/prisma-ticket.adapter';
import { SeatFinalizerAdapter } from './adapters/seat-finalizer.adapter';
import { HandleCallbackUseCase } from './application/handle-callback.use-case';
import { IssueTicketsUseCase } from './application/issue-tickets.use-case';
import { PAYMENT_REPOSITORY_PORT } from './application/ports/payment-repository.port';
import { SEAT_FINALIZER_PORT } from './application/ports/seat-finalizer.port';
import { SIGNATURE_VERIFIER_PORT } from './application/ports/signature-verifier.port';
import { TICKET_PUBLISHER_PORT } from './application/ports/ticket-publisher.port';
import { TICKET_REPOSITORY_PORT } from './application/ports/ticket-repository.port';
import { InvalidSignatureError } from './domain/payment.errors';
import { PaymentOutcome } from './application/ports/signature-verifier.port';

const SECRET = 'test-secret';
const UNIT_PRICE = '100.50';
const TTL_SECONDS = 120;

describe('Payment integration (UC11)', () => {
  let moduleRef: TestingModule;
  let handleCallback: HandleCallbackUseCase;
  let issueTickets: IssueTicketsUseCase;
  let prisma: PrismaService;
  let redis: RedisService;

  const publisher = {
    publishIssuance: jest.fn().mockResolvedValue(undefined),
  };

  let eventId: string;
  let organizerUserId: string;
  let ticketTypeId: string;
  let buyerId: string;
  let seatIds: string[] = [];

  beforeAll(async () => {
    process.env.PAYMENT_CALLBACK_SECRET = SECRET;
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        RedisModule,
      ],
      providers: [
        HandleCallbackUseCase,
        IssueTicketsUseCase,
        { provide: PAYMENT_REPOSITORY_PORT, useClass: PrismaPaymentAdapter },
        { provide: SEAT_FINALIZER_PORT, useClass: SeatFinalizerAdapter },
        { provide: TICKET_REPOSITORY_PORT, useClass: PrismaTicketAdapter },
        { provide: SIGNATURE_VERIFIER_PORT, useClass: MockSignatureAdapter },
        { provide: TICKET_PUBLISHER_PORT, useValue: publisher },
      ],
    }).compile();

    handleCallback = moduleRef.get(HandleCallbackUseCase);
    issueTickets = moduleRef.get(IssueTicketsUseCase);
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
        title: 'UC11 Test Event',
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
      Array.from({ length: 10 }).map((_, i) =>
        prisma.seat.create({ data: { eventId, ticketTypeId, label: `S${i}` } }),
      ),
    );
    seatIds = seats.map((s) => s.id);
  });

  afterAll(async () => {
    await cleanup();
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
    publisher.publishIssuance.mockClear();
    await cleanup();
    await prisma.seat.updateMany({
      where: { eventId },
      data: { status: 'AVAILABLE' },
    });
    await flushHoldKeys(redis, eventId);
  });

  it('happy path: SUCCESS callback → PAID, seats SOLD, locks gone, txn SUCCESS, issuance published; consumer issues tickets', async () => {
    const seats = [seatIds[0], seatIds[1]];
    await holdSeats(seats, buyerId);
    const orderId = await createPendingOrder(buyerId, seats);

    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('PAID');

    const txn = await prisma.paymentTransaction.findUnique({
      where: { orderId },
    });
    expect(txn?.status).toBe('SUCCESS');
    expect(Number(txn?.amount)).toBe(201); // 2 × 100.50

    const dbSeats = await prisma.seat.findMany({
      where: { id: { in: seats } },
    });
    expect(dbSeats.every((s) => s.status === 'SOLD')).toBe(true);

    for (const seatId of seats) {
      const owner = await redis.get(
        RedisSeatLockAdapter.lockKey(eventId, seatId),
      );
      expect(owner).toBeNull();
    }
    expect(publisher.publishIssuance).toHaveBeenCalledTimes(1);
    expect(publisher.publishIssuance).toHaveBeenCalledWith(orderId);

    // The async consumer step: issue tickets.
    await issueTickets.execute({ orderId });
    const tickets = await prisma.ticket.findMany({ where: { orderId } });
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.status === 'ISSUED')).toBe(true);
  });

  it('duplicate callback (AF2): two SUCCESS callbacks → PAID once, 1 transaction, re-driven idempotently', async () => {
    const seats = [seatIds[2]];
    await holdSeats(seats, buyerId);
    const orderId = await createPendingOrder(buyerId, seats);

    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));
    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('PAID');
    const txnCount = await prisma.paymentTransaction.count({
      where: { orderId },
    });
    expect(txnCount).toBe(1);
    // The duplicate re-drives the idempotent side-effects (publish again); the
    // consumer dedupes by @@unique([orderId, seatId]).
    expect(publisher.publishIssuance).toHaveBeenCalledTimes(2);

    await issueTickets.execute({ orderId });
    await issueTickets.execute({ orderId });
    const tickets = await prisma.ticket.count({ where: { orderId } });
    expect(tickets).toBe(1);
  });

  it('self-heal: order committed PAID but locks lingered → callback re-drive clears them', async () => {
    const seats = [seatIds[3]];
    await holdSeats(seats, buyerId);
    const orderId = await createPendingOrder(buyerId, seats);

    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));
    // Simulate a crash that committed the tx but never released the Redis lock.
    await holdSeats(seats, buyerId);
    expect(
      await redis.get(RedisSeatLockAdapter.lockKey(eventId, seats[0])),
    ).toBe(buyerId);

    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));
    expect(
      await redis.get(RedisSeatLockAdapter.lockKey(eventId, seats[0])),
    ).toBeNull();
  });

  it('race with timeout (EX1): order already EXPIRED → stays EXPIRED, no tickets, REFUNDED recorded', async () => {
    const seats = [seatIds[4]];
    const orderId = await createPendingOrder(buyerId, seats);
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'EXPIRED' },
    });

    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('EXPIRED');
    const txn = await prisma.paymentTransaction.findUnique({
      where: { orderId },
    });
    expect(txn?.status).toBe('REFUNDED');
    expect(publisher.publishIssuance).not.toHaveBeenCalled();
    const tickets = await prisma.ticket.count({ where: { orderId } });
    expect(tickets).toBe(0);
  });

  it('expiresAt guard: PENDING but window lapsed → not PAID, REFUNDED recorded, no issue', async () => {
    const seats = [seatIds[5]];
    const orderId = await createPendingOrder(
      buyerId,
      seats,
      new Date(Date.now() - 1000),
    );

    await handleCallback.execute(signedCallback(orderId, 'SUCCESS'));

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('PENDING'); // CAS blocked by expiresAt guard
    const txn = await prisma.paymentTransaction.findUnique({
      where: { orderId },
    });
    expect(txn?.status).toBe('REFUNDED');
    expect(publisher.publishIssuance).not.toHaveBeenCalled();
  });

  it('forged signature (EX2): bad signature → throws, order stays PENDING, no transaction', async () => {
    const seats = [seatIds[6]];
    await holdSeats(seats, buyerId);
    const orderId = await createPendingOrder(buyerId, seats);

    await expect(
      handleCallback.execute({
        orderId,
        gatewayTxId: 'gw-1',
        outcome: 'SUCCESS',
        signature: 'forged-signature',
      }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe('PENDING');
    const txn = await prisma.paymentTransaction.findUnique({
      where: { orderId },
    });
    expect(txn).toBeNull();
    expect(publisher.publishIssuance).not.toHaveBeenCalled();
  });

  // ─── helpers ──────────────────────────────────────────────────────────────

  function signedCallback(
    orderId: string,
    outcome: PaymentOutcome,
    gatewayTxId = `gw-${randomUUID()}`,
  ) {
    const signature = MockSignatureAdapter.sign(SECRET, {
      orderId,
      gatewayTxId,
      outcome,
    });
    return { orderId, gatewayTxId, outcome, signature };
  }

  async function holdSeats(seats: string[], userId: string): Promise<void> {
    const client = redis['client'] as {
      sadd: (k: string, m: string) => Promise<number>;
    };
    for (const seatId of seats) {
      await redis.set(
        RedisSeatLockAdapter.lockKey(eventId, seatId),
        userId,
        TTL_SECONDS,
      );
      await client.sadd(RedisSeatLockAdapter.eventSetKey(eventId), seatId);
      await client.sadd(
        RedisSeatLockAdapter.userSetKey(eventId, userId),
        seatId,
      );
    }
  }

  async function createPendingOrder(
    userId: string,
    seats: string[],
    expiresAt = new Date(Date.now() + TTL_SECONDS * 1000),
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        userId,
        eventId,
        idempotencyKey: `idem-${randomUUID()}`,
        status: 'PENDING',
        totalAmount: (Number(UNIT_PRICE) * seats.length).toFixed(2),
        expiresAt,
        orderItems: {
          create: seats.map((seatId) => ({
            seatId,
            ticketTypeId,
            unitPrice: UNIT_PRICE,
          })),
        },
      },
    });
    return order.id;
  }

  async function cleanup(): Promise<void> {
    await prisma.ticket.deleteMany({ where: { order: { eventId } } });
    await prisma.paymentTransaction.deleteMany({
      where: { order: { eventId } },
    });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.seatLock.deleteMany({ where: { seat: { eventId } } });
  }
});

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
