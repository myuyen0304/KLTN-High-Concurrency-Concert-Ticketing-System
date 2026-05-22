import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from './queue.module';

// BR10: only authenticated users may join the queue. The global JwtAuthGuard
// (same one used app-wide) must reject a request with no Bearer token.
describe('Queue auth (UC07 / BR10)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PassportModule,
        RedisModule,
        QueueModule,
      ],
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects join without a JWT (401)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/queue/${randomUUID()}/join`)
      .send();
    expect(res.status).toBe(401);
  });
});
