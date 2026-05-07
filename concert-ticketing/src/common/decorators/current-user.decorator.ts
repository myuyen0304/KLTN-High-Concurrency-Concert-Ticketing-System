import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RoleName, UserStatus } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  jti: string;
  email: string;
  roles: RoleName[];
  status: UserStatus;
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
