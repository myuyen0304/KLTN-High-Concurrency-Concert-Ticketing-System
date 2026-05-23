import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FinalizeResult,
  InitiationView,
  MarkPaidInput,
  PaymentRepositoryPort,
  RefundInput,
} from '../application/ports/payment-repository.port';

const MOCK_GATEWAY = 'MOCK';

@Injectable()
export class PrismaPaymentAdapter implements PaymentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findForInitiation(
    orderId: string,
    userId: string,
  ): Promise<InitiationView | null> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { status: true, totalAmount: true },
    });
    if (!order) return null;
    return { status: order.status, amount: order.totalAmount.toString() };
  }

  async markPaidAndFinalize(input: MarkPaidInput): Promise<FinalizeResult> {
    return this.prisma.$transaction(async (tx) => {
      // Compare-and-set: the ONLY write that decides PENDING → PAID. The
      // expiresAt guard closes the "pay after the window already lapsed but the
      // EXPIRED DLE has not fired yet" race.
      const updated = await tx.order.updateMany({
        where: {
          id: input.orderId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        data: { status: 'PAID' },
      });

      // Load the order + its seats regardless of the CAS outcome — the AF2
      // duplicate path needs eventId/userId/seatIds to re-drive side-effects.
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: {
          eventId: true,
          userId: true,
          status: true,
          totalAmount: true,
          orderItems: { select: { seatId: true } },
        },
      });

      if (!order) {
        return {
          decided: false,
          currentStatus: 'GONE',
          eventId: '',
          userId: '',
          seatIds: [],
        };
      }

      const seatIds = order.orderItems
        .map((item) => item.seatId)
        .filter((id): id is string => id !== null);

      if (updated.count !== 1) {
        return {
          decided: false,
          currentStatus: order.status,
          eventId: order.eventId,
          userId: order.userId,
          seatIds,
        };
      }

      // We flipped PENDING → PAID. Record the transaction + mark every seat SOLD
      // in the SAME tx, so the order can never be PAID without these committed.
      await tx.paymentTransaction.create({
        data: {
          orderId: input.orderId,
          idempotencyKey: input.orderId,
          gateway: MOCK_GATEWAY,
          gatewayTxId: input.gatewayTxId,
          amount: order.totalAmount,
          status: 'SUCCESS',
          callbackPayload: input.callbackPayload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      if (seatIds.length > 0) {
        await tx.seat.updateMany({
          where: { id: { in: seatIds } },
          data: { status: 'SOLD' },
        });
      }

      return {
        decided: true,
        currentStatus: 'PAID',
        eventId: order.eventId,
        userId: order.userId,
        seatIds,
      };
    });
  }

  async recordRefundedIfAbsent(input: RefundInput): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      select: { totalAmount: true },
    });
    if (!order) return;
    try {
      await this.prisma.paymentTransaction.create({
        data: {
          orderId: input.orderId,
          idempotencyKey: input.orderId,
          gateway: MOCK_GATEWAY,
          gatewayTxId: input.gatewayTxId,
          amount: order.totalAmount,
          status: 'REFUNDED',
          callbackPayload: input.callbackPayload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
    } catch (err) {
      // A transaction row already exists for this order (duplicate EX1 callback
      // or a prior SUCCESS) → idempotent no-op.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }
}
