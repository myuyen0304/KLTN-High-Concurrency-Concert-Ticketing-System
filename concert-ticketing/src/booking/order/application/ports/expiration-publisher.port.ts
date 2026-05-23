export const EXPIRATION_PUBLISHER_PORT = Symbol('EXPIRATION_PUBLISHER_PORT');

export interface ExpirationPublisherPort {
  /**
   * Schedule an auto-cancel for the order via the shared fixed-TTL delay
   * exchange. Fires after BOOKING_WINDOW_SECONDS (the delay.q TTL).
   */
  publishExpiration(orderId: string): Promise<void>;
}
