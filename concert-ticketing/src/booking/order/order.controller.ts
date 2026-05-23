import {
  Body,
  ConflictException,
  Controller,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { CreateOrderUseCase } from './application/create-order.use-case';
import { OrderEntity } from './domain/order.entity';
import {
  IdempotencyKeyConflictError,
  OrderKeyConsumedError,
  SeatHoldExpiredError,
  SeatNotPriceableError,
} from './domain/order.errors';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('order')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly createOrderUseCase: CreateOrderUseCase) {}

  @Post()
  @ApiOperation({ summary: 'UC10 — Create a PENDING order from held seats' })
  @ApiResponse({
    status: 201,
    description: '{ orderId, status, totalAmount, expiresAt }',
  })
  @ApiResponse({
    status: 200,
    description: 'Idempotent replay of an existing PENDING order',
  })
  @ApiResponse({
    status: 409,
    description: 'ORDER_KEY_CONSUMED | IDEMPOTENCY_KEY_CONFLICT',
  })
  @ApiResponse({
    status: 422,
    description: 'SEAT_HOLD_EXPIRED | SEAT_NOT_PRICEABLE',
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { order, replayed } = await this.createOrderUseCase.execute({
        userId: user.sub,
        eventId: dto.eventId,
        seatIds: dto.seatIds,
        idempotencyKey: dto.idempotencyKey,
      });
      res.status(replayed ? 200 : 201);
      return this.toResponse(order);
    } catch (err) {
      if (
        err instanceof SeatHoldExpiredError ||
        err instanceof SeatNotPriceableError
      ) {
        throw new UnprocessableEntityException({
          code: err.code,
          message: err.message,
        });
      }
      if (
        err instanceof OrderKeyConsumedError ||
        err instanceof IdempotencyKeyConflictError
      ) {
        throw new ConflictException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  private toResponse(order: OrderEntity) {
    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      expiresAt: order.expiresAt,
    };
  }
}
