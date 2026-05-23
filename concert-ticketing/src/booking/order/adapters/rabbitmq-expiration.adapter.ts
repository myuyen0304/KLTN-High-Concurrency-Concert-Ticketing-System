import { Injectable } from '@nestjs/common';
import { MessagingService } from '../../../common/messaging/messaging.service';
import { ExpirationPublisherPort } from '../application/ports/expiration-publisher.port';

export const ORDER_EXPIRE_ROUTING_KEY = 'order.expire';
export const ORDER_TIMEOUT_QUEUE = 'order.timeout.q';

@Injectable()
export class RabbitmqExpirationAdapter implements ExpirationPublisherPort {
  constructor(private readonly messaging: MessagingService) {}

  async publishExpiration(orderId: string): Promise<void> {
    await this.messaging.publishDelayed(ORDER_EXPIRE_ROUTING_KEY, { orderId });
  }
}
