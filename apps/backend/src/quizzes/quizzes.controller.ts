import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { QuizDetailDto } from './dto/quiz-detail.dto';
import { QuizFeedbackSummaryDto } from './dto/quiz-feedback.dto';
import { SessionDetailDto, SessionListDto, SessionPlayerDetailDto } from './dto/quiz-session.dto';
import { QuizDto } from './dto/quiz.dto';
import { TransitionQuizDto } from './dto/transition-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { QuizzesService } from './quizzes.service';

@ApiTags('quizzes')
@ApiBearerAuth()
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  @ApiOkResponse({ type: QuizDto, isArray: true })
  list(@CurrentUser() user: User) {
    return this.quizzes.list(user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: QuizDto })
  create(@CurrentUser() user: User, @Body() dto: CreateQuizDto) {
    return this.quizzes.create(user.id, dto);
  }

  @Post(':id/duplicate')
  @ApiCreatedResponse({ type: QuizDto })
  duplicate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.duplicate(user.id, id);
  }

  @Get(':id')
  @ApiOkResponse({ type: QuizDetailDto })
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.get(user.id, id);
  }

  @Get(':id/feedback')
  @ApiOkResponse({ type: QuizFeedbackSummaryDto })
  feedback(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.feedback(user.id, id);
  }

  @Get(':id/sessions')
  @ApiOkResponse({ type: SessionListDto })
  sessions(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.sessions(user.id, id);
  }

  @Get(':id/sessions/:sessionId')
  @ApiOkResponse({ type: SessionDetailDto })
  sessionDetail(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.quizzes.sessionDetail(user.id, id, sessionId);
  }

  @Get(':id/sessions/:sessionId/players/:playerResultId')
  @ApiOkResponse({ type: SessionPlayerDetailDto })
  sessionPlayer(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Param('playerResultId') playerResultId: string,
  ) {
    return this.quizzes.sessionPlayerDetail(user.id, id, sessionId, playerResultId);
  }

  @Put(':id')
  @ApiOkResponse({ type: QuizDto })
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateQuizDto) {
    return this.quizzes.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.remove(user.id, id);
  }

  @Patch(':id/status')
  @ApiOkResponse({ type: QuizDto })
  transition(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: TransitionQuizDto) {
    return this.quizzes.transition(user.id, id, dto);
  }
}
