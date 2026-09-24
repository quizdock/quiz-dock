import { createZodDto } from 'nestjs-zod';
import { MEDIA_TAIL_MAX_S } from '@quiz-dock/contracts';
import { z } from 'zod';

/** Mise à jour partielle d'un quiz. `null` sur description/cover = effacement. */
export const updateQuizSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  language: z.string().trim().min(2).max(5).optional(),
  feedbackEnabled: z.boolean().optional(),
  /** Pause after a question's media before its time can run out (s). */
  mediaTailS: z.number().int().min(0).max(MEDIA_TAIL_MAX_S).optional(),
  /** Level sounds and videos are brought to (LUFS): -14 loud, -16 balanced, -23 calm. */
  loudnessTargetLufs: z.union([z.literal(-14), z.literal(-16), z.literal(-23)]).optional(),
  coverMediaId: z.string().length(26).nullable().optional(),
});

export class UpdateQuizDto extends createZodDto(updateQuizSchema) {}
