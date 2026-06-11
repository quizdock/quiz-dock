import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Nouvel ordre des questions d'un quiz (RG-03). */
export const reorderQuestionsSchema = z.object({
  items: z
    .array(
      z.object({
        questionId: z.string().length(26),
        orderIndex: z.number().int().min(0),
      }),
    )
    .min(1),
});

export class ReorderQuestionsDto extends createZodDto(reorderQuestionsSchema) {}
