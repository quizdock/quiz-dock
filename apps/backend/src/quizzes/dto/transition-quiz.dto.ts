import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Changement d'état du cycle de vie d'un quiz (RG-02). */
export const transitionQuizSchema = z.object({
  status: z.enum(['draft', 'ready', 'archived']),
});

export class TransitionQuizDto extends createZodDto(transitionQuizSchema) {}
