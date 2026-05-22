import { Inject, Injectable } from '@nestjs/common';
import { QueueClosedError } from '../domain/queue.errors';
import { QUEUE_STORE_PORT, QueueStorePort } from './ports/queue-store.port';
import { WAITING_ROOM_PORT, WaitingRoomPort } from './ports/waiting-room.port';

export interface JoinQueueInput {
  userId: string;
  eventId: string;
}

export interface JoinQueueOutput {
  position: number;
  estimatedWaitSec: number;
}

@Injectable()
export class JoinQueueUseCase {
  constructor(
    @Inject(QUEUE_STORE_PORT)
    private readonly store: QueueStorePort,
    @Inject(WAITING_ROOM_PORT)
    private readonly rooms: WaitingRoomPort,
  ) {}

  async execute(input: JoinQueueInput): Promise<JoinQueueOutput> {
    const room = await this.rooms.getOpenRoom(input.eventId);
    if (!room) {
      throw new QueueClosedError(input.eventId);
    }

    const { rank } = await this.store.join(input.eventId, input.userId);
    const position = rank + 1;
    const estimatedWaitSec =
      Math.ceil(position / room.maxConcurrent) * room.bookingWindow;

    return { position, estimatedWaitSec };
  }
}
