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
  /** Suivi individuel (RG-16) : faux = aucun résultat par participant archivé. */
  personalTracking: z.boolean(),
  fullCapture: z.boolean(),
  startedAt: z.string(),
  endedAt: z.string(),
  /** Archived sessions of its room (#89), itself included; null when played alone. */
  roomSize: z.number().int().nullable(),
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

/** A session of the same room, in the order they were played. */
export const roomSessionSchema = z.object({
  id: z.string(),
  quizId: z.string(),
  quizTitle: z.string(),
  startedAt: z.string(),
  /** The session this detail is about. */
  current: z.boolean(),
});

/** A participant's standing over the archived sessions of the room. */
export const roomStandingSchema = z.object({
  rank: z.number().int(),
  nickname: z.string(),
  score: z.number().int(),
  correctCount: z.number().int(),
  answeredCount: z.number().int(),
  avgResponseMs: z.number().nullable(),
  maxStreak: z.number().int(),
  /** Archived quizzes of the room they took part in. */
  quizzes: z.number().int(),
});

/**
 * The room a session was played in (#89), read from its archived sessions:
 * the quizzes kept, and the standings summed over them — null unless every one
 * of those sessions tracked its participants (RG-16).
 */
export const sessionRoomSchema = z.object({
  sessions: z.array(roomSessionSchema),
  standings: z.array(roomStandingSchema).nullable(),
});

/** Détail d'une session : résumé + agrégats par question + résultats par participant. */
export const sessionDetailSchema = sessionSummarySchema.extend({
  quizTitle: z.string(),
  language: z.string(),
  totalQuestions: z.number().int(),
  questions: z.array(sessionQuestionStatSchema),
  players: z.array(sessionPlayerResultSchema),
  /** Null when the session was played alone (or its room kept only it). */
  room: sessionRoomSchema.nullable(),
});
export class SessionDetailDto extends createZodDto(sessionDetailSchema) {}

/** Réponse d'un participant à une question (capture intégrale, §2.10). */
export const sessionPlayerAnswerSchema = z.object({
  orderIndex: z.number().int(),
  prompt: z.string(),
  type: z.string(),
  /** Réponse rendue lisible (texte d'option, valeur libre, ordre…). */
  answer: z.string(),
  isCorrect: z.boolean(),
  pointsAwarded: z.number().int(),
  responseMs: z.number().int(),
});

/**
 * « Le quiz vu par un participant » : son résultat + ses réponses question par
 * question. `answers` n'est rempli qu'en capture intégrale (`fullCapture`).
 */
export const sessionPlayerDetailSchema = sessionPlayerResultSchema.extend({
  fullCapture: z.boolean(),
  answers: z.array(sessionPlayerAnswerSchema),
});
export class SessionPlayerDetailDto extends createZodDto(sessionPlayerDetailSchema) {}
