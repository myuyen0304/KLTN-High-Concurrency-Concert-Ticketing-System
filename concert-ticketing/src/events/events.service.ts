import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEventDto,
  EventListQueryDto,
  SubmitAction,
  UpdateEventDto,
} from './dto/event.dto';

// Các status được phép sửa đầy đủ (chưa mở bán)
const EDITABLE_STATUSES: EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.PENDING_APPROVAL,
  EventStatus.REJECTED,
];

// Fields được phép sửa khi event đã APPROVED (đang bán)
const APPROVED_EDITABLE_FIELDS = [
  'description',
  'bannerUrl',
  'contactEmail',
  'contactPhone',
];

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── UC05: Tìm kiếm sự kiện (@Public) ────────────────────────────────────

  async listPublic(query: EventListQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.EventWhereInput = {
      status: EventStatus.ACTIVE,
    };

    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } },
        { venue: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }
    if (query.category)
      where.category = { equals: query.category, mode: 'insensitive' };
    if (query.location)
      where.venue = { contains: query.location, mode: 'insensitive' };
    if (query.dateFrom) where.startTime = { gte: new Date(query.dateFrom) };
    if (query.dateTo) {
      where.startTime = {
        ...((where.startTime as object) ?? {}),
        lte: new Date(query.dateTo),
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startTime: 'asc' },
        select: this.publicEventSelect(),
      }),
    ]);

    return { total, page, limit, items };
  }

  // ─── UC06: Xem chi tiết sự kiện (@Public) ────────────────────────────────

  async getPublicDetail(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: EventStatus.ACTIVE },
      select: {
        ...this.publicEventSelect(),
        ticketTypes: {
          where: { isHidden: false },
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true,
            sold: true,
            saleStartTime: true,
            saleEndTime: true,
            description: true,
          },
        },
        zones: {
          select: { id: true, name: true, capacity: true },
        },
      },
    });

    if (!event)
      throw new NotFoundException(
        'Sự kiện không tồn tại hoặc chưa được công khai',
      );
    return event;
  }

  // ─── UC14a: Tạo sự kiện (Organizer) ──────────────────────────────────────

  async create(organizerId: string, dto: CreateEventDto) {
    const profile = await this.prisma.organizerProfile.findUnique({
      where: { userId: organizerId },
    });
    if (!profile) {
      throw new ForbiddenException('Bạn chưa có hồ sơ nhà tổ chức');
    }

    const status =
      dto.action === SubmitAction.SUBMIT
        ? EventStatus.PENDING_APPROVAL
        : EventStatus.DRAFT;

    const event = await this.prisma.event.create({
      data: {
        organizerId: profile.id,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        venue: dto.venue,
        bannerUrl: dto.bannerUrl,
        maxTicketsPerUser: dto.maxTicketsPerUser ?? 4,
        status,
      },
      select: this.organizerEventSelect(),
    });

    await this.prisma.auditLog.create({
      data: {
        userId: organizerId,
        action: 'CREATE_EVENT',
        resource: 'events',
        resourceId: event.id,
      },
    });

    return event;
  }

  // ─── UC14b: Cập nhật sự kiện (Organizer) ────────────────────────────────

  async update(organizerId: string, eventId: string, dto: UpdateEventDto) {
    const event = await this.findOwnedEvent(organizerId, eventId);

    const isApproved = event.status === EventStatus.APPROVED;

    if (isApproved) {
      // Khi đang bán: chỉ cho sửa description, bannerUrl
      const disallowedKeys = Object.keys(dto).filter(
        (k) =>
          dto[k as keyof UpdateEventDto] !== undefined &&
          !APPROVED_EDITABLE_FIELDS.includes(k),
      );
      if (disallowedKeys.length > 0) {
        throw new BadRequestException(
          `Sự kiện đang bán không được sửa: ${disallowedKeys.join(', ')}`,
        );
      }
    }

    if (!EDITABLE_STATUSES.includes(event.status) && !isApproved) {
      throw new BadRequestException(
        `Không thể sửa sự kiện ở trạng thái ${event.status}`,
      );
    }

    const data: Prisma.EventUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.startTime !== undefined) data.startTime = new Date(dto.startTime);
    if (dto.endTime !== undefined) data.endTime = new Date(dto.endTime);
    if (dto.venue !== undefined) data.venue = dto.venue;
    if (dto.bannerUrl !== undefined) data.bannerUrl = dto.bannerUrl;
    if (dto.maxTicketsPerUser !== undefined)
      data.maxTicketsPerUser = dto.maxTicketsPerUser;

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data,
      select: this.organizerEventSelect(),
    });

    await this.prisma.auditLog.create({
      data: {
        userId: organizerId,
        action: 'UPDATE_EVENT',
        resource: 'events',
        resourceId: eventId,
      },
    });

    return updated;
  }

  // ─── UC14a/14b: Gửi duyệt ────────────────────────────────────────────────

  async submit(organizerId: string, eventId: string) {
    const event = await this.findOwnedEvent(organizerId, eventId);

    const submittableStatuses: EventStatus[] = [
      EventStatus.DRAFT,
      EventStatus.REJECTED,
    ];
    if (!submittableStatuses.includes(event.status)) {
      throw new BadRequestException(
        `Chỉ gửi duyệt sự kiện ở trạng thái DRAFT hoặc REJECTED`,
      );
    }

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.PENDING_APPROVAL },
      select: this.organizerEventSelect(),
    });

    await this.prisma.auditLog.create({
      data: {
        userId: organizerId,
        action: 'SUBMIT_EVENT',
        resource: 'events',
        resourceId: eventId,
      },
    });

    return updated;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async findOwnedEvent(organizerId: string, eventId: string) {
    const profile = await this.prisma.organizerProfile.findUnique({
      where: { userId: organizerId },
    });
    if (!profile) throw new ForbiddenException('Bạn chưa có hồ sơ nhà tổ chức');

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId: profile.id },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại');
    return event;
  }

  private publicEventSelect() {
    return {
      id: true,
      title: true,
      description: true,
      category: true,
      startTime: true,
      endTime: true,
      venue: true,
      bannerUrl: true,
      status: true,
      maxTicketsPerUser: true,
      createdAt: true,
    } as const;
  }

  private organizerEventSelect() {
    return {
      id: true,
      title: true,
      description: true,
      category: true,
      startTime: true,
      endTime: true,
      venue: true,
      bannerUrl: true,
      status: true,
      ticketModel: true,
      maxTicketsPerUser: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
