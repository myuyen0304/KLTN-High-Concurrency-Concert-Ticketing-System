import { Injectable } from '@nestjs/common';
import {
  MessagingService,
  WORK_EXCHANGE,
} from '../../common/messaging/messaging.service';
import { TicketPublisherPort } from '../application/ports/ticket-publisher.port';

export const TICKET_ISSUE_ROUTING_KEY = 'ticket.issue';
export const TICKET_ISSUE_QUEUE = 'ticket.issue.q';

@Injectable()
export class RabbitmqTicketAdapter implements TicketPublisherPort {
  constructor(private readonly messaging: MessagingService) {}

  async publishIssuance(orderId: string): Promise<void> {
    // IMMEDIATE publish straight to the work exchange — NOT publishDelayed,
    // which would park the job in delay.q for the whole booking window.
    await this.messaging.publish(WORK_EXCHANGE, TICKET_ISSUE_ROUTING_KEY, {
      orderId,
    });
  }
}
