import { Inject, Injectable, Logger } from '@nestjs/common';
import { QUEUE_STORE_PORT, QueueStorePort } from './ports/queue-store.port';
import { WAITING_ROOM_PORT, WaitingRoomPort } from './ports/waiting-room.port';

@Injectable()
export class AdmissionUseCase {
  private readonly logger = new Logger(AdmissionUseCase.name);

  constructor(
    @Inject(QUEUE_STORE_PORT)
    private readonly store: QueueStorePort,
    @Inject(WAITING_ROOM_PORT)
    private readonly rooms: WaitingRoomPort,
  ) {}

  /** One admission cycle across every open waiting room. */
  async execute(): Promise<void> {
    const rooms = await this.rooms.listOpenRooms();
    for (const room of rooms) {
      await this.admitForEvent(room.eventId);
    }
  }

  /** Admit for a single event; returns the userIds admitted this cycle. */
  async admitForEvent(eventId: string): Promise<string[]> {
    const room = await this.rooms.getOpenRoom(eventId);
    if (!room) return [];

    const admitted = await this.store.admit({
      eventId,
      cap: room.maxConcurrent,
      ttlSeconds: room.bookingWindow,
    });

    if (admitted.length > 0) {
      this.logger.log(
        `Admitted ${admitted.length} user(s) for event ${eventId}`,
      );
    }
    return admitted;
  }
}
