import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { AllowManager } from '../auth/allow-manager.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { QuizDetailDto } from './dto/quiz-detail.dto';
import { QuizFeedbackQueryDto, QuizFeedbackSummaryDto } from './dto/quiz-feedback.dto';
import { SessionDetailDto, SessionListDto, SessionPlayerDetailDto } from './dto/quiz-session.dto';
import { QuizDto } from './dto/quiz.dto';
import { TransitionQuizDto } from './dto/transition-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { type BundleFile, QuizPortableService } from './portable/quiz-portable.service';
import { QuizzesService } from './quizzes.service';
import { SampleQuizzesService } from './samples/sample-quizzes.service';

/** A bundle is a zip of media: sized like a handful of uploads. */
const IMPORT_MAX_BYTES = Number(process.env.IMPORT_MAX_BYTES ?? 50 * 1024 * 1024);

@ApiTags('quizzes')
@ApiBearerAuth()
@Controller('quizzes')
export class QuizzesController {
  constructor(
    private readonly quizzes: QuizzesService,
    private readonly samples: SampleQuizzesService,
    private readonly portable: QuizPortableService,
  ) {}

  /** Sa banque — ou, pour un gestionnaire, celle de toute l'instance (RG-14). */
  @Get()
  @AllowManager()
  @ApiOkResponse({ type: QuizDto, isArray: true })
  list(@CurrentUser() user: User) {
    return this.quizzes.list(user);
  }

  @Post()
  @ApiCreatedResponse({ type: QuizDto })
  create(@CurrentUser() user: User, @Body() dto: CreateQuizDto) {
    return this.quizzes.create(user.id, dto);
  }

  /** Adds the built-in sample quizzes (ready to play) to the caller's bank. */
  @Post('samples')
  @ApiCreatedResponse({ type: QuizDto, isArray: true })
  createSamples(@CurrentUser() user: User) {
    return this.samples.createFor(user.id);
  }

  /** Imports a portable bundle (zip, or a bare `quiz.json`) as a new draft (#19). */
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: QuizDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES } }))
  importQuiz(@CurrentUser() user: User, @UploadedFile() file: BundleFile | undefined) {
    return this.portable.importBundle(user.id, file);
  }

  /** The quiz as a portable bundle: `quiz.json` + `media/`, zipped (#19). */
  @Get(':id/export')
  @ApiProduces('application/zip')
  @ApiOkResponse({ description: 'Zip bundle (quiz.json + media/).' })
  async exportQuiz(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filename, zip } = await this.portable.exportZip(id, user.id);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(zip);
  }

  @Post(':id/duplicate')
  @ApiCreatedResponse({ type: QuizDto })
  duplicate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.duplicate(user.id, id);
  }

  @Get(':id')
  @ApiOkResponse({ type: QuizDetailDto })
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.get(user, id);
  }

  @Get(':id/feedback')
  @AllowManager()
  @ApiOkResponse({ type: QuizFeedbackSummaryDto })
  feedback(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query() query: QuizFeedbackQueryDto,
  ) {
    return this.quizzes.feedback(user, id, query);
  }

  @Get(':id/sessions')
  @AllowManager()
  @ApiOkResponse({ type: SessionListDto })
  sessions(@CurrentUser() user: User, @Param('id') id: string) {
    return this.quizzes.sessions(user, id);
  }

  @Get(':id/sessions/:sessionId')
  @AllowManager()
  @ApiOkResponse({ type: SessionDetailDto })
  sessionDetail(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.quizzes.sessionDetail(user, id, sessionId);
  }

  @Get(':id/sessions/:sessionId/players/:playerResultId')
  @AllowManager()
  @ApiOkResponse({ type: SessionPlayerDetailDto })
  sessionPlayer(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
    @Param('playerResultId') playerResultId: string,
  ) {
    return this.quizzes.sessionPlayerDetail(user, id, sessionId, playerResultId);
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
