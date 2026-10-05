import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AllowManager } from '../auth/allow-manager.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { HistoryListDto, HistoryRoomDto } from './dto/quiz-session.dto';
import { QuizzesService } from './quizzes.service';

/**
 * The history by gathering: what a host played, room by room — a class that played
 * three quizzes in a row is one line, its standings one page. A quiz played alone is a
 * line too, leading to its report.
 */
@ApiTags('history')
@ApiBearerAuth()
@Controller('history')
export class HistoryController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  @AllowManager()
  @ApiOkResponse({ type: HistoryListDto })
  list(@CurrentUser() user: User) {
    return this.quizzes.history(user);
  }

  @Get('rooms/:roomId')
  @AllowManager()
  @ApiOkResponse({ type: HistoryRoomDto })
  room(@CurrentUser() user: User, @Param('roomId') roomId: string) {
    return this.quizzes.historyRoom(user, roomId);
  }
}
