import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SeatMapQueryService } from './seat-map-query.service';

@ApiTags('seat-selection')
@ApiBearerAuth()
@Controller('booking')
export class SeatSelectionController {
  constructor(private readonly seatMapQuery: SeatMapQueryService) {}

  // UC08 — booking-time seat map. Merges DB seat status with the live Redis
  // held-set. Holding a seat reuses UC09's POST /booking/seats/:seatId/lock.
  @Get(':eventId/seats')
  @ApiOperation({
    summary: 'UC08 — Seat map with live status (AVAILABLE / HELD / SOLD)',
  })
  @ApiResponse({
    status: 200,
    description: '[{ seatId, row, number, label, status }]',
  })
  @ApiResponse({ status: 404, description: 'Event not found' })
  getSeatMap(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.seatMapQuery.getSeatMap(eventId);
  }
}
