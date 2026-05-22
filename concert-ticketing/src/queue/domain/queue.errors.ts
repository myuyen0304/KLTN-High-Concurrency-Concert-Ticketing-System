export const QUEUE_ERROR_CODES = {
  QUEUE_CLOSED: 'QUEUE_CLOSED',
} as const;

export class QueueClosedError extends Error {
  readonly code = QUEUE_ERROR_CODES.QUEUE_CLOSED;
  constructor(eventId: string) {
    super(`Waiting room for event ${eventId} is not open`);
    this.name = 'QueueClosedError';
  }
}
