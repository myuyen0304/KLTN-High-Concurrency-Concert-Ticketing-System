export const SEAT_FINALIZER_PORT = Symbol('SEAT_FINALIZER_PORT');

export interface SeatFinalizerPort {
  /**
   * Release the Redis hold for each seat AFTER the Postgres tx has committed
   * (DEL lock + SREM held-sets via the seat-lock release Lua). Idempotent: a
   * lock already gone / not owned is a silent no-op, so the AF2 duplicate path
   * can re-run this safely.
   */
  releaseLocks(
    eventId: string,
    seatIds: string[],
    userId: string,
  ): Promise<void>;
}
