import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Partie en cours, exposée à l'interface (reprise §6.2). Un hôte voit **les
 * siennes** ; un `admin` voit celles de l'instance, et `host` dit alors de qui
 * elles sont — absent quand on ne regarde que les siennes.
 */
export const activeGameSchema = z.object({
  pin: z.string(),
  quizId: z.string(),
  title: z.string(),
  state: z.string(),
  playerCount: z.number().int(),
  host: z.string().optional(),
});

export class ActiveGameDto extends createZodDto(activeGameSchema) {}
