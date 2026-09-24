import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A slide as the stage draws it, its media served by the catalogue. */
export const servedSlideSchema = z.object({
  /** Slide blocks, image URLs served by the catalogue (`SlideBlock[]`). */
  blocks: z.array(z.unknown()),
  background: z
    .union([
      z.object({ url: z.string() }),
      z.object({ gradient: z.object({ angle: z.number(), colors: z.array(z.string()) }) }),
    ])
    .nullable(),
  textTone: z.enum(['light', 'dark']),
  textOutline: z.boolean(),
});

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
  /** Premier élément du quiz, ce que la carte montre à défaut de couverture. */
  first: z
    .object({
      kind: z.enum(['question', 'slide']),
      text: z.string(),
      media: z.string().nullable(),
      gradient: z.object({ angle: z.number(), colors: z.array(z.string()) }).nullable(),
      /** Quand le premier élément est une diapositive : de quoi la dessiner telle quelle. */
      slide: servedSlideSchema.nullable(),
    })
    .nullable(),
});

export class StoreEntryDto extends createZodDto(storeEntrySchema) {}
