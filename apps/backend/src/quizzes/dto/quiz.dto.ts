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
  /** Nom du propriétaire — uniquement dans la vue d'ensemble d'un gestionnaire (RG-14). */
  ownerName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});

export class QuizDto extends createZodDto(quizSchema) {}
