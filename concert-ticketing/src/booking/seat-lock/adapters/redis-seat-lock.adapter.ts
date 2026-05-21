import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import {
  AcquireInput,
  AcquireResult,
  ReleaseInput,
  SeatLockExecutionPort,
} from '../application/ports/seat-lock-execution.port';

const ACQUIRE_LUA = `
local owner = redis.call('GET', KEYS[1])
if owner then
  if owner == ARGV[1] then return 2 end
  return -1
end
if redis.call('SCARD', KEYS[2]) >= tonumber(ARGV[3]) then
  return -2
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('SADD', KEYS[2], ARGV[4])
redis.call('SADD', KEYS[3], ARGV[4])
return 1
`;

const RELEASE_LUA = `
local owner = redis.call('GET', KEYS[1])
if not owner or owner ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
redis.call('SREM', KEYS[3], ARGV[2])
return 1
`;

@Injectable()
export class RedisSeatLockAdapter implements SeatLockExecutionPort {
  constructor(private readonly redis: RedisService) {}

  static lockKey(eventId: string, seatId: string): string {
    return `lock:event:${eventId}:seat:${seatId}`;
  }
  static userSetKey(eventId: string, userId: string): string {
    return `held:event:${eventId}:user:${userId}`;
  }
  static eventSetKey(eventId: string): string {
    return `held:event:${eventId}`;
  }

  async acquire(input: AcquireInput): Promise<AcquireResult> {
    const keys = [
      RedisSeatLockAdapter.lockKey(input.eventId, input.seatId),
      RedisSeatLockAdapter.userSetKey(input.eventId, input.userId),
      RedisSeatLockAdapter.eventSetKey(input.eventId),
    ];
    const args = [
      input.userId,
      String(input.ttlSeconds),
      String(input.maxPerUser),
      input.seatId,
    ];
    const raw = await this.redis.eval(ACQUIRE_LUA, keys, args);
    const code = Number(raw);
    if (code === 1) return 'OK';
    if (code === 2) return 'OK_REHOLD';
    if (code === -1) return 'SEAT_TAKEN';
    if (code === -2) return 'LIMIT';
    throw new Error(`Unexpected acquire result from Redis: ${String(raw)}`);
  }

  async release(input: ReleaseInput): Promise<boolean> {
    const keys = [
      RedisSeatLockAdapter.lockKey(input.eventId, input.seatId),
      RedisSeatLockAdapter.userSetKey(input.eventId, input.userId),
      RedisSeatLockAdapter.eventSetKey(input.eventId),
    ];
    const args = [input.userId, input.seatId];
    const raw = await this.redis.eval(RELEASE_LUA, keys, args);
    return Number(raw) === 1;
  }
}
