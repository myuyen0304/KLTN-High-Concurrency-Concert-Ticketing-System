import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { RedisSeatLockAdapter } from '../../booking/seat-lock/adapters/redis-seat-lock.adapter';
import { SeatFinalizerPort } from '../application/ports/seat-finalizer.port';

// Same release Lua as seat-lock: DEL the lock + SREM both held-sets, but only if
// still owned by the user. Owner check makes it idempotent (returns 0, no error)
// when the lock is already gone — exactly what the AF2 re-drive path needs.
const RELEASE_LUA = `
local owner = redis.call('GET', KEYS[1])
if not owner or owner ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
redis.call('SREM', KEYS[3], ARGV[2])
return 1
`;

@Injectable()
export class SeatFinalizerAdapter implements SeatFinalizerPort {
  constructor(private readonly redis: RedisService) {}

  async releaseLocks(
    eventId: string,
    seatIds: string[],
    userId: string,
  ): Promise<void> {
    for (const seatId of seatIds) {
      const keys = [
        RedisSeatLockAdapter.lockKey(eventId, seatId),
        RedisSeatLockAdapter.userSetKey(eventId, userId),
        RedisSeatLockAdapter.eventSetKey(eventId),
      ];
      await this.redis.eval(RELEASE_LUA, keys, [userId, seatId]);
    }
  }
}
