import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid', description: 'Event the seats belong to' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Seats already held by the user (UC09 locks)',
  })
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  seatIds!: string[];

  @ApiProperty({
    description: 'Client-supplied idempotency key for this order',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey!: string;
}
