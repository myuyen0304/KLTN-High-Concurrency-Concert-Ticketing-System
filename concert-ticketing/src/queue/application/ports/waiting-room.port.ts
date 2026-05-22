export const WAITING_ROOM_PORT = Symbol('WAITING_ROOM_PORT');

export interface WaitingRoomConfig {
  eventId: string;
  maxConcurrent: number;
  bookingWindow: number;
}

export interface WaitingRoomPort {
  /** Open room for the event, or null if missing/closed. */
  getOpenRoom(eventId: string): Promise<WaitingRoomConfig | null>;

  /** All currently open waiting rooms (admission scheduler iterates these). */
  listOpenRooms(): Promise<WaitingRoomConfig[]>;
}
