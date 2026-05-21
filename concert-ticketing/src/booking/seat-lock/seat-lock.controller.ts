import {
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { LockSeatUseCase } from './application/lock-seat.use-case';
import { ReleaseSeatUseCase } from './application/release-seat.use-case';
import {
  SEAT_LOCK_ERROR_CODES,
  SeatTakenError,
  TicketLimitReachedError,
} from './domain/seat-lock.errors';
import { LockSeatDto } from './dto/lock-seat.dto';

@ApiTags('seat-lock')
@ApiBearerAuth()
@Controller('booking/seats')
export class SeatLockController {
  constructor(
    private readonly lockSeatUseCase: LockSeatUseCase,
    private readonly releaseSeatUseCase: ReleaseSeatUseCase,
  ) {}

  @Post(':seatId/lock')
  @HttpCode(200)
  @ApiOperation({ summary: 'UC09 — Hold a seat for 15 minutes' })
  @ApiResponse({
    status: 200,
    description: '{ lockId, seatId, expiresAt }',
  })
  @ApiResponse({ status: 409, description: 'SEAT_TAKEN' })
  @ApiResponse({ status: 422, description: 'TICKET_LIMIT_REACHED' })
  async lock(
    @CurrentUser() user: JwtPayload,
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: LockSeatDto,
  ) {
    try {
      return await this.lockSeatUseCase.execute({
        userId: user.sub,
        eventId: dto.eventId,
        seatId,
      });
    } catch (err) {
      if (err instanceof SeatTakenError) {
        throw new ConflictException({
          code: SEAT_LOCK_ERROR_CODES.SEAT_TAKEN,
          message: err.message,
        });
      }
      if (err instanceof TicketLimitReachedError) {
        throw new UnprocessableEntityException({
          code: SEAT_LOCK_ERROR_CODES.TICKET_LIMIT_REACHED,
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Delete(':seatId/lock')
  @HttpCode(204)
  @ApiOperation({ summary: 'UC09 — Release a held seat' })
  @ApiResponse({ status: 204, description: 'Released' })
  @ApiResponse({ status: 403, description: 'Not the lock owner or expired' })
  async release(
    @CurrentUser() user: JwtPayload,
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: LockSeatDto,
  ) {
    await this.releaseSeatUseCase.execute({
      userId: user.sub,
      eventId: dto.eventId,
      seatId,
    });
  }
}
