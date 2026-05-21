import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  SEAT_LOCK_AUDIT_PORT,
  SeatLockAuditPort,
} from './ports/seat-lock-audit.port';
import {
  SEAT_LOCK_EXECUTION_PORT,
  SeatLockExecutionPort,
} from './ports/seat-lock-execution.port';

export interface ReleaseSeatInput {
  userId: string;
  eventId: string;
  seatId: string;
}

@Injectable()
export class ReleaseSeatUseCase {
  private readonly logger = new Logger(ReleaseSeatUseCase.name);

  constructor(
    @Inject(SEAT_LOCK_EXECUTION_PORT)
    private readonly execution: SeatLockExecutionPort,
    @Inject(SEAT_LOCK_AUDIT_PORT)
    private readonly audit: SeatLockAuditPort,
  ) {}

  async execute(input: ReleaseSeatInput): Promise<void> {
    const released = await this.execution.release(input);
    if (!released) {
      throw new ForbiddenException(
        'You do not own a lock on this seat (or it has expired)',
      );
    }

    try {
      await this.audit.recordReleased(input.seatId, input.userId);
    } catch (err) {
      this.logger.warn(
        `Audit release update failed for seat ${input.seatId} (user ${input.userId}). err=${(err as Error).message}`,
      );
    }
  }
}
