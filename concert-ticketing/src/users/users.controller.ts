import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';
import {
  RequestEmailChangeDto,
  UpdateProfileDto,
  VerifyEmailChangeDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // UC04 — Xem profile
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.usersService.getProfile(user.sub);
  }

  // UC04 — Cập nhật profile
  @Patch('me')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  // UC04 AF — Yêu cầu đổi email (gửi OTP đến email mới)
  @Post('me/change-email')
  @HttpCode(HttpStatus.OK)
  requestEmailChange(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.usersService.requestEmailChange(user.sub, dto);
  }

  // UC04 AF — Xác nhận OTP để hoàn tất đổi email
  @Post('me/verify-email-change')
  @HttpCode(HttpStatus.OK)
  verifyEmailChange(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyEmailChangeDto,
  ) {
    return this.usersService.verifyEmailChange(user.sub, dto);
  }
}
