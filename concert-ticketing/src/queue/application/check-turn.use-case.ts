import { Inject, Injectable } from '@nestjs/common';
import { EntryToken } from '../domain/entry-token.value-object';
import { QUEUE_STORE_PORT, QueueStorePort } from './ports/queue-store.port';

export interface CheckTurnInput {
  userId: string;
  eventId: string;
}

export type CheckTurnOutput =
  | { admitted: true; expiresAt: Date }
  | { admitted: false; position: number };

@Injectable()
export class CheckTurnUseCase {
  constructor(
    @Inject(QUEUE_STORE_PORT)
    private readonly store: QueueStorePort,
  ) {}

  async execute(input: CheckTurnInput): Promise<CheckTurnOutput> {
    const status = await this.store.getStatus(input.eventId, input.userId);
    if (status.admitted) {
      const token = EntryToken.issue(
        input.userId,
        input.eventId,
        status.ttlSeconds,
      );
      return { admitted: true, expiresAt: token.expiresAt };
    }
    // rank < 0 means the user is not in the queue → report position 0.
    const position = status.rank >= 0 ? status.rank + 1 : 0;
    return { admitted: false, position };
  }
}
