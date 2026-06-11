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

  @Get(':id')
  @ApiOkResponse({ type: QuizDto })
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.get(user.id, id);
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
