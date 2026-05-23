export const TICKET_PUBLISHER_PORT = Symbol('TICKET_PUBLISHER_PORT');

export interface TicketPublisherPort {
  /**
   * Publish a ticket-issuance job IMMEDIATELY (direct to work.x, NOT via the
   * delay exchange). The consumer issues tickets asynchronously so the callback
   * ACKs the gateway fast.
   */
  publishIssuance(orderId: string): Promise<void>;
}
