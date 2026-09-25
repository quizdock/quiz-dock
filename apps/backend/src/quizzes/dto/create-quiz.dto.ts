import { createZodDto } from 'nestjs-zod';
import { AUDIO_TARGETS, LANGUAGE_RE, MEDIA_TAIL_MAX_S } from '@quiz-dock/contracts';
import { z } from 'zod';

/** Création d'un quiz (RG-01/02). Le propriétaire vient du JWT, jamais du corps. */
export const createQuizSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  /** BCP 47; the instance's language when omitted (#83). */
  language: z.string().trim().regex(LANGUAGE_RE).max(10).optional(),
  feedbackEnabled: z.boolean().optional(),
  mediaTailS: z.number().int().min(0).max(MEDIA_TAIL_MAX_S).optional(),
  loudnessTargetLufs: z.union([z.literal(-14), z.literal(-16), z.literal(-23)]).optional(),
  audioTarget: z.enum(AUDIO_TARGETS).optional(),
  coverMediaId: z.string().length(26).optional(),
});

export class CreateQuizDto extends createZodDto(createQuizSchema) {}
