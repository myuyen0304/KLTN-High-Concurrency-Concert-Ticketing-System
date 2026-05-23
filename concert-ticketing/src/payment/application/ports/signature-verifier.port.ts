export const SIGNATURE_VERIFIER_PORT = Symbol('SIGNATURE_VERIFIER_PORT');

export type PaymentOutcome = 'SUCCESS' | 'FAILED';

export interface PaymentCallback {
  orderId: string;
  gatewayTxId: string | null;
  outcome: PaymentOutcome;
  signature: string;
}

export interface SignatureVerifierPort {
  /** Verify the gateway's HMAC over the callback fields (mock). */
  verify(callback: PaymentCallback): boolean;
}
