export type OrderEntityStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

/**
 * A persisted order as seen by the application layer. Money is carried as a
 * decimal string so the use-case never depends on Prisma's Decimal type;
 * only the persistence adapter does Decimal arithmetic.
 */
export class OrderEntity {
  readonly id: string;
  readonly userId: string;
  readonly eventId: string;
  readonly status: OrderEntityStatus;
  readonly totalAmount: string;
  readonly expiresAt: Date;

  constructor(props: {
    id: string;
    userId: string;
    eventId: string;
    status: OrderEntityStatus;
    totalAmount: string;
    expiresAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.eventId = props.eventId;
    this.status = props.status;
    this.totalAmount = props.totalAmount;
    this.expiresAt = props.expiresAt;
  }

  isPending(): boolean {
    return this.status === 'PENDING';
  }

  isOwnedBy(userId: string): boolean {
    return this.userId === userId;
  }
}
