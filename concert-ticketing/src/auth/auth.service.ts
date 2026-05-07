import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RoleName, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  LoginDto,
  RegisterDto,
  ResendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';

const OTP_TTL = 300; // 5 phút
const OTP_LOCK_TTL = 900; // 15 phút
const OTP_MAX_ATTEMPTS = 3;
const OTP_MAX_RESENDS = 3;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_TTL = 900; // 15 phút

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
  ) {}

  // ─── UC01 step 1: Đăng ký ────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      if (existing.status === UserStatus.PENDING_VERIFY) {
        // Tài khoản chưa xác thực → gửi lại OTP thay vì báo lỗi
        await this.generateAndStoreOtp(dto.email);
        return {
          message:
            'Tài khoản chưa được xác thực. OTP mới đã được gửi đến email.',
        };
      }
      throw new ConflictException('Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          phone: dto.phone,
          status: UserStatus.PENDING_VERIFY,
        },
      });

      // Tạo role USER nếu chưa có, rồi gán cho user (BR10)
      const userRole = await tx.role.upsert({
        where: { name: RoleName.USER },
        create: { name: RoleName.USER },
        update: {},
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: userRole.id },
      });
    });

    await this.generateAndStoreOtp(dto.email);

    return {
      message:
        'Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản.',
    };
  }

  // ─── UC01 step 2: Xác thực OTP ───────────────────────────────────────────

  async verifyOtp(dto: VerifyOtpDto): Promise<{ message: string }> {
    const otpLocked = await this.redis.exists(`otp:lock:${dto.email}`);
    if (otpLocked) {
      throw new HttpException(
        'Xác thực bị tạm khóa. Vui lòng thử lại sau 15 phút.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const stored = await this.redis.get(`otp:${dto.email}`);
    if (!stored) {
      throw new BadRequestException('OTP không hợp lệ hoặc đã hết hạn');
    }

    const [code, attemptsStr] = stored.split(':');
    const attempts = parseInt(attemptsStr, 10);

    if (dto.otp !== code) {
      const newAttempts = attempts + 1;
      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        await this.redis.del(`otp:${dto.email}`);
        await this.redis.set(`otp:lock:${dto.email}`, '1', OTP_LOCK_TTL);
        throw new HttpException(
          'OTP sai quá nhiều lần. Vui lòng yêu cầu OTP mới sau 15 phút.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const remainingTtl = await this.redis.ttl(`otp:${dto.email}`);
      await this.redis.set(
        `otp:${dto.email}`,
        `${code}:${newAttempts}`,
        remainingTtl > 0 ? remainingTtl : OTP_TTL,
      );
      throw new UnauthorizedException(
        `OTP không đúng. Còn ${OTP_MAX_ATTEMPTS - newAttempts} lần thử.`,
      );
    }

    // OTP đúng → kích hoạt tài khoản (DB trước, Redis sau)
    await this.prisma.user.updateMany({
      where: { email: dto.email, status: UserStatus.PENDING_VERIFY },
      data: { status: UserStatus.ACTIVE },
    });

    await this.redis.del(`otp:${dto.email}`);

    return {
      message: 'Xác thực email thành công. Tài khoản đã được kích hoạt.',
    };
  }

  // ─── UC01 step 3: Gửi lại OTP ────────────────────────────────────────────

  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const otpLocked = await this.redis.exists(`otp:lock:${dto.email}`);
    if (otpLocked) {
      throw new HttpException(
        'Xác thực bị tạm khóa. Vui lòng thử lại sau 15 phút.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.status !== UserStatus.PENDING_VERIFY) {
      // Trả cùng message để tránh email enumeration
      return {
        message:
          'Nếu email tồn tại và chưa được xác thực, OTP mới đã được gửi.',
      };
    }

    const resendKey = `otp:resend:${dto.email}`;
    const resendCount = await this.redis.incr(resendKey);
    if (resendCount === 1) {
      await this.redis.expire(resendKey, OTP_LOCK_TTL);
    }
    if (resendCount > OTP_MAX_RESENDS) {
      await this.redis.set(`otp:lock:${dto.email}`, '1', OTP_LOCK_TTL);
      throw new HttpException(
        'Đã gửi OTP quá nhiều lần. Vui lòng thử lại sau 15 phút.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.generateAndStoreOtp(dto.email);
    return { message: 'OTP mới đã được gửi đến email của bạn.' };
  }

  // ─── UC02: Đăng nhập ──────────────────────────────────────────────────────

  async login(dto: LoginDto, ip?: string): Promise<{ accessToken: string }> {
    const failKey = `login:fail:${dto.email}`;
    const failCountStr = await this.redis.get(failKey);
    const failCount = failCountStr ? parseInt(failCountStr, 10) : 0;

    if (failCount >= LOGIN_MAX_FAILS) {
      throw new HttpException(
        'Đăng nhập bị tạm khóa do sai quá nhiều lần. Vui lòng thử lại sau 15 phút.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { roles: { include: { role: true } } },
    });

    // KHÔNG phân biệt "email không tồn tại" vs "sai password" (BR10)
    const genericError = new UnauthorizedException(
      'Email hoặc mật khẩu không đúng',
    );

    if (!user) {
      await this.incrementLoginFail(failKey);
      throw genericError;
    }

    if (user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException(
        'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.',
      );
    }

    if (user.status === UserStatus.PENDING_VERIFY) {
      throw new UnauthorizedException(
        'Vui lòng xác thực email trước khi đăng nhập.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      await this.incrementLoginFail(failKey);
      throw genericError;
    }

    // Đăng nhập thành công → reset fail counter
    await this.redis.del(failKey);

    const roleNames = user.roles.map((ur) => ur.role.name);
    const jti = randomUUID();

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      jti,
      email: user.email,
      roles: roleNames,
      status: user.status,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    // Ghi audit log (DB first — CLAUDE.md rule)
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        resource: 'auth',
        ipAddress: ip,
      },
    });

    return { accessToken };
  }

  // ─── UC03: Đăng xuất ──────────────────────────────────────────────────────

  async logout(
    userId: string,
    jti: string,
    exp: number,
  ): Promise<{ message: string }> {
    const now = Math.floor(Date.now() / 1000);
    const remainingTtl = exp - now;

    // Blacklist token nếu chưa hết hạn (Redis second — CLAUDE.md rule)
    if (remainingTtl > 0) {
      await this.redis.set(`blacklist:token:${jti}`, '1', remainingTtl);
    }

    // Ghi audit log (DB first — CLAUDE.md rule)
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        resource: 'auth',
      },
    });

    return { message: 'Đăng xuất thành công' };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async generateAndStoreOtp(email: string): Promise<void> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // key format theo docs/redis-keys.md: otp:{email} → {code}:{attempts} TTL 300s
    await this.redis.set(`otp:${email}`, `${otp}:0`, OTP_TTL);

    // TODO: gửi qua email service (nodemailer / SES)
    // Trong môi trường dev: log OTP ra console
    console.log(`[DEV OTP] ${email} → ${otp}`);
  }

  private async incrementLoginFail(failKey: string): Promise<void> {
    const newCount = await this.redis.incr(failKey);
    // Set TTL khi lần fail đầu tiên hoặc khi đạt giới hạn (để đảm bảo lock đủ 15 phút)
    if (newCount === 1 || newCount >= LOGIN_MAX_FAILS) {
      await this.redis.expire(failKey, LOGIN_LOCK_TTL);
    }
  }
}
