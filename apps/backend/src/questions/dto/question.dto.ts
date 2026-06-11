import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ⚠️ DTO **builder** (formateur, propriétaire) : expose `isCorrect` /
// `correctOrderIndex`. NE PAS réutiliser tel quel pour le payload joueur
// `question:start` (v0.3.0) — anti-triche §7 : la bonne réponse n'est jamais
// transmise avant le reveal.
export const answerOptionSchema = z.object({
  id: z.string(),
  orderIndex: z.number().int(),
  text: z.string().nullable(),
  mediaId: z.string().nullable(),
  color: z.enum(['red', 'blue', 'yellow', 'green']),
  shape: z.enum(['triangle', 'diamond', 'circle', 'square']),
  isCorrect: z.boolean(),
  correctOrderIndex: z.number().int().nullable(),
});

export const acceptedAnswerSchema = z.object({
  id: z.string(),
  text: z.string(),
  normalized: z.string(),
});

export const questionSchema = z.object({
  id: z.string(),
  quizId: z.string(),
  orderIndex: z.number().int(),
  type: z.enum([
    'single_choice',
    'multiple_choice',
    'true_false',
    'text_input',
    'numeric',
    'ordering',
    'poll',
  ]),
  prompt: z.string(),
  mediaId: z.string().nullable(),
  timeLimitS: z.number().int(),
  pointsMode: z.enum(['standard', 'double', 'none']),
  numericValue: z.string().nullable(),
  numericTolerance: z.string().nullable(),
  options: z.array(answerOptionSchema),
  acceptedAnswers: z.array(acceptedAnswerSchema),
});

export class QuestionDto extends createZodDto(questionSchema) {}
