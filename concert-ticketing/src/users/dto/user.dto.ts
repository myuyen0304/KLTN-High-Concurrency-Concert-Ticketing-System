import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

export class RequestEmailChangeDto {
  @IsEmail({}, { message: 'Email mới không hợp lệ' })
  newEmail: string;
}

export class VerifyEmailChangeDto {
  @Length(6, 6, { message: 'OTP phải gồm 6 chữ số' })
  @IsString()
  otp: string;
}
