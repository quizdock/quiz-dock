import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Partie en cours d'un hôte, exposée au dashboard (reprise §6.2). */
export const activeGameSchema = z.object({
  pin: z.string(),
  title: z.string(),
  state: z.string(),
  playerCount: z.number().int(),
});

export class ActiveGameDto extends createZodDto(activeGameSchema) {}
