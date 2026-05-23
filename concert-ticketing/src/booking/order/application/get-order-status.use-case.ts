import { Inject, Injectable } from '@nestjs/common';
import {
  ORDER_REPOSITORY_PORT,
  OrderRepositoryPort,
  OrderStatusView,
} from './ports/order-repository.port';

export interface GetOrderStatusInput {
  orderId: string;
  userId: string;
}

@Injectable()
export class GetOrderStatusUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY_PORT)
    private readonly repo: OrderRepositoryPort,
  ) {}

  async execute(input: GetOrderStatusInput): Promise<OrderStatusView | null> {
    return this.repo.findStatusView(input.orderId, input.userId);
  }
}
