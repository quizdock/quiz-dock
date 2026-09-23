import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Ce qu'on voit d'un modèle **avant** d'en prendre une copie (#39) : de quoi
 * juger sur pièces — les questions, leurs propositions, les illustrations — sans
 * avoir à l'importer d'abord. Construit depuis le bundle sur disque ; les médias
 * pointent vers la route qui sert ceux du catalogue.
 */
export const storePreviewItemSchema = z.object({
  kind: z.enum(['question', 'slide']),
  /** Énoncé de la question, ou premier texte de la diapositive. */
  text: z.string(),
  type: z.string().nullable(),
  timeLimitS: z.number().int().nullable(),
  mediaUrl: z.string().nullable(),
  mediaAlt: z.string().nullable(),
  options: z.array(z.object({ text: z.string(), color: z.string(), shape: z.string() })),
});

export const storePreviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.string(),
  tags: z.array(z.string()),
  license: z.string().nullable(),
  author: z.object({ name: z.string(), subject: z.string() }),
  revision: z.number().int(),
  sharedAt: z.string(),
  coverUrl: z.string().nullable(),
  questionCount: z.number().int(),
  slideCount: z.number().int(),
  items: z.array(storePreviewItemSchema),
});

export class StorePreviewDto extends createZodDto(storePreviewSchema) {}
