export const QUEUE_STORE_PORT = Symbol('QUEUE_STORE_PORT');

export interface JoinResult {
  /** 0-based rank in the FIFO queue. */
  rank: number;
  /** Total people waiting. */
  total: number;
}

export interface QueueStatus {
  admitted: boolean;
  /** Seconds left on the admission token; valid when admitted. */
  ttlSeconds: number;
  /** 0-based FIFO rank; valid when not admitted, -1 if not in the queue. */
  rank: number;
}

export interface AdmitInput {
  eventId: string;
  cap: number;
  ttlSeconds: number;
}

export interface QueueStorePort {
  /** Add user to the FIFO queue (idempotent); returns current rank + total. */
  join(eventId: string, userId: string): Promise<JoinResult>;

  /** Read whether the user holds a live token, else their queue rank. */
  getStatus(eventId: string, userId: string): Promise<QueueStatus>;

  /** Admission cycle: lazy-clean expired, then admit up to cap. Returns admitted userIds in FIFO order. */
  admit(input: AdmitInput): Promise<string[]>;
}
