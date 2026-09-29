import { createZodDto } from 'nestjs-zod';
import { AUDIO_TARGETS } from '@quiz-dock/contracts';
import { z } from 'zod';

/** Représentation d'un quiz exposée par l'API (§2.2). */
export const quizSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverMediaId: z.string().nullable(),
  status: z.enum(['draft', 'ready', 'archived']),
  language: z.string(),
  feedbackEnabled: z.boolean(),
  /** Pause kept after a question's media before its time can run out (s). */
  mediaTailS: z.number().int(),
  /** Level sounds and videos are brought to at playback (LUFS). */
  loudnessTargetLufs: z.number().int(),
  /** Which devices play the sounds, unless a question says otherwise. */
  audioTarget: z.enum(AUDIO_TARGETS),
  questionCount: z.number().int(),
  /** SPDX identifier, required to share the quiz; an imported one may be outside the list offered. */
  license: z.string().nullable(),
  tags: z.array(z.string()),
  /** Shared with the instance's other hosts (read-only for them, to copy from). */
  shared: z.boolean(),
  /** Whether the caller may edit it: theirs. Absent on the answers that do not say. */
  editable: z.boolean().optional(),
  /** Nom du propriétaire — un quiz d'un autre (partagé, ou la vue d'un gestionnaire, RG-14). */
  ownerName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

export class QuizDto extends createZodDto(quizSchema) {}

export class QuizImportDto extends createZodDto(
  quizSchema.extend({
    importReport: z
      .object({
        source: z.literal('kahoot'),
        converted: z.number().int(),
        skipped: z.array(
          z.object({
            row: z.number().int(),
            reason: z.enum([
              'missing_prompt',
              'missing_answers',
              'invalid_time',
              'invalid_correct',
              'formula',
              'invalid_content',
            ]),
          }),
        ),
      })
      .optional(),
  }),
) {}
