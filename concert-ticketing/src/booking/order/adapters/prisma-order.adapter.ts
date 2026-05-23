import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderEntity } from '../domain/order.entity';
import {
  DuplicateOrderError,
  SeatNotPriceableError,
} from '../domain/order.errors';
import {
  CreateOrderData,
  ExpireResult,
  OrderRepositoryPort,
  OrderStatusView,
  SeatPricing,
} from '../application/ports/order-repository.port';

@Injectable()
export class PrismaOrderAdapter implements OrderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadSeatPricing(
    eventId: string,
    seatIds: string[],
  ): Promise<SeatPricing[]> {
    const seats = await this.prisma.seat.findMany({
      where: { id: { in: seatIds }, eventId },
      select: {
        id: true,
        ticketTypeId: true,
        ticketType: { select: { price: true } },
      },
    });
    const byId = new Map(seats.map((s) => [s.id, s]));
    return seatIds.map((seatId) => {
      const seat = byId.get(seatId);
      if (!seat || !seat.ticketTypeId || !seat.ticketType) {
        throw new SeatNotPriceableError(seatId);
      }
      return {
        seatId,
        ticketTypeId: seat.ticketTypeId,
        unitPrice: seat.ticketType.price.toString(),
      };
    });
  }

  async create(
    data: CreateOrderData,
    confirmHold: () => Promise<void>,
  ): Promise<OrderEntity> {
    const totalAmount = data.items.reduce(
      (acc, item) => acc.add(new Prisma.Decimal(item.unitPrice)),
      new Prisma.Decimal(0),
    );

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId: data.userId,
            eventId: data.eventId,
            idempotencyKey: data.idempotencyKey,
            status: 'PENDING',
            totalAmount,
            expiresAt: data.expiresAt,
            orderItems: {
              create: data.items.map((item) => ({
                seatId: item.seatId,
                ticketTypeId: item.ticketTypeId,
                unitPrice: new Prisma.Decimal(item.unitPrice),
              })),
            },
          },
        });
        // Redis TTL-sync runs INSIDE the tx: if the hold is gone, this throws
        // and the whole order INSERT rolls back (rule 5.1 #3 compensation).
        await confirmHold();
        return order;
      });
      return this.toEntity(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new DuplicateOrderError(data.idempotencyKey);
      }
      throw err;
    }
  }

  async findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<OrderEntity | null> {
    const row = await this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    });
    return row ? this.toEntity(row) : null;
  }

  async markExpiredIfPending(orderId: string): Promise<ExpireResult> {
    const updated = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { select: { seatId: true } } },
    });
    if (!order) {
      return { changed: false, userId: '', eventId: '', seatIds: [] };
    }
    const seatIds = order.orderItems
      .map((item) => item.seatId)
      .filter((id): id is string => id !== null);
    return {
      changed: updated.count === 1,
      userId: order.userId,
      eventId: order.eventId,
      seatIds,
    };
  }

  async expireSeatLockAudit(seatIds: string[], userId: string): Promise<void> {
    if (seatIds.length === 0) return;
    await this.prisma.seatLock.updateMany({
      where: { seatId: { in: seatIds }, userId, status: 'ACTIVE' },
      data: { status: 'EXPIRED', releasedAt: new Date() },
    });
  }

  async findStatusView(
    orderId: string,
    userId: string,
  ): Promise<OrderStatusView | null> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        status: true,
        totalAmount: true,
        _count: { select: { orderItems: true, tickets: true } },
      },
    });
    if (!order) return null;
    return {
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      ticketsIssued:
        order._count.orderItems > 0 &&
        order._count.tickets >= order._count.orderItems,
    };
  }

  private toEntity(row: {
    id: string;
    userId: string;
    eventId: string;
    status: string;
    totalAmount: Prisma.Decimal;
    expiresAt: Date;
  }): OrderEntity {
    return new OrderEntity({
      id: row.id,
      userId: row.userId,
      eventId: row.eventId,
      status: row.status as OrderEntity['status'],
      totalAmount: row.totalAmount.toString(),
      expiresAt: row.expiresAt,
    });
  }
}
