import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  AdmitInput,
  JoinResult,
  QueueStatus,
  QueueStorePort,
} from '../application/ports/queue-store.port';

// FIFO score = seq (INCR). NOTE: brief proposed `timestamp_ms*1e6+seq`, but a
// ZSET score is an IEEE-754 double; ~1.7e18 exceeds the 2^53 exact-integer range
// and silently drops the seq tie-breaker. INCR is atomic + globally monotonic
// (even across pods), so seq alone is the correct, lossless FIFO key.
const JOIN_LUA = `
local existing = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not existing then
  local seq = redis.call('INCR', KEYS[1])
  redis.call('ZADD', KEYS[2], seq, ARGV[1])
end
local rank = redis.call('ZRANK', KEYS[2], ARGV[1])
local total = redis.call('ZCARD', KEYS[2])
return { rank, total }
`;

// Lazy-clean the active set (tokens expire on their own; the set does not shrink),
// then admit from the FIFO head while a slot is free.
const ADMIT_LUA = `
local cap = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local prefix = ARGV[3]
local members = redis.call('SMEMBERS', KEYS[2])
for i = 1, #members do
  if redis.call('EXISTS', prefix .. members[i]) == 0 then
    redis.call('SREM', KEYS[2], members[i])
  end
end
local admitted = {}
while redis.call('SCARD', KEYS[2]) < cap do
  local popped = redis.call('ZPOPMIN', KEYS[1])
  if #popped == 0 then break end
  local u = popped[1]
  redis.call('SET', prefix .. u, '1', 'EX', ttl)
  redis.call('SADD', KEYS[2], u)
  admitted[#admitted + 1] = u
end
return admitted
`;

const STATUS_LUA = `
local ttl = redis.call('TTL', KEYS[2])
if ttl and ttl > 0 then
  return { 1, ttl }
end
local rank = redis.call('ZRANK', KEYS[1], ARGV[1])
if rank == false then
  return { 0, -1 }
end
return { 0, rank }
`;

@Injectable()
export class RedisQueueStoreAdapter implements QueueStorePort {
  constructor(private readonly redis: RedisService) {}

  static queueKey(eventId: string): string {
    return `queue:event:${eventId}`;
  }
  static seqKey(eventId: string): string {
    return `queue:event:${eventId}:seq`;
  }
  static activeKey(eventId: string): string {
    return `active:event:${eventId}`;
  }
  static tokenKey(eventId: string, userId: string): string {
    return `token:event:${eventId}:user:${userId}`;
  }
  static tokenPrefix(eventId: string): string {
    return `token:event:${eventId}:user:`;
  }

  async join(eventId: string, userId: string): Promise<JoinResult> {
    const raw = (await this.redis.eval(
      JOIN_LUA,
      [
        RedisQueueStoreAdapter.seqKey(eventId),
        RedisQueueStoreAdapter.queueKey(eventId),
      ],
      [userId],
    )) as [number, number];
    return { rank: Number(raw[0]), total: Number(raw[1]) };
  }

  async getStatus(eventId: string, userId: string): Promise<QueueStatus> {
    const raw = (await this.redis.eval(
      STATUS_LUA,
      [
        RedisQueueStoreAdapter.queueKey(eventId),
        RedisQueueStoreAdapter.tokenKey(eventId, userId),
      ],
      [userId],
    )) as [number, number];
    const flag = Number(raw[0]);
    const value = Number(raw[1]);
    if (flag === 1) {
      return { admitted: true, ttlSeconds: value, rank: -1 };
    }
    return { admitted: false, ttlSeconds: -1, rank: value };
  }

  async admit(input: AdmitInput): Promise<string[]> {
    const raw = (await this.redis.eval(
      ADMIT_LUA,
      [
        RedisQueueStoreAdapter.queueKey(input.eventId),
        RedisQueueStoreAdapter.activeKey(input.eventId),
      ],
      [
        String(input.cap),
        String(input.ttlSeconds),
        RedisQueueStoreAdapter.tokenPrefix(input.eventId),
      ],
    )) as string[];
    return raw ?? [];
  }
}
