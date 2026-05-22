export class EntryToken {
  readonly userId: string;
  readonly eventId: string;
  readonly expiresAt: Date;

  private constructor(userId: string, eventId: string, expiresAt: Date) {
    this.userId = userId;
    this.eventId = eventId;
    this.expiresAt = expiresAt;
  }

  /** Build from the remaining seconds reported by the store (Redis TTL). */
  static issue(
    userId: string,
    eventId: string,
    ttlSeconds: number,
  ): EntryToken {
    return new EntryToken(
      userId,
      eventId,
      new Date(Date.now() + ttlSeconds * 1000),
    );
  }
}
