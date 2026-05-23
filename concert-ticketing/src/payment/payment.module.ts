import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { MockSignatureAdapter } from './adapters/mock-signature.adapter';
import { PrismaPaymentAdapter } from './adapters/prisma-payment.adapter';
import { PrismaTicketAdapter } from './adapters/prisma-ticket.adapter';
import { RabbitmqTicketAdapter } from './adapters/rabbitmq-ticket.adapter';
import { SeatFinalizerAdapter } from './adapters/seat-finalizer.adapter';
import { HandleCallbackUseCase } from './application/handle-callback.use-case';
import { InitiatePaymentUseCase } from './application/initiate-payment.use-case';
import { IssueTicketsUseCase } from './application/issue-tickets.use-case';
import { PAYMENT_REPOSITORY_PORT } from './application/ports/payment-repository.port';
import { SEAT_FINALIZER_PORT } from './application/ports/seat-finalizer.port';
import { SIGNATURE_VERIFIER_PORT } from './application/ports/signature-verifier.port';
import { TICKET_PUBLISHER_PORT } from './application/ports/ticket-publisher.port';
import { TICKET_REPOSITORY_PORT } from './application/ports/ticket-repository.port';
import { PaymentController } from './payment.controller';
import { TicketIssuanceConsumer } from './ticket/ticket-issuance.consumer';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  controllers: [PaymentController],
  providers: [
    InitiatePaymentUseCase,
    HandleCallbackUseCase,
    IssueTicketsUseCase,
    TicketIssuanceConsumer,
    { provide: PAYMENT_REPOSITORY_PORT, useClass: PrismaPaymentAdapter },
    { provide: SEAT_FINALIZER_PORT, useClass: SeatFinalizerAdapter },
    { provide: TICKET_PUBLISHER_PORT, useClass: RabbitmqTicketAdapter },
    { provide: TICKET_REPOSITORY_PORT, useClass: PrismaTicketAdapter },
    { provide: SIGNATURE_VERIFIER_PORT, useClass: MockSignatureAdapter },
  ],
  exports: [HandleCallbackUseCase, IssueTicketsUseCase],
})
export class PaymentModule {}
