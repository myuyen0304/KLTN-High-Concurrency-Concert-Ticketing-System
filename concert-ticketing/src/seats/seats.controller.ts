import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CreateSeatMapDto,
  CreateZoneDto,
  UpdateSeatMapDto,
} from './dto/seat.dto';
import { SeatsService } from './seats.service';

@Controller('events/:eventId/seats')
export class SeatsController {
  constructor(private readonly seatsService: SeatsService) {}

  // UC06, UC08 — Xem sơ đồ ghế / khu vực (@Public cho UC06)
  @Public()
  @Get()
  getLayout(@Param('eventId') eventId: string) {
    return this.seatsService.getLayout(eventId);
  }

  // UC17a — Tạo SEAT_MAP
  @Post('seat-map')
  createSeatMap(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreateSeatMapDto,
  ) {
    return this.seatsService.createSeatMap(user.sub, eventId, dto);
  }

  // UC17b — Tạo ZONE
  @Post('zone')
  createZones(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.seatsService.createZones(user.sub, eventId, dto);
  }

  // UC17c — Chỉnh sửa (chỉ thêm ghế/zone)
  @Patch()
  updateLayout(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateSeatMapDto,
  ) {
    return this.seatsService.updateLayout(user.sub, eventId, dto);
  }
}
