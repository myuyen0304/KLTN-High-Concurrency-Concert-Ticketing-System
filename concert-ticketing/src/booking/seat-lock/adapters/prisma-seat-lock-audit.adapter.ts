import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SeatLockEntity } from '../domain/seat-lock.entity';
import { SeatLockAuditPort } from '../application/ports/seat-lock-audit.port';

@Injectable()
export class PrismaSeatLockAuditAdapter implements SeatLockAuditPort {
  constructor(private readonly prisma: PrismaService) {}

  async recordAcquired(entity: SeatLockEntity): Promise<SeatLockEntity> {
    const row = await this.prisma.seatLock.create({
      data: {
        seatId: entity.seatId,
        userId: entity.userId,
        expiresAt: entity.expiresAt,
        status: 'ACTIVE',
      },
    });
    entity.id = row.id;
    return entity;
  }

  async recordReleased(seatId: string, userId: string): Promise<void> {
    await this.prisma.seatLock.updateMany({
      where: { seatId, userId, status: 'ACTIVE' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  }

  async findActive(
    seatId: string,
    userId: string,
  ): Promise<SeatLockEntity | null> {
    const row = await this.prisma.seatLock.findFirst({
      where: { seatId, userId, status: 'ACTIVE' },
      orderBy: { lockedAt: 'desc' },
    });
    if (!row) return null;
    return SeatLockEntity.fromPersistence({
      id: row.id,
      seatId: row.seatId,
      userId: row.userId,
      eventId: '',
      expiresAt: row.expiresAt,
      status: 'ACTIVE',
    });
  }
}
