import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { QuizzesController } from './quizzes.controller';
import { QuizPortableService } from './portable/quiz-portable.service';
import { QuizPublicationService } from './portable/quiz-publication.service';
import { QuizzesService } from './quizzes.service';
import { SampleQuizzesService } from './samples/sample-quizzes.service';

@Module({
  imports: [MediaModule],
  controllers: [QuizzesController],
  providers: [QuizzesService, SampleQuizzesService, QuizPortableService, QuizPublicationService],
  exports: [SampleQuizzesService, QuizPortableService],
})
export class QuizzesModule {}
