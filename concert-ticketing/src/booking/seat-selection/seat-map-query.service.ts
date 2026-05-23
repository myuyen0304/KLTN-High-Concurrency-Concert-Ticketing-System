import { Injectable, NotFoundException } from '@nestjs/common';
import { SeatStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RedisSeatLockAdapter } from '../seat-lock/adapters/redis-seat-lock.adapter';

export type SeatViewStatus = 'AVAILABLE' | 'HELD' | 'SOLD';

export interface SeatView {
  seatId: string;
  row: string | null;
  number: string | null;
  label: string | null;
  status: SeatViewStatus;
}

// Read the event held-set, then keep only members whose per-seat lock key is
// still alive. An abandoned hold whose TTL lapsed leaves a stale member in the
// set (UC09's SREM only runs on explicit release, not on expiry) — filtering by
// lock-key liveness stops us reporting such a seat as HELD. One round trip, no
// SCAN/KEYS, and read-only: cleanup of stale members stays in the seat-lock
// module so two modules never write the same set.
// NOTE: builds lock keys inside the script — safe on standalone Redis only.
const LIVE_HELD_LUA = `
local members = redis.call('SMEMBERS', KEYS[1])
local live = {}
for i = 1, #members do
  if redis.call('EXISTS', ARGV[1] .. members[i]) == 1 then
    live[#live + 1] = members[i]
  end
end
return live
`;

@Injectable()
export class SeatMapQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getSeatMap(eventId: string): Promise<SeatView[]> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại');

    const [seats, liveHeld] = await Promise.all([
      this.prisma.seat.findMany({
        where: { eventId },
        select: {
          id: true,
          row: true,
          number: true,
          label: true,
          status: true,
        },
        orderBy: [{ row: 'asc' }, { number: 'asc' }],
      }),
      this.liveHeldSeatIds(eventId),
    ]);

    return seats.map((seat) => ({
      seatId: seat.id,
      row: seat.row,
      number: seat.number,
      label: seat.label,
      status:
        seat.status === SeatStatus.SOLD
          ? 'SOLD'
          : liveHeld.has(seat.id)
            ? 'HELD'
            : 'AVAILABLE',
    }));
  }

  private async liveHeldSeatIds(eventId: string): Promise<Set<string>> {
    const raw = await this.redis.eval(
      LIVE_HELD_LUA,
      [RedisSeatLockAdapter.eventSetKey(eventId)],
      [RedisSeatLockAdapter.lockKey(eventId, '')],
    );
    return new Set((raw as string[]) ?? []);
  }
}
