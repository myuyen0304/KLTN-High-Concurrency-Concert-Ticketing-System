export class QueueEntryEntity {
  readonly userId: string;
  readonly eventId: string;
  readonly position: number;
  readonly joinedAt: Date;

  private constructor(props: {
    userId: string;
    eventId: string;
    position: number;
    joinedAt: Date;
  }) {
    this.userId = props.userId;
    this.eventId = props.eventId;
    this.position = props.position;
    this.joinedAt = props.joinedAt;
  }

  static create(
    userId: string,
    eventId: string,
    position: number,
  ): QueueEntryEntity {
    return new QueueEntryEntity({
      userId,
      eventId,
      position,
      joinedAt: new Date(),
    });
  }
}
