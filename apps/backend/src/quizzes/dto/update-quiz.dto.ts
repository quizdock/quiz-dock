import { createZodDto } from 'nestjs-zod';
import {
  AUDIO_TARGETS,
  LANGUAGE_RE,
  MEDIA_TAIL_MAX_S,
  QUIZ_LICENSES,
  QUIZ_MAX_TAGS,
  TAG_MAX_LENGTH,
  TAG_RE,
} from '@quiz-dock/contracts';
import { z } from 'zod';

/** Mise à jour partielle d'un quiz. `null` sur description/cover = effacement. */
export const updateQuizSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  /** BCP 47 ("en", "zh-TW"). */
  language: z.string().trim().regex(LANGUAGE_RE).max(10).optional(),
  feedbackEnabled: z.boolean().optional(),
  /** Pause after a question's media before its time can run out (s). */
  mediaTailS: z.number().int().min(0).max(MEDIA_TAIL_MAX_S).optional(),
  /** Level sounds and videos are brought to (LUFS): -14 loud, -16 balanced, -23 calm. */
  loudnessTargetLufs: z.union([z.literal(-14), z.literal(-16), z.literal(-23)]).optional(),
  /** Which devices play the sounds, unless a question says otherwise. */
  audioTarget: z.enum(AUDIO_TARGETS).optional(),
  coverMediaId: z.string().length(26).nullable().optional(),
  /** Terms the quiz travels under when shared (#39, #21); `null` clears it. */
  license: z.enum(QUIZ_LICENSES).nullable().optional(),
  /** Replaces the whole list; duplicates are dropped. */
  tags: z
    .array(z.string().regex(TAG_RE).max(TAG_MAX_LENGTH))
    .max(QUIZ_MAX_TAGS)
    .transform((tags) => [...new Set(tags)])
    .optional(),
});

export class UpdateQuizDto extends createZodDto(updateQuizSchema) {}
