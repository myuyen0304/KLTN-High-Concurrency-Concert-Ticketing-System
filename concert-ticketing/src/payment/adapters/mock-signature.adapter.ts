import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentCallback,
  SignatureVerifierPort,
} from '../application/ports/signature-verifier.port';

const DEFAULT_SECRET = 'mock-callback-secret';

/**
 * Mock gateway signature: HMAC-SHA256 over the immutable callback fields. Real
 * gateways (VNPay, etc.) sign similarly; swapping this adapter is the only
 * change needed to integrate a live gateway (decision #6).
 */
@Injectable()
export class MockSignatureAdapter implements SignatureVerifierPort {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('PAYMENT_CALLBACK_SECRET', DEFAULT_SECRET);
  }

  static sign(
    secret: string,
    callback: Omit<PaymentCallback, 'signature'>,
  ): string {
    const base = `${callback.orderId}|${callback.gatewayTxId ?? ''}|${callback.outcome}`;
    return createHmac('sha256', secret).update(base).digest('hex');
  }

  verify(callback: PaymentCallback): boolean {
    const expected = MockSignatureAdapter.sign(this.secret, callback);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(callback.signature ?? '');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}
