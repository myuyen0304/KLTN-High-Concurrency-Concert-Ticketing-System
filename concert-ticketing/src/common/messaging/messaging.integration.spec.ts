import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { MessagingModule } from './messaging.module';
import { MessagingService } from './messaging.service';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('Messaging integration (Brief 0)', () => {
  let moduleRef: TestingModule;
  let messaging: MessagingService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), MessagingModule],
    }).compile();
    await moduleRef.init(); // triggers onModuleInit → connect + topology
    messaging = moduleRef.get(MessagingService);
  }, 30000);

  afterAll(async () => {
    await moduleRef.close();
  });

  it('publish/consume round-trip with publisher confirms', async () => {
    const suffix = randomUUID();
    const exchange = `test.rt.x.${suffix}`;
    const queue = `test.rt.q.${suffix}`;
    const routingKey = 'rt';

    await messaging.assertExchange(exchange, 'direct', false);
    await messaging.assertQueue(queue, false);
    await messaging.bindQueue(queue, exchange, routingKey);

    const received = new Promise<unknown>((resolve) => {
      void messaging.consume(queue, async (payload) => {
        resolve(payload);
      });
    });

    const sentinel = { hello: 'world', n: 42 };
    // publish() resolves only after broker ack → proves confirms work
    await messaging.publish(exchange, routingKey, sentinel);

    const got = await Promise.race([
      received,
      sleep(3000).then(() => {
        throw new Error('message not consumed within 3s');
      }),
    ]);
    expect(got).toEqual(sentinel);
  }, 10000);

  it('delayed message is delivered only after the queue TTL (delay → DLX → work)', async () => {
    const suffix = randomUUID();
    const delayExchange = `test.delay.x.${suffix}`;
    const delayQueue = `test.delay.q.${suffix}`;
    const workExchange = `test.work.x.${suffix}`;
    const workQueue = `test.work.q.${suffix}`;
    const routingKey = 'order.expired';
    const ttlMs = 1000;

    await messaging.setupDelayTopology({
      delayExchange,
      delayQueue,
      workExchange,
      ttlMs,
    });
    await messaging.assertQueue(workQueue, false);
    await messaging.bindQueue(workQueue, workExchange, routingKey);

    let receivedAt: number | null = null;
    let receivedPayload: unknown = null;
    await messaging.consume(workQueue, async (payload) => {
      receivedAt = Date.now();
      receivedPayload = payload;
    });

    const startedAt = Date.now();
    // publish onto the delay exchange (not publishDelayed → uses test names)
    await messaging.publish(delayExchange, routingKey, { orderId: suffix });

    // not delivered before TTL elapses
    await sleep(300);
    expect(receivedAt).toBeNull();

    // delivered after TTL (poll up to ~3s)
    const deadline = Date.now() + 3000;
    while (receivedAt === null && Date.now() < deadline) {
      await sleep(100);
    }
    expect(receivedAt).not.toBeNull();
    expect(
      (receivedAt as unknown as number) - startedAt,
    ).toBeGreaterThanOrEqual(900);
    expect(receivedPayload).toEqual({ orderId: suffix });
  }, 15000);
});
