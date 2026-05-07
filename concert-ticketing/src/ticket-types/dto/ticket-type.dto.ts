import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTicketTypeDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsDateString()
  saleStartTime: string;

  @IsDateString()
  saleEndTime: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateTicketTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  saleStartTime?: string;

  @IsOptional()
  @IsDateString()
  saleEndTime?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Không cho sửa price nếu đã có giao dịch — check ở service
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  // Không rút ngắn quantity nếu đã có vé bán — check ở service
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
