import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PrismaWaitingRoomAdapter } from './adapters/prisma-waiting-room.adapter';
import { RedisQueueStoreAdapter } from './adapters/redis-queue-store.adapter';
import { AdmissionUseCase } from './application/admission.use-case';
import { CheckTurnUseCase } from './application/check-turn.use-case';
import { JoinQueueUseCase } from './application/join-queue.use-case';
import { QUEUE_STORE_PORT } from './application/ports/queue-store.port';
import { WAITING_ROOM_PORT } from './application/ports/waiting-room.port';
import { QueueAdmissionScheduler } from './queue.admission.scheduler';
import { QueueController } from './queue.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [QueueController],
  providers: [
    JoinQueueUseCase,
    AdmissionUseCase,
    CheckTurnUseCase,
    QueueAdmissionScheduler,
    { provide: QUEUE_STORE_PORT, useClass: RedisQueueStoreAdapter },
    { provide: WAITING_ROOM_PORT, useClass: PrismaWaitingRoomAdapter },
  ],
  exports: [JoinQueueUseCase, AdmissionUseCase, CheckTurnUseCase],
})
export class QueueModule {}
