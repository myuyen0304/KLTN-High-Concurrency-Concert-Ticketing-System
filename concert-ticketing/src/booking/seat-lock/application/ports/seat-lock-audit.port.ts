import { SeatLockEntity } from '../../domain/seat-lock.entity';

export const SEAT_LOCK_AUDIT_PORT = Symbol('SEAT_LOCK_AUDIT_PORT');

export interface SeatLockAuditPort {
  recordAcquired(entity: SeatLockEntity): Promise<SeatLockEntity>;
  recordReleased(seatId: string, userId: string): Promise<void>;
  findActive(seatId: string, userId: string): Promise<SeatLockEntity | null>;
}
