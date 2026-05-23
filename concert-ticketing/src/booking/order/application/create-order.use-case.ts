import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderEntity } from '../domain/order.entity';
import {
  DuplicateOrderError,
  IdempotencyKeyConflictError,
  OrderKeyConsumedError,
  SeatHoldExpiredError,
} from '../domain/order.errors';
import {
  ORDER_REPOSITORY_PORT,
  OrderRepositoryPort,
} from './ports/order-repository.port';
import { SEAT_HOLD_PORT, SeatHoldPort } from './ports/seat-hold.port';
import {
  EXPIRATION_PUBLISHER_PORT,
  ExpirationPublisherPort,
} from './ports/expiration-publisher.port';

export interface CreateOrderInput {
  userId: string;
  eventId: string;
  seatIds: string[];
  idempotencyKey: string;
}

export interface CreateOrderOutput {
  order: OrderEntity;
  replayed: boolean;
}

const DEFAULT_BOOKING_WINDOW_SECONDS = 900;

@Injectable()
export class CreateOrderUseCase {
  private readonly logger = new Logger(CreateOrderUseCase.name);

  constructor(
    @Inject(ORDER_REPOSITORY_PORT)
    private readonly repo: OrderRepositoryPort,
    @Inject(SEAT_HOLD_PORT)
    private readonly seatHold: SeatHoldPort,
    @Inject(EXPIRATION_PUBLISHER_PORT)
    private readonly expiration: ExpirationPublisherPort,
    private readonly config: ConfigService,
  ) {}

  async execute(input: CreateOrderInput): Promise<CreateOrderOutput> {
    const { userId, eventId, seatIds, idempotencyKey } = input;
    const ttlSeconds = Number(
      this.config.get('BOOKING_WINDOW_SECONDS', DEFAULT_BOOKING_WINDOW_SECONDS),
    );

    // 1. Read-only ownership check (fail fast, no DB write).
    const verify = await this.seatHold.verifyHeld(eventId, seatIds, userId);
    if (!verify.ok) {
      throw new SeatHoldExpiredError(verify.failedSeatId ?? seatIds[0]);
    }

    // 2. Price the seats (throws SeatNotPriceableError on null ticket type).
    const pricing = await this.repo.loadSeatPricing(eventId, seatIds);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // 3. DB INSERT first; TTL-sync (Redis write) runs INSIDE the same tx so a
    //    lost hold rolls the order back (rule 5.1 #3). 4. publish only on commit.
    try {
      const order = await this.repo.create(
        { userId, eventId, idempotencyKey, expiresAt, items: pricing },
        async () => {
          const extended = await this.seatHold.extendHold(
            eventId,
            seatIds,
            userId,
            ttlSeconds,
          );
          if (!extended) {
            throw new SeatHoldExpiredError(seatIds.join(','));
          }
        },
      );
      await this.expiration.publishExpiration(order.id);
      return { order, replayed: false };
    } catch (err) {
      if (err instanceof DuplicateOrderError) {
        return this.resolveReplay(idempotencyKey, userId);
      }
      throw err;
    }
  }

  /** AF1: idempotencyKey already used → replay if same user + still PENDING. */
  private async resolveReplay(
    idempotencyKey: string,
    userId: string,
  ): Promise<CreateOrderOutput> {
    const existing = await this.repo.findByIdempotencyKey(idempotencyKey);
    if (!existing) {
      // Lost the unique race but the row vanished (cancelled+pruned) — extremely
      // rare; treat as a fresh conflict so the client retries with a new key.
      throw new OrderKeyConsumedError('unknown', 'GONE');
    }
    if (!existing.isOwnedBy(userId)) {
      throw new IdempotencyKeyConflictError();
    }
    if (!existing.isPending()) {
      throw new OrderKeyConsumedError(existing.id, existing.status);
    }
    this.logger.debug(
      `Idempotent replay for key ${idempotencyKey} → order ${existing.id}`,
    );
    return { order: existing, replayed: true };
  }
}
