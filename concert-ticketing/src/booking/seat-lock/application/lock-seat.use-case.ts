import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SeatLockEntity } from '../domain/seat-lock.entity';
import {
  SeatTakenError,
  TicketLimitReachedError,
} from '../domain/seat-lock.errors';
import {
  SEAT_LOCK_AUDIT_PORT,
  SeatLockAuditPort,
} from './ports/seat-lock-audit.port';
import {
  SEAT_LOCK_EXECUTION_PORT,
  SeatLockExecutionPort,
} from './ports/seat-lock-execution.port';

export interface LockSeatInput {
  userId: string;
  eventId: string;
  seatId: string;
}

export interface LockSeatOutput {
  lockId: string | null;
  seatId: string;
  expiresAt: Date;
}

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_MAX_PER_USER = 4;

@Injectable()
export class LockSeatUseCase {
  private readonly logger = new Logger(LockSeatUseCase.name);

  constructor(
    @Inject(SEAT_LOCK_EXECUTION_PORT)
    private readonly execution: SeatLockExecutionPort,
    @Inject(SEAT_LOCK_AUDIT_PORT)
    private readonly audit: SeatLockAuditPort,
    private readonly config: ConfigService,
  ) {}

  async execute(input: LockSeatInput): Promise<LockSeatOutput> {
    const ttlSeconds = DEFAULT_TTL_SECONDS;
    const maxPerUser = Number(
      this.config.get('MAX_SEATS_PER_USER', DEFAULT_MAX_PER_USER),
    );

    const result = await this.execution.acquire({
      eventId: input.eventId,
      seatId: input.seatId,
      userId: input.userId,
      ttlSeconds,
      maxPerUser,
    });

    if (result === 'SEAT_TAKEN') {
      throw new SeatTakenError(input.seatId);
    }
    if (result === 'LIMIT') {
      throw new TicketLimitReachedError(input.userId, maxPerUser);
    }

    if (result === 'OK_REHOLD') {
      const existing = await this.audit.findActive(input.seatId, input.userId);
      if (existing) {
        return {
          lockId: existing.id,
          seatId: existing.seatId,
          expiresAt: existing.expiresAt,
        };
      }
      // Redis says we own the lock but no audit row found — fall through to
      // create one (Redis is source of truth for ownership).
    }

    const entity = SeatLockEntity.newActive(
      input.seatId,
      input.userId,
      input.eventId,
      ttlSeconds,
    );

    try {
      const persisted = await this.audit.recordAcquired(entity);
      return {
        lockId: persisted.id,
        seatId: persisted.seatId,
        expiresAt: persisted.expiresAt,
      };
    } catch (err) {
      this.logger.warn(
        `Audit write failed for seat ${input.seatId} (user ${input.userId}); Redis TTL will reclaim. err=${(err as Error).message}`,
      );
      return {
        lockId: null,
        seatId: entity.seatId,
        expiresAt: entity.expiresAt,
      };
    }
  }
}
