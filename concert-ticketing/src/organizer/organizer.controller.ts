import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';
import {
  OrderListQueryDto,
  UpdateOrganizerProfileDto,
} from './dto/organizer.dto';
import { OrganizerService } from './organizer.service';

@Controller('organizer')
export class OrganizerController {
  constructor(private readonly organizerService: OrganizerService) {}

  // UC19 — Xem hồ sơ nhà tổ chức
  @Get('profile')
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.organizerService.getProfile(user.sub);
  }

  // UC19 — Cập nhật hồ sơ nhà tổ chức
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateOrganizerProfileDto,
  ) {
    return this.organizerService.updateProfile(user.sub, dto);
  }

  // UC15a — Danh sách đơn hàng của sự kiện
  @Get('events/:eventId/orders')
  listOrders(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Query() query: OrderListQueryDto,
  ) {
    return this.organizerService.listOrders(user.sub, eventId, query);
  }

  // UC15b — Chi tiết đơn hàng
  @Get('orders/:orderId')
  getOrder(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    return this.organizerService.getOrder(user.sub, orderId);
  }

  // UC18 — Thống kê bán vé / doanh thu
  @Get('events/:eventId/stats')
  getStats(@CurrentUser() user: JwtPayload, @Param('eventId') eventId: string) {
    return this.organizerService.getStats(user.sub, eventId);
  }
}
