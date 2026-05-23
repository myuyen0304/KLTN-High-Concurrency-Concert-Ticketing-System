import { Inject, Injectable, Logger } from '@nestjs/common';
import { InvalidSignatureError } from '../domain/payment.errors';
import {
  FinalizeResult,
  PAYMENT_REPOSITORY_PORT,
  PaymentRepositoryPort,
} from './ports/payment-repository.port';
import {
  SEAT_FINALIZER_PORT,
  SeatFinalizerPort,
} from './ports/seat-finalizer.port';
import {
  TICKET_PUBLISHER_PORT,
  TicketPublisherPort,
} from './ports/ticket-publisher.port';
import {
  PaymentCallback,
  SIGNATURE_VERIFIER_PORT,
  SignatureVerifierPort,
} from './ports/signature-verifier.port';

@Injectable()
export class HandleCallbackUseCase {
  private readonly logger = new Logger(HandleCallbackUseCase.name);

  constructor(
    @Inject(SIGNATURE_VERIFIER_PORT)
    private readonly verifier: SignatureVerifierPort,
    @Inject(PAYMENT_REPOSITORY_PORT)
    private readonly repo: PaymentRepositoryPort,
    @Inject(SEAT_FINALIZER_PORT)
    private readonly seatFinalizer: SeatFinalizerPort,
    @Inject(TICKET_PUBLISHER_PORT)
    private readonly ticketPublisher: TicketPublisherPort,
  ) {}

  async execute(callback: PaymentCallback): Promise<void> {
    // 1. Verify signature (EX2). Failure → log a security warning + throw; the
    //    controller turns it into an opaque 4xx (never leak the reason).
    if (!this.verifier.verify(callback)) {
      this.logger.warn(
        `Rejected callback with bad signature for order ${callback.orderId}`,
      );
      throw new InvalidSignatureError(callback.orderId);
    }

    // A non-success outcome never flips the order; it simply times out via the
    // order.expire DLE. ACK so the gateway stops retrying.
    if (callback.outcome !== 'SUCCESS') {
      this.logger.log(
        `Callback outcome ${callback.outcome} for order ${callback.orderId}; no state change`,
      );
      return;
    }

    // 2. THE decision point: Order CAS + PaymentTransaction + Seat SOLD, one tx.
    const result = await this.repo.markPaidAndFinalize({
      orderId: callback.orderId,
      gatewayTxId: callback.gatewayTxId,
      callbackPayload: callback,
    });

    // 3 (happy) & 4 (AF2 duplicate, already PAID): drive the SAME idempotent
    //    side-effects. No state inspection — releaseLocks + publish are both
    //    idempotent, which makes a callback that crashed after the tx committed
    //    but before its side-effects self-healing.
    if (result.decided || result.currentStatus === 'PAID') {
      await this.driveSideEffects(result, callback.orderId);
      return;
    }

    // currentStatus === 'GONE': order row no longer exists; nothing to do.
    if (result.currentStatus === 'GONE') {
      this.logger.warn(
        `Callback for unknown order ${callback.orderId}; ignored`,
      );
      return;
    }

    // 4 (EX1): money was taken but the order is not honoured — EXPIRED/CANCELLED,
    //    or still PENDING with expiresAt already lapsed (the CAS expiresAt guard
    //    blocked it; the DLE will flip it to EXPIRED shortly). Record a REFUNDED
    //    transaction for Admin (BR11), idempotently, and do NOT issue tickets.
    await this.repo.recordRefundedIfAbsent({
      orderId: callback.orderId,
      gatewayTxId: callback.gatewayTxId,
      callbackPayload: callback,
    });
    this.logger.warn(
      `Late payment for order ${callback.orderId} (status ${result.currentStatus}); recorded REFUNDED`,
    );
  }

  /** Idempotent post-commit effects: release Redis locks + publish issuance. */
  private async driveSideEffects(
    result: FinalizeResult,
    orderId: string,
  ): Promise<void> {
    await this.seatFinalizer.releaseLocks(
      result.eventId,
      result.seatIds,
      result.userId,
    );
    await this.ticketPublisher.publishIssuance(orderId);
  }
}
