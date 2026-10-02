import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { QuizzesController } from './quizzes.controller';
import { QuizPortableService } from './portable/quiz-portable.service';
import { QuizPublicationService } from './portable/quiz-publication.service';
import { QuizzesService } from './quizzes.service';
import { SampleQuizzesService } from './samples/sample-quizzes.service';

import { QuizValidationController } from './quiz-validation.controller';

@Module({
  imports: [MediaModule],
  controllers: [QuizValidationController, QuizzesController],
  providers: [QuizzesService, SampleQuizzesService, QuizPortableService, QuizPublicationService],
  exports: [SampleQuizzesService, QuizPortableService, QuizzesService],
})
export class QuizzesModule {}
