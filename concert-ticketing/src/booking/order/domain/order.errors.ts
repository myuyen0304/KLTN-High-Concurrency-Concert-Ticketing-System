export const ORDER_ERROR_CODES = {
  SEAT_HOLD_EXPIRED: 'SEAT_HOLD_EXPIRED',
  ORDER_KEY_CONSUMED: 'ORDER_KEY_CONSUMED',
  SEAT_NOT_PRICEABLE: 'SEAT_NOT_PRICEABLE',
} as const;

/** A seat lock is missing / expired / not owned by the user → cannot create order. */
export class SeatHoldExpiredError extends Error {
  readonly code = ORDER_ERROR_CODES.SEAT_HOLD_EXPIRED;
  constructor(seatId: string) {
    super(`Seat hold for ${seatId} is expired or not owned by the user`);
    this.name = 'SeatHoldExpiredError';
  }
}

/**
 * Internal signal that an INSERT hit the idempotencyKey unique constraint
 * (P2002). Caught by the use-case to resolve the idempotent-replay path; never
 * surfaced to the controller directly.
 */
export class DuplicateOrderError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Order with idempotencyKey ${idempotencyKey} already exists`);
    this.name = 'DuplicateOrderError';
  }
}

/**
 * The idempotencyKey already produced an order that is no longer PENDING
 * (EXPIRED/CANCELLED). The client must retry with a fresh key.
 */
export class OrderKeyConsumedError extends Error {
  readonly code = ORDER_ERROR_CODES.ORDER_KEY_CONSUMED;
  constructor(orderId: string, status: string) {
    super(`Idempotency key already consumed by order ${orderId} (${status})`);
    this.name = 'OrderKeyConsumedError';
  }
}

/** A seat has no ticket type → its price cannot be determined. */
export class SeatNotPriceableError extends Error {
  readonly code = ORDER_ERROR_CODES.SEAT_NOT_PRICEABLE;
  constructor(seatId: string) {
    super(`Seat ${seatId} has no ticket type and cannot be priced`);
    this.name = 'SeatNotPriceableError';
  }
}
