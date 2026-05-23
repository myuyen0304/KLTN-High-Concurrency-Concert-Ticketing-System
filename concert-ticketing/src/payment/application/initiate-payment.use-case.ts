import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderNotFoundError,
  OrderNotPayableError,
} from '../domain/payment.errors';
import {
  PAYMENT_REPOSITORY_PORT,
  PaymentRepositoryPort,
} from './ports/payment-repository.port';

export interface InitiatePaymentInput {
  orderId: string;
  userId: string;
}

export interface InitiatePaymentOutput {
  redirectUrl: string;
}

const DEFAULT_GATEWAY_URL = 'http://localhost:3000/mock-gateway';

@Injectable()
export class InitiatePaymentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY_PORT)
    private readonly repo: PaymentRepositoryPort,
    private readonly config: ConfigService,
  ) {}

  async execute(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const view = await this.repo.findForInitiation(input.orderId, input.userId);
    if (!view) {
      throw new OrderNotFoundError(input.orderId);
    }
    if (view.status !== 'PENDING') {
      throw new OrderNotPayableError(input.orderId, view.status);
    }
    const base = this.config.get<string>(
      'MOCK_PAYMENT_GATEWAY_URL',
      DEFAULT_GATEWAY_URL,
    );
    const redirectUrl = `${base}?orderId=${encodeURIComponent(
      input.orderId,
    )}&amount=${encodeURIComponent(view.amount)}`;
    return { redirectUrl };
  }
}
