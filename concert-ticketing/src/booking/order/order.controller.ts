import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { GetOrderStatusUseCase } from './application/get-order-status.use-case';
import { OrderEntity } from './domain/order.entity';
import {
  OrderKeyConsumedError,
  SeatHoldExpiredError,
  SeatNotPriceableError,
} from './domain/order.errors';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('order')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(
    private readonly createOrderUseCase: CreateOrderUseCase,
    private readonly getOrderStatusUseCase: GetOrderStatusUseCase,
  ) {}

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
    description: 'ORDER_KEY_CONSUMED',
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
      if (err instanceof OrderKeyConsumedError) {
        throw new ConflictException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  @Get(':orderId/status')
  @ApiOperation({
    summary: 'UC11 — Poll order status for the confirmation page',
  })
  @ApiResponse({
    status: 200,
    description: '{ status, totalAmount, ticketsIssued }',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async status(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const view = await this.getOrderStatusUseCase.execute({
      orderId,
      userId: user.sub,
    });
    if (!view) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    return view;
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
