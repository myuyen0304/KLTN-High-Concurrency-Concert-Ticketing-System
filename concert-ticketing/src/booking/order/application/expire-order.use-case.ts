import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORDER_REPOSITORY_PORT,
  OrderRepositoryPort,
} from './ports/order-repository.port';
import { SEAT_HOLD_PORT, SeatHoldPort } from './ports/seat-hold.port';

export interface ExpireOrderInput {
  orderId: string;
}

@Injectable()
export class ExpireOrderUseCase {
  private readonly logger = new Logger(ExpireOrderUseCase.name);

  constructor(
    @Inject(ORDER_REPOSITORY_PORT)
    private readonly repo: OrderRepositoryPort,
    @Inject(SEAT_HOLD_PORT)
    private readonly seatHold: SeatHoldPort,
  ) {}

  /**
   * Idempotent: compare-and-set PENDING→EXPIRED. Only on a real transition do
   * we release the Redis locks + held-set membership and mark the seat-lock
   * audit EXPIRED (this is what keeps UC09's held-set from drifting for seats
   * that became orders). Re-delivery / already-settled orders are a no-op.
   */
  async execute(input: ExpireOrderInput): Promise<void> {
    const result = await this.repo.markExpiredIfPending(input.orderId);
    if (!result.changed) {
      return;
    }

    for (const seatId of result.seatIds) {
      await this.seatHold.releaseHold(result.eventId, seatId, result.userId);
    }
    await this.repo.expireSeatLockAudit(result.seatIds, result.userId);

    this.logger.log(
      `Order ${input.orderId} expired; released ${result.seatIds.length} seat hold(s)`,
    );
  }
}
