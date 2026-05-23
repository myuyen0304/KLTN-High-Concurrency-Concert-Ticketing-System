import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { PrismaOrderAdapter } from './adapters/prisma-order.adapter';
import { RabbitmqExpirationAdapter } from './adapters/rabbitmq-expiration.adapter';
import { RedisSeatHoldAdapter } from './adapters/redis-seat-hold.adapter';
import { CreateOrderUseCase } from './application/create-order.use-case';
import { ExpireOrderUseCase } from './application/expire-order.use-case';
import { EXPIRATION_PUBLISHER_PORT } from './application/ports/expiration-publisher.port';
import { ORDER_REPOSITORY_PORT } from './application/ports/order-repository.port';
import { SEAT_HOLD_PORT } from './application/ports/seat-hold.port';
import { OrderController } from './order.controller';
import { OrderTimeoutConsumer } from './timeout/order-timeout.consumer';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  controllers: [OrderController],
  providers: [
    CreateOrderUseCase,
    ExpireOrderUseCase,
    OrderTimeoutConsumer,
    { provide: ORDER_REPOSITORY_PORT, useClass: PrismaOrderAdapter },
    { provide: SEAT_HOLD_PORT, useClass: RedisSeatHoldAdapter },
    { provide: EXPIRATION_PUBLISHER_PORT, useClass: RabbitmqExpirationAdapter },
  ],
  exports: [CreateOrderUseCase, ExpireOrderUseCase],
})
export class OrderModule {}
