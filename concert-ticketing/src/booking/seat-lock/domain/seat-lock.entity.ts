export type SeatLockEntityStatus = 'ACTIVE' | 'RELEASED' | 'EXPIRED';

export class SeatLockEntity {
  id: string | null;
  readonly seatId: string;
  readonly userId: string;
  readonly eventId: string;
  readonly expiresAt: Date;
  status: SeatLockEntityStatus;

  private constructor(props: {
    id: string | null;
    seatId: string;
    userId: string;
    eventId: string;
    expiresAt: Date;
    status: SeatLockEntityStatus;
  }) {
    this.id = props.id;
    this.seatId = props.seatId;
    this.userId = props.userId;
    this.eventId = props.eventId;
    this.expiresAt = props.expiresAt;
    this.status = props.status;
  }

  static newActive(
    seatId: string,
    userId: string,
    eventId: string,
    ttlSeconds: number,
  ): SeatLockEntity {
    return new SeatLockEntity({
      id: null,
      seatId,
      userId,
      eventId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      status: 'ACTIVE',
    });
  }

  static fromPersistence(props: {
    id: string;
    seatId: string;
    userId: string;
    eventId: string;
    expiresAt: Date;
    status: SeatLockEntityStatus;
  }): SeatLockEntity {
    return new SeatLockEntity(props);
  }

  release(): void {
    this.status = 'RELEASED';
  }
}
