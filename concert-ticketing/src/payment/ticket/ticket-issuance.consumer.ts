import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  MessagingService,
  WORK_EXCHANGE,
} from '../../common/messaging/messaging.service';
import { IssueTicketsUseCase } from '../application/issue-tickets.use-case';
import {
  TICKET_ISSUE_QUEUE,
  TICKET_ISSUE_ROUTING_KEY,
} from '../adapters/rabbitmq-ticket.adapter';

interface TicketIssuePayload {
  orderId: string;
}

/**
 * Async ticket issuance. Asserts + binds the queue at onApplicationBootstrap
 * (after MessagingService has connected and asserted work.x) so the binding
 * exists BEFORE any ticket.issue message arrives — work.x is a direct exchange
 * and silently drops messages with no matching binding. On handler failure the
 * message is nacked (no requeue) and the issuance is idempotent, so a redelivery
 * never double-issues.
 */
@Injectable()
export class TicketIssuanceConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(TicketIssuanceConsumer.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly issueTickets: IssueTicketsUseCase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.messaging.assertQueue(TICKET_ISSUE_QUEUE, true);
    await this.messaging.bindQueue(
      TICKET_ISSUE_QUEUE,
      WORK_EXCHANGE,
      TICKET_ISSUE_ROUTING_KEY,
    );
    await this.messaging.consume(TICKET_ISSUE_QUEUE, async (payload) => {
      const { orderId } = payload as TicketIssuePayload;
      if (!orderId) {
        this.logger.warn('Received ticket.issue with no orderId; dropping');
        return;
      }
      await this.issueTickets.execute({ orderId });
    });
    this.logger.log(
      `Listening for ticket issuance on ${TICKET_ISSUE_QUEUE} ← ${WORK_EXCHANGE}/${TICKET_ISSUE_ROUTING_KEY}`,
    );
  }
}
