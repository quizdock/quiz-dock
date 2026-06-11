import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateQuestionDto } from './dto/create-question.dto';
import { QuestionDto } from './dto/question.dto';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionsService } from './questions.service';

@ApiTags('questions')
@ApiBearerAuth()
@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post('quizzes/:id/questions')
  @ApiCreatedResponse({ type: QuestionDto })
  add(@CurrentUser() user: User, @Param('id') quizId: string, @Body() dto: CreateQuestionDto) {
    return this.questions.add(user.id, quizId, dto);
  }

  @Patch('quizzes/:id/questions/reorder')
  @ApiOkResponse({ type: QuestionDto, isArray: true })
  reorder(
    @CurrentUser() user: User,
    @Param('id') quizId: string,
    @Body() dto: ReorderQuestionsDto,
  ) {
    return this.questions.reorder(user.id, quizId, dto);
  }

  @Put('questions/:qid')
  @ApiOkResponse({ type: QuestionDto })
  update(@CurrentUser() user: User, @Param('qid') qid: string, @Body() dto: UpdateQuestionDto) {
    return this.questions.update(user.id, qid, dto);
  }

  @Delete('questions/:qid')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@CurrentUser() user: User, @Param('qid') qid: string) {
    return this.questions.remove(user.id, qid);
  }
}
