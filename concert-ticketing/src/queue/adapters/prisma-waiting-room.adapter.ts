import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WaitingRoomConfig,
  WaitingRoomPort,
} from '../application/ports/waiting-room.port';

@Injectable()
export class PrismaWaitingRoomAdapter implements WaitingRoomPort {
  constructor(private readonly prisma: PrismaService) {}

  async getOpenRoom(eventId: string): Promise<WaitingRoomConfig | null> {
    const row = await this.prisma.waitingRoom.findUnique({
      where: { eventId },
    });
    if (!row || !row.isOpen) return null;
    return {
      eventId: row.eventId,
      maxConcurrent: row.maxConcurrent,
      bookingWindow: row.bookingWindow,
    };
  }

  async listOpenRooms(): Promise<WaitingRoomConfig[]> {
    const rows = await this.prisma.waitingRoom.findMany({
      where: { isOpen: true },
      select: { eventId: true, maxConcurrent: true, bookingWindow: true },
    });
    return rows;
  }
}
