import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Création d'un quiz (RG-01/02). Le propriétaire vient du JWT, jamais du corps. */
export const createQuizSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  language: z.string().trim().min(2).max(5).default('fr'),
  coverMediaId: z.string().length(26).optional(),
});

export class CreateQuizDto extends createZodDto(createQuizSchema) {}
