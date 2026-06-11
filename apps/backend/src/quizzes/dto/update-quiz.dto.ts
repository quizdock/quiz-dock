import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Mise à jour partielle d'un quiz. `null` sur description/cover = effacement. */
export const updateQuizSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  language: z.string().trim().min(2).max(5).optional(),
  coverMediaId: z.string().length(26).nullable().optional(),
});

export class UpdateQuizDto extends createZodDto(updateQuizSchema) {}
