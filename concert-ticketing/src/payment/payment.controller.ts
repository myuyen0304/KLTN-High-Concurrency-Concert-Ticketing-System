import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { HandleCallbackUseCase } from './application/handle-callback.use-case';
import { InitiatePaymentUseCase } from './application/initiate-payment.use-case';
import {
  InvalidSignatureError,
  OrderNotFoundError,
  OrderNotPayableError,
} from './domain/payment.errors';
import { PaymentCallbackDto } from './dto/payment-callback.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(
    private readonly initiatePayment: InitiatePaymentUseCase,
    private readonly handleCallback: HandleCallbackUseCase,
  ) {}

  @Post(':orderId/initiate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'UC11 — Initiate payment, redirect to the gateway' })
  @ApiResponse({ status: 201, description: '{ redirectUrl }' })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ORDER_NOT_PAYABLE' })
  async initiate(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<{ redirectUrl: string }> {
    try {
      return await this.initiatePayment.execute({ orderId, userId: user.sub });
    } catch (err) {
      if (err instanceof OrderNotFoundError) {
        throw new NotFoundException({ code: err.code, message: err.message });
      }
      if (err instanceof OrderNotPayableError) {
        throw new ConflictException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  @Public()
  @Post('callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gateway callback (verify signature, ACK)' })
  @ApiResponse({ status: 200, description: 'ACK' })
  @ApiResponse({
    status: 400,
    description: 'Invalid callback (e.g. bad signature)',
  })
  async callback(@Body() dto: PaymentCallbackDto): Promise<{ status: string }> {
    try {
      await this.handleCallback.execute({
        orderId: dto.orderId,
        gatewayTxId: dto.gatewayTxId ?? null,
        outcome: dto.outcome,
        signature: dto.signature,
      });
      return { status: 'ok' };
    } catch (err) {
      // EX2: never disclose why verification failed.
      if (err instanceof InvalidSignatureError) {
        throw new BadRequestException({
          code: err.code,
          message: 'Invalid callback',
        });
      }
      throw err;
    }
  }
}
