import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  TICKET_REPOSITORY_PORT,
  TicketRepositoryPort,
} from './ports/ticket-repository.port';

export interface IssueTicketsInput {
  orderId: string;
}

@Injectable()
export class IssueTicketsUseCase {
  private readonly logger = new Logger(IssueTicketsUseCase.name);

  constructor(
    @Inject(TICKET_REPOSITORY_PORT)
    private readonly tickets: TicketRepositoryPort,
  ) {}

  async execute(input: IssueTicketsInput): Promise<void> {
    const seatIds = await this.tickets.loadIssuableSeats(input.orderId);
    if (seatIds.length === 0) {
      this.logger.warn(
        `No issuable seats for order ${input.orderId}; nothing to issue`,
      );
      return;
    }
    const toIssue = seatIds.map((seatId) => ({
      seatId,
      qrCode: `TKT-${randomUUID()}`,
    }));
    const inserted = await this.tickets.issueTickets(input.orderId, toIssue);
    this.logger.log(
      `Issued ${inserted}/${seatIds.length} new ticket(s) for order ${input.orderId}`,
    );
  }
}
