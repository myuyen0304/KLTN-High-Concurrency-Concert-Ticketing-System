import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, SeatStatus, TicketModelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSeatMapDto,
  CreateZoneDto,
  UpdateSeatMapDto,
} from './dto/seat.dto';

const MUTABLE_EVENT_STATUSES: EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.PENDING_APPROVAL,
  EventStatus.REJECTED,
];

@Injectable()
export class SeatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── UC17a: Tạo sơ đồ ghế SEAT_MAP ──────────────────────────────────────

  async createSeatMap(
    organizerId: string,
    eventId: string,
    dto: CreateSeatMapDto,
  ) {
    const event = await this.assertEventOwnerAndStatus(organizerId, eventId);

    if (event.ticketModel) {
      throw new BadRequestException(
        'Sự kiện đã có mô hình vé. Dùng endpoint chỉnh sửa.',
      );
    }

    // Verify tất cả ticketTypeId thuộc event này
    const ticketTypeIds = [...new Set(dto.sections.map((s) => s.ticketTypeId))];
    await this.assertTicketTypesOwnership(eventId, ticketTypeIds);

    const seats = await this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: { ticketModel: TicketModelType.SEAT_MAP },
      });

      const allSeats = [];
      for (const section of dto.sections) {
        const rowPrefix = section.rowPrefix ?? '';
        for (let row = 1; row <= section.rows; row++) {
          const rowLabel = rowPrefix
            ? `${rowPrefix}${row}`
            : String.fromCharCode(64 + row); // A, B, C...

          for (let num = 1; num <= section.seatsPerRow; num++) {
            allSeats.push({
              eventId,
              ticketTypeId: section.ticketTypeId,
              row: rowLabel,
              number: String(num),
              label: `${rowLabel}${num}`,
              status: SeatStatus.AVAILABLE,
            });
          }
        }
      }

      await tx.seat.createMany({ data: allSeats });

      return tx.seat.findMany({
        where: { eventId },
        select: {
          id: true,
          row: true,
          number: true,
          label: true,
          status: true,
          ticketTypeId: true,
        },
        orderBy: [{ row: 'asc' }, { number: 'asc' }],
      });
    });

    return { total: seats.length, seats };
  }

  // ─── UC17b: Tạo khu vực ZONE ─────────────────────────────────────────────

  async createZones(organizerId: string, eventId: string, dto: CreateZoneDto) {
    const event = await this.assertEventOwnerAndStatus(organizerId, eventId);

    if (event.ticketModel) {
      throw new BadRequestException(
        'Sự kiện đã có mô hình vé. Dùng endpoint chỉnh sửa.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: { ticketModel: TicketModelType.ZONE },
      });

      await tx.zone.createMany({
        data: dto.zones.map((z) => ({
          eventId,
          name: z.name,
          capacity: z.capacity,
          ticketTypeId: z.ticketTypeId,
        })),
      });

      return tx.zone.findMany({ where: { eventId } });
    });

    return result;
  }

  // ─── UC17c: Chỉnh sửa (chỉ cho thêm, không cho xóa ghế đang bán) ────────

  async updateLayout(
    organizerId: string,
    eventId: string,
    dto: UpdateSeatMapDto,
  ) {
    const event = await this.assertEventOwnerAndStatus(organizerId, eventId);

    if (!event.ticketModel) {
      throw new BadRequestException('Sự kiện chưa có sơ đồ ghế / khu vực');
    }

    const results: Record<string, unknown> = {};

    if (dto.addSections && dto.addSections.length > 0) {
      if (event.ticketModel !== TicketModelType.SEAT_MAP) {
        throw new BadRequestException('Sự kiện không dùng mô hình SEAT_MAP');
      }
      const ticketTypeIds = [
        ...new Set(dto.addSections.map((s) => s.ticketTypeId)),
      ];
      await this.assertTicketTypesOwnership(eventId, ticketTypeIds);

      const newSeats = [];
      for (const section of dto.addSections) {
        const rowPrefix = section.rowPrefix ?? '';
        for (let row = 1; row <= section.rows; row++) {
          const rowLabel = rowPrefix
            ? `${rowPrefix}${row}`
            : String.fromCharCode(64 + row);
          for (let num = 1; num <= section.seatsPerRow; num++) {
            newSeats.push({
              eventId,
              ticketTypeId: section.ticketTypeId,
              row: rowLabel,
              number: String(num),
              label: `${rowLabel}${num}`,
              status: SeatStatus.AVAILABLE,
            });
          }
        }
      }
      await this.prisma.seat.createMany({ data: newSeats });
      results['addedSeats'] = newSeats.length;
    }

    if (dto.addZones && dto.addZones.length > 0) {
      if (event.ticketModel !== TicketModelType.ZONE) {
        throw new BadRequestException('Sự kiện không dùng mô hình ZONE');
      }
      await this.prisma.zone.createMany({
        data: dto.addZones.map((z) => ({
          eventId,
          name: z.name,
          capacity: z.capacity,
          ticketTypeId: z.ticketTypeId,
        })),
      });
      results['addedZones'] = dto.addZones.length;
    }

    return results;
  }

  // ─── Xem sơ đồ ghế (dùng cho UC06, UC08) ─────────────────────────────────

  async getLayout(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, ticketModel: true },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại');

    if (event.ticketModel === TicketModelType.SEAT_MAP) {
      const seats = await this.prisma.seat.findMany({
        where: { eventId },
        select: {
          id: true,
          row: true,
          number: true,
          label: true,
          status: true,
          ticketTypeId: true,
        },
        orderBy: [{ row: 'asc' }, { number: 'asc' }],
      });
      return { ticketModel: event.ticketModel, seats };
    }

    if (event.ticketModel === TicketModelType.ZONE) {
      const zones = await this.prisma.zone.findMany({
        where: { eventId },
        select: { id: true, name: true, capacity: true, ticketTypeId: true },
      });
      return { ticketModel: event.ticketModel, zones };
    }

    return { ticketModel: null };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async assertEventOwnerAndStatus(
    organizerId: string,
    eventId: string,
  ) {
    const profile = await this.prisma.organizerProfile.findUnique({
      where: { userId: organizerId },
    });
    if (!profile) throw new ForbiddenException('Bạn chưa có hồ sơ nhà tổ chức');

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId: profile.id },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại');

    if (!MUTABLE_EVENT_STATUSES.includes(event.status)) {
      throw new BadRequestException(
        `Không thể chỉnh sửa sơ đồ khi sự kiện ở trạng thái ${event.status}`,
      );
    }

    return event;
  }

  private async assertTicketTypesOwnership(
    eventId: string,
    ticketTypeIds: string[],
  ) {
    const count = await this.prisma.ticketType.count({
      where: { id: { in: ticketTypeIds }, eventId },
    });
    if (count !== ticketTypeIds.length) {
      throw new BadRequestException(
        'Một hoặc nhiều ticketTypeId không thuộc sự kiện này',
      );
    }
  }
}
