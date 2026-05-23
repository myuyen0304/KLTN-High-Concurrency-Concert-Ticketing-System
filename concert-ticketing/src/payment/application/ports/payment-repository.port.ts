export const PAYMENT_REPOSITORY_PORT = Symbol('PAYMENT_REPOSITORY_PORT');

export interface InitiationView {
  status: string;
  amount: string;
}

export interface MarkPaidInput {
  orderId: string;
  gatewayTxId: string | null;
  callbackPayload: unknown;
}

export interface RefundInput {
  orderId: string;
  gatewayTxId: string | null;
  callbackPayload: unknown;
}

/**
 * Outcome of the atomic decision point. Flat shape on purpose: tsconfig has
 * strictNullChecks=false so a discriminated union would not narrow. When the
 * order exists, eventId/userId/seatIds are always populated (the AF2 duplicate
 * path needs them to re-drive the idempotent side-effects). currentStatus is
 * 'GONE' when the order row no longer exists.
 */
export interface FinalizeResult {
  decided: boolean;
  currentStatus: string;
  eventId: string;
  userId: string;
  seatIds: string[];
}

export interface PaymentRepositoryPort {
  /** Initiate guard: returns null if missing or not owned (no info leak). */
  findForInitiation(
    orderId: string,
    userId: string,
  ): Promise<InitiationView | null>;

  /**
   * THE single decision point. In ONE $transaction:
   *  - updateMany Order WHERE id & status=PENDING & expiresAt>now() → PAID
   *  - count!=1 → read current status, return { decided:false, ... }
   *  - count=1 → INSERT PaymentTransaction(SUCCESS, idempotencyKey=orderId,
   *    amount=order.totalAmount, gatewayTxId, callbackPayload, processedAt=now)
   *    + UPDATE all order seats → SOLD; return { decided:true, ... }
   */
  markPaidAndFinalize(input: MarkPaidInput): Promise<FinalizeResult>;

  /**
   * EX1 (callback success but order already EXPIRED/CANCELLED, money taken):
   * record a REFUNDED PaymentTransaction for Admin (BR11). Idempotent — a no-op
   * if a transaction row already exists for the order.
   */
  recordRefundedIfAbsent(input: RefundInput): Promise<void>;
}
