import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CreateEventDto,
  EventListQueryDto,
  UpdateEventDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  // UC05 — Tìm kiếm sự kiện (@Public)
  @Public()
  @Get()
  listPublic(@Query() query: EventListQueryDto) {
    return this.eventsService.listPublic(query);
  }

  // UC06 — Xem chi tiết sự kiện (@Public)
  @Public()
  @Get(':id')
  getPublicDetail(@Param('id') id: string) {
    return this.eventsService.getPublicDetail(id);
  }

  // UC14a — Tạo sự kiện mới (Organizer)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user.sub, dto);
  }

  // UC14b — Cập nhật sự kiện (Organizer)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(user.sub, id, dto);
  }

  // UC14a/14b — Gửi duyệt
  @Post(':id/submit')
  submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.eventsService.submit(user.sub, id);
  }
}
