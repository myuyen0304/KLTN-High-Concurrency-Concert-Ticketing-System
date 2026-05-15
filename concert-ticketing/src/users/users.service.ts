import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { RoleName, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  RequestEmailChangeDto,
  UpdateProfileDto,
  VerifyEmailChangeDto,
} from './dto/user.dto';

const EMAIL_CHANGE_OTP_TTL = 300; // 5 phút
const EMAIL_CHANGE_OTP_MAX_ATTEMPTS = 3;
const EMAIL_CHANGE_LOCK_TTL = 900; // 15 phút

export interface UserProfileResponse {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  roles: RoleName[];
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── UC04: Xem profile ────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfileResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });

    if (!user) throw new NotFoundException('Người dùng không tồn tại');

    return {
      ...user,
      roles: user.roles.map((ur) => ur.role.name),
    };
  }

  // ─── UC04: Cập nhật profile ───────────────────────────────────────────────

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileResponse> {
    const data: { fullName?: string; phone?: string; avatarUrl?: string } = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Không có trường nào được cập nhật');
    }

    await this.prisma.user.update({ where: { id: userId }, data });

    // DB first — ghi audit log trước khi return
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_PROFILE',
        resource: 'users',
        resourceId: userId,
      },
    });

    return this.getProfile(userId);
  }

  // ─── UC04 AF: Yêu cầu đổi email (bước 1) ────────────────────────────────

  async requestEmailChange(
    userId: string,
    dto: RequestEmailChangeDto,
  ): Promise<{ message: string }> {
    const lockKey = `otp:email-change:${userId}:lock`;
    const locked = await this.redis.exists(lockKey);
    if (locked) {
      throw new HttpException(
        'Đổi email bị tạm khóa. Vui lòng thử lại sau 15 phút.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Email mới phải unique (BR10)
    const conflict = await this.prisma.user.findUnique({
      where: { email: dto.newEmail },
    });
    if (conflict) throw new ConflictException('Email này đã được sử dụng');

    const otp = randomInt(100000, 1000000).toString();
    // Lưu: newEmail|otp|attempts (dùng | vì email không chứa ký tự này)
    await this.redis.set(
      `otp:email-change:${userId}`,
      `${dto.newEmail}|${otp}|0`,
      EMAIL_CHANGE_OTP_TTL,
    );

    // TODO: gửi email đến dto.newEmail
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV OTP email-change] ${dto.newEmail} → ${otp}`);
    }

    return { message: 'OTP xác nhận đã được gửi đến email mới.' };
  }

  // ─── UC04 AF: Xác nhận đổi email (bước 2) ───────────────────────────────

  async verifyEmailChange(
    userId: string,
    dto: VerifyEmailChangeDto,
  ): Promise<{ message: string }> {
    const lockKey = `otp:email-change:${userId}:lock`;
    const locked = await this.redis.exists(lockKey);
    if (locked) {
      throw new HttpException(
        'Đổi email bị tạm khóa. Vui lòng thử lại sau 15 phút.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const stored = await this.redis.get(`otp:email-change:${userId}`);
    if (!stored)
      throw new BadRequestException('OTP không hợp lệ hoặc đã hết hạn');

    const [newEmail, code, attemptsStr] = stored.split('|');
    const attempts = parseInt(attemptsStr, 10);

    if (dto.otp !== code) {
      const newAttempts = attempts + 1;
      if (newAttempts >= EMAIL_CHANGE_OTP_MAX_ATTEMPTS) {
        await this.redis.del(`otp:email-change:${userId}`);
        await this.redis.set(lockKey, '1', EMAIL_CHANGE_LOCK_TTL);
        throw new HttpException(
          'OTP sai quá nhiều lần. Vui lòng yêu cầu đổi email mới sau 15 phút.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const remainingTtl = await this.redis.ttl(`otp:email-change:${userId}`);
      await this.redis.set(
        `otp:email-change:${userId}`,
        `${newEmail}|${code}|${newAttempts}`,
        remainingTtl > 0 ? remainingTtl : EMAIL_CHANGE_OTP_TTL,
      );
      throw new UnauthorizedException(
        `OTP không đúng. Còn ${EMAIL_CHANGE_OTP_MAX_ATTEMPTS - newAttempts} lần thử.`,
      );
    }

    // Kiểm tra lại email mới vẫn còn unique (phòng race condition)
    const conflict = await this.prisma.user.findUnique({
      where: { email: newEmail },
    });
    if (conflict) {
      await this.redis.del(`otp:email-change:${userId}`);
      throw new ConflictException(
        'Email này đã được sử dụng bởi tài khoản khác',
      );
    }

    // DB first → Redis second
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: newEmail },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'CHANGE_EMAIL',
        resource: 'users',
        resourceId: userId,
        metadata: { newEmail },
      },
    });

    await this.redis.del(`otp:email-change:${userId}`);

    return { message: 'Đổi email thành công.' };
  }
}
