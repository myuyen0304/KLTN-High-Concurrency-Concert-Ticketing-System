import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TicketRepositoryPort,
  TicketToIssue,
} from '../application/ports/ticket-repository.port';

@Injectable()
export class PrismaTicketAdapter implements TicketRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadIssuableSeats(orderId: string): Promise<string[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        orderItems: { select: { seatId: true } },
      },
    });
    // Guard: only a PAID order has issuable seats — a stray message issues none.
    if (!order || order.status !== 'PAID') return [];
    return order.orderItems
      .map((item) => item.seatId)
      .filter((id): id is string => id !== null);
  }

  async issueTickets(
    orderId: string,
    tickets: TicketToIssue[],
  ): Promise<number> {
    if (tickets.length === 0) return 0;
    // skipDuplicates + @@unique([orderId, seatId]) makes redelivery a no-op: a
    // seat already issued is skipped, never double-issued (the random qrCode of
    // a retried message would otherwise slip past the qrCode unique index).
    const result = await this.prisma.ticket.createMany({
      data: tickets.map((t) => ({
        orderId,
        seatId: t.seatId,
        qrCode: t.qrCode,
        status: 'ISSUED' as const,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}
