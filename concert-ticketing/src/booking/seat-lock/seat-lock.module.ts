import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { PrismaSeatLockAuditAdapter } from './adapters/prisma-seat-lock-audit.adapter';
import { RedisSeatLockAdapter } from './adapters/redis-seat-lock.adapter';
import { LockSeatUseCase } from './application/lock-seat.use-case';
import { SEAT_LOCK_AUDIT_PORT } from './application/ports/seat-lock-audit.port';
import { SEAT_LOCK_EXECUTION_PORT } from './application/ports/seat-lock-execution.port';
import { ReleaseSeatUseCase } from './application/release-seat.use-case';
import { SeatLockController } from './seat-lock.controller';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  controllers: [SeatLockController],
  providers: [
    LockSeatUseCase,
    ReleaseSeatUseCase,
    { provide: SEAT_LOCK_EXECUTION_PORT, useClass: RedisSeatLockAdapter },
    { provide: SEAT_LOCK_AUDIT_PORT, useClass: PrismaSeatLockAuditAdapter },
  ],
  exports: [LockSeatUseCase, ReleaseSeatUseCase],
})
export class SeatLockModule {}
