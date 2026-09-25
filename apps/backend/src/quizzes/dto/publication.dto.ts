import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const mediaSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video', 'audio']),
  name: z.string().nullable(),
  sizeBytes: z.number().int(),
});

/** `GET /quizzes/:id/publication`: what a store would refuse, before anything is downloaded. */
export const publicationReportSchema = z.object({
  slug: z.string(),
  slugSet: z.boolean(),
  language: z.string(),
  license: z.string().nullable(),
  tags: z.array(z.string()),
  estimatedBytes: z.number().int(),
  maxBytes: z.number().int(),
  issues: z.array(
    z.object({
      code: z.enum(['not_ready', 'license', 'language', 'tags', 'too_large', 'credit_missing']),
      level: z.enum(['block', 'warn']),
      count: z.number().int().optional(),
    }),
  ),
  heaviest: z.array(mediaSchema),
  uncredited: z.array(mediaSchema),
});

export class PublicationReportDto extends createZodDto(publicationReportSchema) {}

/** Body of `POST /quizzes/:id/publication/export`: the slug the author confirmed. */
export const publicationExportSchema = z.object({
  slug: z.string().max(60),
});

export class PublicationExportDto extends createZodDto(publicationExportSchema) {}
