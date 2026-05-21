export const SEAT_LOCK_ERROR_CODES = {
  SEAT_TAKEN: 'SEAT_TAKEN',
  TICKET_LIMIT_REACHED: 'TICKET_LIMIT_REACHED',
} as const;

export class SeatTakenError extends Error {
  readonly code = SEAT_LOCK_ERROR_CODES.SEAT_TAKEN;
  constructor(seatId: string) {
    super(`Seat ${seatId} is already locked by another user`);
    this.name = 'SeatTakenError';
  }
}

export class TicketLimitReachedError extends Error {
  readonly code = SEAT_LOCK_ERROR_CODES.TICKET_LIMIT_REACHED;
  constructor(userId: string, max: number) {
    super(`User ${userId} reached the seat hold limit of ${max}`);
    this.name = 'TicketLimitReachedError';
  }
}
