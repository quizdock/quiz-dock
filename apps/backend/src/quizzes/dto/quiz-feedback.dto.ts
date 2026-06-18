import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Un avis de joueur (§2.11) tel qu'exposé au propriétaire du quiz. */
export const quizFeedbackItemSchema = z.object({
  id: z.string(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  nickname: z.string(),
  createdAt: z.string(),
});

/** Synthèse des avis d'un quiz : moyenne, nombre, et la liste (récente d'abord). */
export const quizFeedbackSummarySchema = z.object({
  count: z.number().int(),
  average: z.number(),
  items: z.array(quizFeedbackItemSchema),
});

export class QuizFeedbackSummaryDto extends createZodDto(quizFeedbackSummarySchema) {}
