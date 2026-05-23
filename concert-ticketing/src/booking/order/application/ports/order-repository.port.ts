import { OrderEntity } from '../../domain/order.entity';

export const ORDER_REPOSITORY_PORT = Symbol('ORDER_REPOSITORY_PORT');

export interface SeatPricing {
  seatId: string;
  ticketTypeId: string;
  unitPrice: string;
}

export interface CreateOrderItem {
  seatId: string;
  ticketTypeId: string;
  unitPrice: string;
}

export interface CreateOrderData {
  userId: string;
  eventId: string;
  idempotencyKey: string;
  expiresAt: Date;
  items: CreateOrderItem[];
}

export interface ExpireResult {
  changed: boolean;
  userId: string;
  eventId: string;
  seatIds: string[];
}

export interface OrderRepositoryPort {
  /**
   * Loads ticket-type pricing for the given seats of an event.
   * Throws SeatNotPriceableError if a seat is missing or has no ticket type.
   */
  loadSeatPricing(eventId: string, seatIds: string[]): Promise<SeatPricing[]>;

  /**
   * Inserts Order(PENDING) + OrderItems in one transaction, then runs
   * `confirmHold` inside the SAME transaction. If `confirmHold` rejects, the
   * whole transaction rolls back (no orphan order). totalAmount is summed from
   * items via Decimal. Throws DuplicateOrderError on idempotencyKey P2002.
   */
  create(
    data: CreateOrderData,
    confirmHold: () => Promise<void>,
  ): Promise<OrderEntity>;

  findByIdempotencyKey(key: string): Promise<OrderEntity | null>;

  /** Compare-and-set: PENDING → EXPIRED. `changed=false` if already settled. */
  markExpiredIfPending(orderId: string): Promise<ExpireResult>;

  /** Audit: mark the seat locks of these seats EXPIRED (vá drift held-set). */
  expireSeatLockAudit(seatIds: string[], userId: string): Promise<void>;
}
