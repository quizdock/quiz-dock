import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One template in the catalogue (#39) — what browsing shows without opening a bundle. */
export const storeEntrySchema = z.object({
  /** ULID of the template: names the entry and its folder, stable across a re-share. */
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.string(),
  tags: z.array(z.string()),
  questionCount: z.number().int(),
  license: z.string().nullable(),
  author: z.object({ name: z.string(), subject: z.string() }),
  revision: z.number().int(),
  sharedAt: z.string(),
  /** Vignette du modèle, servie par le catalogue ; null quand il n'y a pas de couverture. */
  coverUrl: z.string().nullable(),
});

export class StoreEntryDto extends createZodDto(storeEntrySchema) {}
