export const SEAT_HOLD_PORT = Symbol('SEAT_HOLD_PORT');

export interface VerifyHeldResult {
  ok: boolean;
  failedSeatId: string | null;
}

export interface SeatHoldPort {
  /** Read-only: every seat lock exists and is owned by `userId`. */
  verifyHeld(
    eventId: string,
    seatIds: string[],
    userId: string,
  ): Promise<VerifyHeldResult>;

  /**
   * Atomically re-verify ownership of all seats then reset their lock TTL to
   * `ttlSeconds` (single Lua). Returns false if any seat is no longer owned.
   */
  extendHold(
    eventId: string,
    seatIds: string[],
    userId: string,
    ttlSeconds: number,
  ): Promise<boolean>;

  /** Release one seat lock + held-set membership (cleanup on timeout). */
  releaseHold(eventId: string, seatId: string, userId: string): Promise<void>;
}
