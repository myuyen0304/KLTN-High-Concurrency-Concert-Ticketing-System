import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';
import {
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
} from './dto/ticket-type.dto';
import { TicketTypesService } from './ticket-types.service';

@Controller()
export class TicketTypesController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

  // UC16a — Thêm loại vé cho sự kiện
  @Post('events/:eventId/ticket-types')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('eventId') eventId: string,
    @Body() dto: CreateTicketTypeDto,
  ) {
    return this.ticketTypesService.create(user.sub, eventId, dto);
  }

  // UC16b — Cập nhật loại vé
  @Patch('ticket-types/:id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.ticketTypesService.update(user.sub, id, dto);
  }

  // UC16c — Xóa loại vé (chỉ khi chưa có vé bán)
  @Delete('ticket-types/:id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ticketTypesService.remove(user.sub, id);
  }

  // UC16c AF — Ẩn loại vé (khi đã có vé bán)
  @Patch('ticket-types/:id/hide')
  hide(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ticketTypesService.hide(user.sub, id);
  }
}
