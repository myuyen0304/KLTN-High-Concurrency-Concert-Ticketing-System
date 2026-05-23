import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaymentOutcome } from '../application/ports/signature-verifier.port';

export class PaymentCallbackDto {
  @ApiProperty({ format: 'uuid', description: 'Order the payment is for' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    required: false,
    description: "Gateway's transaction reference",
  })
  @IsOptional()
  @IsString()
  gatewayTxId?: string;

  @ApiProperty({ enum: ['SUCCESS', 'FAILED'] })
  @IsIn(['SUCCESS', 'FAILED'])
  outcome!: PaymentOutcome;

  @ApiProperty({
    description: 'HMAC signature over orderId|gatewayTxId|outcome',
  })
  @IsString()
  @IsNotEmpty()
  signature!: string;
}
