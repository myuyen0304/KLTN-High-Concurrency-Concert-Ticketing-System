import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, OrganizerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderListQueryDto,
  UpdateOrganizerProfileDto,
} from './dto/organizer.dto';

@Injectable()
export class OrganizerService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── UC15a: Danh sách đơn hàng của sự kiện ───────────────────────────────

  async listOrders(
    organizerId: string,
    eventId: string,
    query: OrderListQueryDto,
  ) {
    const profile = await this.getOwnedProfile(organizerId);
    await this.assertEventOwner(profile.id, eventId);

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = { eventId };
    if (query.status) where.status = query.status;
    if (query.dateFrom) where.createdAt = { gte: new Date(query.dateFrom) };
    if (query.dateTo) {
      where.createdAt = {
        ...((where.createdAt as object) ?? {}),
        lte: new Date(query.dateTo),
      };
    }
    if (query.ticketTypeId) {
      where.orderItems = { some: { ticketTypeId: query.ticketTypeId } };
    }

    const [total, items] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
    ]);

    return { total, page, limit, items };
  }

  // ─── UC15b: Chi tiết đơn hàng ─────────────────────────────────────────────

  async getOrder(organizerId: string, orderId: string) {
    const profile = await this.getOwnedProfile(organizerId);

    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        event: { organizerId: profile.id },
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        expiresAt: true,
        user: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        orderItems: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            ticketType: { select: { id: true, name: true } },
            seat: { select: { id: true, label: true } },
          },
        },
        tickets: {
          select: { id: true, qrCode: true, status: true, issuedAt: true },
        },
        paymentTransaction: {
          select: {
            status: true,
            gateway: true,
            gatewayTxId: true,
            processedAt: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    return order;
  }

  // ─── UC18: Thống kê bán vé / doanh thu ───────────────────────────────────

  async getStats(organizerId: string, eventId: string) {
    const profile = await this.getOwnedProfile(organizerId);
    await this.assertEventOwner(profile.id, eventId);

    const [totalOrders, paidOrders, ticketTypes, seats] = await Promise.all([
      this.prisma.order.count({ where: { eventId } }),
      this.prisma.order.findMany({
        where: { eventId, status: OrderStatus.PAID },
        select: { totalAmount: true, createdAt: true },
      }),
      this.prisma.ticketType.findMany({
        where: { eventId },
        select: {
          id: true,
          name: true,
          quantity: true,
          sold: true,
          price: true,
        },
      }),
      this.prisma.seat.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { status: true },
      }),
    ]);

    const revenue = paidOrders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );

    const seatCounts = Object.fromEntries(
      seats.map((s) => [s.status, s._count.status]),
    );

    return {
      totalOrders,
      paidOrders: paidOrders.length,
      revenue,
      ticketTypes,
      seatCounts,
    };
  }

  // ─── UC19: Hồ sơ nhà tổ chức ─────────────────────────────────────────────

  async getProfile(organizerId: string) {
    return this.getOwnedProfile(organizerId);
  }

  async updateProfile(organizerId: string, dto: UpdateOrganizerProfileDto) {
    const profile = await this.getOwnedProfile(organizerId);

    // Đổi orgName hoặc thông tin xác minh → reset sang PENDING (cần Admin duyệt lại)
    const requiresReview =
      dto.orgName !== undefined && dto.orgName !== profile.orgName;
    const data: Prisma.OrganizerProfileUpdateInput = {};

    if (dto.orgName !== undefined) {
      data.orgName = dto.orgName;
      data.status = OrganizerStatus.PENDING;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.bannerUrl !== undefined) data.bannerUrl = dto.bannerUrl;
    if (dto.website !== undefined) data.website = dto.website;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Không có trường nào được cập nhật');
    }

    const updated = await this.prisma.organizerProfile.update({
      where: { id: profile.id },
      data,
    });

    return {
      ...updated,
      note: requiresReview
        ? 'Tên tổ chức đã thay đổi. Trạng thái đã được reset về PENDING và cần Admin duyệt lại.'
        : undefined,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getOwnedProfile(userId: string) {
    const profile = await this.prisma.organizerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new ForbiddenException('Bạn chưa có hồ sơ nhà tổ chức');
    return profile;
  }

  private async assertEventOwner(profileId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizerId: profileId },
    });
    if (!event) throw new NotFoundException('Sự kiện không tồn tại');
    return event;
  }
}
