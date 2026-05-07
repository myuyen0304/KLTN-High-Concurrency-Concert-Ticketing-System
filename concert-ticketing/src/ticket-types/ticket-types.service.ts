import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
} from './dto/ticket-type.dto';

// Chỉ tạo/sửa ticket-type khi event chưa được duyệt (BR12)
const MUTABLE_EVENT_STATUSES: EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.PENDING_APPROVAL,
  EventStatus.REJECTED,
];

@Injectable()
export class TicketTypesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── UC16a: Thêm loại vé ─────────────────────────────────────────────────

  async create(organizerId: string, eventId: string, dto: CreateTicketTypeDto) {
    await this.assertEventOwnerAndStatus(
      organizerId,
      eventId,
      MUTABLE_EVENT_STATUSES,
    );

    const ticketType = await this.prisma.ticketType.create({
      data: {
        eventId,
        name: dto.name,
        price: dto.price,
        quantity: dto.quantity,
        saleStartTime: new Date(dto.saleStartTime),
        saleEndTime: new Date(dto.saleEndTime),
        description: dto.description,
      },
    });

    return ticketType;
  }

  // ─── UC16b: Cập nhật loại vé ─────────────────────────────────────────────

  async update(
    organizerId: string,
    ticketTypeId: string,
    dto: UpdateTicketTypeDto,
  ) {
    const ticketType = await this.findOwnedTicketType(
      organizerId,
      ticketTypeId,
    );

    // Không đổi giá nếu đã có giao dịch (sold > 0)
    if (dto.price !== undefined && ticketType.sold > 0) {
      throw new BadRequestException(
        'Không thể thay đổi giá vé khi đã có vé bán ra',
      );
    }

    // Không rút ngắn quantity xuống dưới sold
    if (dto.quantity !== undefined && dto.quantity < ticketType.sold) {
      throw new BadRequestException(
        `Số lượng không thể nhỏ hơn số đã bán (${ticketType.sold})`,
      );
    }

    const data: Prisma.TicketTypeUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.saleStartTime !== undefined)
      data.saleStartTime = new Date(dto.saleStartTime);
    if (dto.saleEndTime !== undefined)
      data.saleEndTime = new Date(dto.saleEndTime);
    if (dto.description !== undefined) data.description = dto.description;

    return this.prisma.ticketType.update({
      where: { id: ticketTypeId },
      data,
    });
  }

  // ─── UC16c: Xóa hoặc ẩn loại vé ─────────────────────────────────────────

  async remove(organizerId: string, ticketTypeId: string) {
    const ticketType = await this.findOwnedTicketType(
      organizerId,
      ticketTypeId,
    );

    if (ticketType.sold > 0) {
      throw new BadRequestException(
        'Đã có vé bán ra. Dùng endpoint /hide để ẩn loại vé thay vì xóa.',
      );
    }

    await this.prisma.ticketType.delete({ where: { id: ticketTypeId } });
    return { message: 'Đã xóa loại vé' };
  }

  async hide(organizerId: string, ticketTypeId: string) {
    await this.findOwnedTicketType(organizerId, ticketTypeId);

    return this.prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: { isHidden: true },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async assertEventOwnerAndStatus(
    organizerId: string,
    eventId: string,
    allowedStatuses: EventStatus[],
  ) {
    const profile = await this.prisma.organizerProfile.findUnique({
      where: { userId: organizerId },
    });
    if (!profile) throw new ForbiddenException('Bạn chưa có hồ sơ nhà tổ chức');

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId: profile.id },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại');

    if (!allowedStatuses.includes(event.status)) {
      throw new BadRequestException(
        `Không thể thực hiện thao tác này khi sự kiện ở trạng thái ${event.status}`,
      );
    }

    return event;
  }

  private async findOwnedTicketType(organizerId: string, ticketTypeId: string) {
    const profile = await this.prisma.organizerProfile.findUnique({
      where: { userId: organizerId },
    });
    if (!profile) throw new ForbiddenException('Bạn chưa có hồ sơ nhà tổ chức');

    const ticketType = await this.prisma.ticketType.findFirst({
      where: {
        id: ticketTypeId,
        event: { organizerId: profile.id },
      },
    });
    if (!ticketType) throw new NotFoundException('Loại vé không tồn tại');

    return ticketType;
  }
}
