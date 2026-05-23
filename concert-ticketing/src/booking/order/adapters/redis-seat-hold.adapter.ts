import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { RedisSeatLockAdapter } from '../../seat-lock/adapters/redis-seat-lock.adapter';
import {
  SeatHoldPort,
  VerifyHeldResult,
} from '../application/ports/seat-hold.port';

// KEYS = one lock key per seat. ARGV[1] = userId.
// Returns 0 if every lock is owned by userId, else the 1-based index of the
// first seat that is missing / owned by someone else.
const VERIFY_LUA = `
for i = 1, #KEYS do
  local owner = redis.call('GET', KEYS[i])
  if not owner or owner ~= ARGV[1] then return i end
end
return 0
`;

// KEYS = one lock key per seat. ARGV[1] = userId, ARGV[2] = ttlSeconds.
// Re-verifies ownership of ALL seats first; only then resets each TTL. Atomic.
// Returns 1 on success, 0 if any seat is no longer owned by userId.
const EXTEND_LUA = `
for i = 1, #KEYS do
  local owner = redis.call('GET', KEYS[i])
  if not owner or owner ~= ARGV[1] then return 0 end
end
for i = 1, #KEYS do
  redis.call('EXPIRE', KEYS[i], tonumber(ARGV[2]))
end
return 1
`;

// KEYS = [lockKey, userSetKey, eventSetKey]. ARGV = [userId, seatId].
const RELEASE_LUA = `
local owner = redis.call('GET', KEYS[1])
if not owner or owner ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
redis.call('SREM', KEYS[3], ARGV[2])
return 1
`;

@Injectable()
export class RedisSeatHoldAdapter implements SeatHoldPort {
  constructor(private readonly redis: RedisService) {}

  private lockKeys(eventId: string, seatIds: string[]): string[] {
    return seatIds.map((seatId) =>
      RedisSeatLockAdapter.lockKey(eventId, seatId),
    );
  }

  async verifyHeld(
    eventId: string,
    seatIds: string[],
    userId: string,
  ): Promise<VerifyHeldResult> {
    const raw = await this.redis.eval(
      VERIFY_LUA,
      this.lockKeys(eventId, seatIds),
      [userId],
    );
    const code = Number(raw);
    if (code === 0) return { ok: true, failedSeatId: null };
    return { ok: false, failedSeatId: seatIds[code - 1] };
  }

  async extendHold(
    eventId: string,
    seatIds: string[],
    userId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const raw = await this.redis.eval(
      EXTEND_LUA,
      this.lockKeys(eventId, seatIds),
      [userId, String(ttlSeconds)],
    );
    return Number(raw) === 1;
  }

  async releaseHold(
    eventId: string,
    seatId: string,
    userId: string,
  ): Promise<void> {
    const keys = [
      RedisSeatLockAdapter.lockKey(eventId, seatId),
      RedisSeatLockAdapter.userSetKey(eventId, userId),
      RedisSeatLockAdapter.eventSetKey(eventId),
    ];
    await this.redis.eval(RELEASE_LUA, keys, [userId, seatId]);
  }
}
