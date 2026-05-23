export const TICKET_REPOSITORY_PORT = Symbol('TICKET_REPOSITORY_PORT');

export interface TicketToIssue {
  seatId: string;
  qrCode: string;
}

export interface TicketRepositoryPort {
  /**
   * Seats to issue for a PAID order (OrderItem.seatId). Returns [] if the order
   * is not PAID or has no seats — a guard so a stray message issues nothing.
   */
  loadIssuableSeats(orderId: string): Promise<string[]>;

  /**
   * Insert one ISSUED ticket per (orderId, seatId). Idempotent via the
   * @@unique([orderId, seatId]) constraint + createMany skipDuplicates, so a
   * redelivered message never double-issues. Returns the count actually inserted.
   */
  issueTickets(orderId: string, tickets: TicketToIssue[]): Promise<number>;
}
