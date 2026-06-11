import { createZodDto } from 'nestjs-zod';
import { questionSchema } from '../../questions/dto/question.dto';
import { quizSchema } from './quiz.dto';

/** Détail d'un quiz possédé, questions incluses (ordonnées). DTO builder. */
export const quizDetailSchema = quizSchema.extend({
  questions: questionSchema.array(),
});

export class QuizDetailDto extends createZodDto(quizDetailSchema) {}
