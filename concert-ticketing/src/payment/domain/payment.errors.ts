export const PAYMENT_ERROR_CODES = {
  INVALID_SIGNATURE: 'PAYMENT_INVALID_SIGNATURE',
  ORDER_NOT_PAYABLE: 'ORDER_NOT_PAYABLE',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
} as const;

/**
 * Callback signature did not verify (EX2). The handler logs a security warning
 * and the controller returns an opaque 4xx — never leak why it failed.
 */
export class InvalidSignatureError extends Error {
  readonly code = PAYMENT_ERROR_CODES.INVALID_SIGNATURE;
  constructor(orderId: string) {
    super(`Invalid payment callback signature for order ${orderId}`);
    this.name = 'InvalidSignatureError';
  }
}

/** Order exists + owned by the user but is no longer PENDING → cannot initiate. */
export class OrderNotPayableError extends Error {
  readonly code = PAYMENT_ERROR_CODES.ORDER_NOT_PAYABLE;
  constructor(orderId: string, status: string) {
    super(`Order ${orderId} is not payable (status ${status})`);
    this.name = 'OrderNotPayableError';
  }
}

/** Order not found, or not owned by the requesting user (do not disclose which). */
export class OrderNotFoundError extends Error {
  readonly code = PAYMENT_ERROR_CODES.ORDER_NOT_FOUND;
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}
