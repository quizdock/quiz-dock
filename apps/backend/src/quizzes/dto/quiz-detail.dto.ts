import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { questionSchema } from '../../questions/dto/question.dto';
import { slideSchema } from '../../slides/dto/slide.dto';
import { quizSchema } from './quiz.dto';

/** Détail d'un quiz possédé, questions incluses (ordonnées). DTO builder. */
export const quizDetailSchema = quizSchema.extend({
  /** Whether the caller may change it: its owner only. A manager reads another host's quiz (#82). */
  editable: z.boolean(),
  questions: questionSchema.array(),
  // Slides (#7), sorted by anchor then orderIndex; the client merges them into the sequence.
  slides: slideSchema.array(),
});

export class QuizDetailDto extends createZodDto(quizDetailSchema) {}
