import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { OrderModule } from './booking/order/order.module';
import { SeatLockModule } from './booking/seat-lock/seat-lock.module';
import { PaymentModule } from './payment/payment.module';
import { EventsModule } from './events/events.module';
import { OrganizerModule } from './organizer/organizer.module';
import { SeatsModule } from './seats/seats.module';
import { TicketTypesModule } from './ticket-types/ticket-types.module';
import { UsersModule } from './users/users.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MessagingModule } from './common/messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MessagingModule,
    AuthModule,
    UsersModule,
    EventsModule,
    TicketTypesModule,
    SeatsModule,
    OrganizerModule,
    SeatLockModule,
    OrderModule,
    PaymentModule,
    QueueModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
