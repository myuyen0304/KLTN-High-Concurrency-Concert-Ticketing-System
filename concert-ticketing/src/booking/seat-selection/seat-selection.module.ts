import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { SeatMapQueryService } from './seat-map-query.service';
import { SeatSelectionController } from './seat-selection.controller';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [SeatSelectionController],
  providers: [SeatMapQueryService],
})
export class SeatSelectionModule {}
