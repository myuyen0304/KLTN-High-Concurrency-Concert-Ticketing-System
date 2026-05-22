import {
  Controller,
  Get,
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
} from '../common/decorators/current-user.decorator';
import { CheckTurnUseCase } from './application/check-turn.use-case';
import { JoinQueueUseCase } from './application/join-queue.use-case';
import { QUEUE_ERROR_CODES, QueueClosedError } from './domain/queue.errors';

@ApiTags('queue')
@ApiBearerAuth()
@Controller('queue')
export class QueueController {
  constructor(
    private readonly joinQueue: JoinQueueUseCase,
    private readonly checkTurn: CheckTurnUseCase,
  ) {}

  @Post(':eventId/join')
  @HttpCode(200)
  @ApiOperation({ summary: 'UC07 — Join the virtual waiting room (FIFO)' })
  @ApiResponse({ status: 200, description: '{ position, estimatedWaitSec }' })
  @ApiResponse({ status: 422, description: 'QUEUE_CLOSED' })
  async join(
    @CurrentUser() user: JwtPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    try {
      return await this.joinQueue.execute({ userId: user.sub, eventId });
    } catch (err) {
      if (err instanceof QueueClosedError) {
        throw new UnprocessableEntityException({
          code: QUEUE_ERROR_CODES.QUEUE_CLOSED,
          message: err.message,
        });
      }
      throw err;
    }
  }

  @Get(':eventId/status')
  @ApiOperation({ summary: 'Poll queue position / admission status' })
  @ApiResponse({
    status: 200,
    description: '{ position } | { admitted: true, expiresAt }',
  })
  async status(
    @CurrentUser() user: JwtPayload,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.checkTurn.execute({ userId: user.sub, eventId });
  }
}
