export const SEAT_LOCK_EXECUTION_PORT = Symbol('SEAT_LOCK_EXECUTION_PORT');

export type AcquireResult = 'OK' | 'OK_REHOLD' | 'SEAT_TAKEN' | 'LIMIT';

export interface AcquireInput {
  eventId: string;
  seatId: string;
  userId: string;
  ttlSeconds: number;
  maxPerUser: number;
}

export interface ReleaseInput {
  eventId: string;
  seatId: string;
  userId: string;
}

export interface SeatLockExecutionPort {
  acquire(input: AcquireInput): Promise<AcquireResult>;
  release(input: ReleaseInput): Promise<boolean>;
}
