import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  MessagingService,
  WORK_EXCHANGE,
} from '../../../common/messaging/messaging.service';
import { ExpireOrderUseCase } from '../application/expire-order.use-case';
import {
  ORDER_EXPIRE_ROUTING_KEY,
  ORDER_TIMEOUT_QUEUE,
} from '../adapters/rabbitmq-expiration.adapter';

interface OrderExpirePayload {
  orderId: string;
}

/**
 * Inbound adapter for the DLE timeout. Runs at onApplicationBootstrap (after
 * MessagingService.onModuleInit has connected and asserted work.x) so the
 * durable queue + binding exist BEFORE any order.expire message dead-letters —
 * a direct exchange silently drops messages with no matching binding.
 */
@Injectable()
export class OrderTimeoutConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrderTimeoutConsumer.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly expireOrder: ExpireOrderUseCase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.messaging.assertQueue(ORDER_TIMEOUT_QUEUE, true);
    await this.messaging.bindQueue(
      ORDER_TIMEOUT_QUEUE,
      WORK_EXCHANGE,
      ORDER_EXPIRE_ROUTING_KEY,
    );
    await this.messaging.consume(ORDER_TIMEOUT_QUEUE, async (payload) => {
      const { orderId } = payload as OrderExpirePayload;
      if (!orderId) {
        this.logger.warn('Received order.expire with no orderId; dropping');
        return;
      }
      await this.expireOrder.execute({ orderId });
    });
    this.logger.log(
      `Listening for order timeouts on ${ORDER_TIMEOUT_QUEUE} ← ${WORK_EXCHANGE}/${ORDER_EXPIRE_ROUTING_KEY}`,
    );
  }
}
