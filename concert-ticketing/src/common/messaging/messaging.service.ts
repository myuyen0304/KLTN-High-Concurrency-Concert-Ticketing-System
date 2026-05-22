import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import type { ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';

export const DELAY_EXCHANGE = 'delay.x';
export const DELAY_QUEUE = 'delay.q';
export const WORK_EXCHANGE = 'work.x';

const DEFAULT_BOOKING_WINDOW_SECONDS = 900;
const RECONNECT_DELAY_MS = 2000;

export interface DelayTopologyOptions {
  delayExchange: string;
  delayQueue: string;
  workExchange: string;
  ttlMs: number;
}

type MessageHandler = (payload: unknown) => Promise<void>;

interface RegisteredConsumer {
  queue: string;
  handler: MessageHandler;
}

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private model!: ChannelModel;
  private channel!: ConfirmChannel;
  private readonly consumers: RegisteredConsumer[] = [];
  private shuttingDown = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    try {
      await this.channel?.close();
      await this.model?.close();
    } catch (err) {
      this.logger.warn(`Error closing RabbitMQ: ${(err as Error).message}`);
    }
  }

  private bookingWindowMs(): number {
    const seconds = Number(
      this.config.get('BOOKING_WINDOW_SECONDS', DEFAULT_BOOKING_WINDOW_SECONDS),
    );
    return seconds * 1000;
  }

  private async connect(): Promise<void> {
    const url = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672/',
    );
    this.model = await amqp.connect(url);
    this.model.on('error', (err) =>
      this.logger.error(`RabbitMQ connection error: ${err.message}`),
    );
    this.model.on('close', () => {
      if (!this.shuttingDown) this.scheduleReconnect();
    });

    this.channel = await this.model.createConfirmChannel();

    await this.setupDelayTopology({
      delayExchange: DELAY_EXCHANGE,
      delayQueue: DELAY_QUEUE,
      workExchange: WORK_EXCHANGE,
      ttlMs: this.bookingWindowMs(),
    });

    for (const consumer of this.consumers) {
      await this.registerConsumer(consumer);
    }

    this.logger.log('RabbitMQ connected; delay topology asserted.');
  }

  private scheduleReconnect(): void {
    this.logger.warn(
      `RabbitMQ closed; reconnecting in ${RECONNECT_DELAY_MS}ms`,
    );
    setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error(`Reconnect failed: ${(err as Error).message}`);
        this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }

  /**
   * Fixed-TTL delay → DLX → work pattern. `delayExchange` is fanout so every
   * message lands in `delayQueue` regardless of routing key; on TTL expiry the
   * message dead-letters to `workExchange` keeping its original routing key,
   * which `workExchange` (direct) uses to route to the consuming module's queue.
   */
  async setupDelayTopology(opts: DelayTopologyOptions): Promise<void> {
    await this.channel.assertExchange(opts.delayExchange, 'fanout', {
      durable: true,
    });
    await this.channel.assertExchange(opts.workExchange, 'direct', {
      durable: true,
    });
    await this.channel.assertQueue(opts.delayQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': opts.ttlMs,
        'x-dead-letter-exchange': opts.workExchange,
      },
    });
    await this.channel.bindQueue(opts.delayQueue, opts.delayExchange, '');
  }

  async assertExchange(
    name: string,
    type: 'direct' | 'topic' | 'fanout',
    durable = true,
  ): Promise<void> {
    await this.channel.assertExchange(name, type, { durable });
  }

  async assertQueue(name: string, durable = true): Promise<void> {
    await this.channel.assertQueue(name, { durable });
  }

  async bindQueue(
    queue: string,
    exchange: string,
    routingKey: string,
  ): Promise<void> {
    await this.channel.bindQueue(queue, exchange, routingKey);
  }

  /** Publish with publisher confirms — resolves only after broker ack. */
  async publish(
    exchange: string,
    routingKey: string,
    payload: unknown,
  ): Promise<void> {
    const content = Buffer.from(JSON.stringify(payload));
    await new Promise<void>((resolve, reject) => {
      this.channel.publish(
        exchange,
        routingKey,
        content,
        { persistent: true, contentType: 'application/json' },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /** Publish onto the shared fixed-TTL delay exchange (auto-cancel timers). */
  async publishDelayed(routingKey: string, payload: unknown): Promise<void> {
    await this.publish(DELAY_EXCHANGE, routingKey, payload);
  }

  /** Register a manual-ack consumer; re-registered automatically on reconnect. */
  async consume(queue: string, handler: MessageHandler): Promise<void> {
    const consumer: RegisteredConsumer = { queue, handler };
    this.consumers.push(consumer);
    await this.registerConsumer(consumer);
  }

  private async registerConsumer(consumer: RegisteredConsumer): Promise<void> {
    await this.channel.consume(
      consumer.queue,
      (msg) => {
        if (msg) void this.handleMessage(consumer, msg);
      },
      { noAck: false },
    );
  }

  private async handleMessage(
    consumer: RegisteredConsumer,
    msg: ConsumeMessage,
  ): Promise<void> {
    try {
      const payload = JSON.parse(msg.content.toString()) as unknown;
      await consumer.handler(payload);
      this.channel.ack(msg);
    } catch (err) {
      this.logger.error(
        `Consumer for ${consumer.queue} failed: ${(err as Error).message}`,
      );
      this.channel.nack(msg, false, false);
    }
  }
}
