import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SeatMapConfigDto {
  @IsInt()
  @Min(1)
  rows: number;

  @IsInt()
  @Min(1)
  seatsPerRow: number;

  @IsOptional()
  @IsString()
  rowPrefix?: string; // ví dụ: 'A', 'B', 'C'...

  @IsUUID()
  ticketTypeId: string;
}

export class CreateSeatMapDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatMapConfigDto)
  sections: SeatMapConfigDto[];
}

export class ZoneConfigDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsOptional()
  @IsUUID()
  ticketTypeId?: string;
}

export class CreateZoneDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ZoneConfigDto)
  zones: ZoneConfigDto[];
}

export class UpdateSeatMapDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatMapConfigDto)
  addSections?: SeatMapConfigDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ZoneConfigDto)
  addZones?: ZoneConfigDto[];
}
