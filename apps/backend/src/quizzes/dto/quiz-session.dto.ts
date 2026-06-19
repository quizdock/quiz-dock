import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const sessionStatusSchema = z.enum([
  'lobby',
  'in_progress',
  'ended',
  'interrupted',
  'archived',
]);

/** Résumé d'une session jouée et archivée (ligne de l'historique, §2.7). */
export const sessionSummarySchema = z.object({
  id: z.string(),
  pin: z.string(),
  status: sessionStatusSchema,
  playerCount: z.number().int(),
  /** Taux de réussite global 0..1 (null si aucune réponse). */
  successRate: z.number().nullable(),
  fullCapture: z.boolean(),
  startedAt: z.string(),
  endedAt: z.string(),
});

/** Liste des sessions archivées d'un quiz (récentes d'abord). */
export const sessionListSchema = z.object({
  sessions: z.array(sessionSummarySchema),
});
export class SessionListDto extends createZodDto(sessionListSchema) {}

/** Agrégat par question dans le détail d'une session (§2.9). */
export const sessionQuestionStatSchema = z.object({
  orderIndex: z.number().int(),
  prompt: z.string(),
  type: z.string(),
  answerCount: z.number().int(),
  correctCount: z.number().int(),
  successRate: z.number(),
  avgResponseMs: z.number().nullable(),
});

/** Résultat d'un participant dans le détail d'une session (§2.8). */
export const sessionPlayerResultSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  finalRank: z.number().int(),
  finalScore: z.number().int(),
  correctCount: z.number().int(),
  answeredCount: z.number().int(),
  avgResponseMs: z.number().nullable(),
  maxStreak: z.number().int(),
});

/** Détail d'une session : résumé + agrégats par question + résultats par participant. */
export const sessionDetailSchema = sessionSummarySchema.extend({
  quizTitle: z.string(),
  language: z.string(),
  totalQuestions: z.number().int(),
  questions: z.array(sessionQuestionStatSchema),
  players: z.array(sessionPlayerResultSchema),
});
export class SessionDetailDto extends createZodDto(sessionDetailSchema) {}
