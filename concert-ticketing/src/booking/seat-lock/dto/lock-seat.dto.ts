import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LockSeatDto {
  @ApiProperty({ format: 'uuid', description: 'Event the seat belongs to' })
  @IsUUID()
  eventId!: string;
}
