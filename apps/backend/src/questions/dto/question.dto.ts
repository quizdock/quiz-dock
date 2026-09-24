import { createZodDto } from 'nestjs-zod';
import { AUDIO_TARGETS, WAVEFORM_SIZES, questionMediaSchema } from '@quiz-dock/contracts';
import { z } from 'zod';
import { backgroundOutputFields } from '../../common/background.schema';

// ⚠️ DTO **builder** (animateur, propriétaire) : expose `isCorrect` /
// `correctOrderIndex`. NE PAS réutiliser tel quel pour le payload joueur
// `question:start` (v0.3.0) — anti-triche §7 : la bonne réponse n'est jamais
// transmise avant le reveal.
export const answerOptionSchema = z.object({
  id: z.string(),
  orderIndex: z.number().int(),
  text: z.string().nullable(),
  mediaId: z.string().nullable(),
  color: z.enum(['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'pink', 'teal']),
  shape: z.enum(['triangle', 'diamond', 'circle', 'square', 'star', 'hexagon', 'heart', 'cross']),
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
  media: questionMediaSchema,
  answerExplanation: z.string().nullable(),
  ...backgroundOutputFields,
  timeLimitS: z.number().int(),
  revealDelayS: z.number().int().nullable(),
  /** Which devices play its sound; null = the game's default. */
  audioTarget: z.enum(AUDIO_TARGETS).nullable(),
  /** How thick its waveform is drawn on the screens. */
  waveformSize: z.enum(WAVEFORM_SIZES),
  /** The timer starts when the media ends. */
  timerAfterMedia: z.boolean(),
  pointsMode: z.enum(['standard', 'double', 'none', 'fixed']),
  scoring: z.enum(['standard', 'closest', 'partial', 'lenient']),
  numericValue: z.string().nullable(),
  numericTolerance: z.string().nullable(),
  options: z.array(answerOptionSchema),
  acceptedAnswers: z.array(acceptedAnswerSchema),
});

export class QuestionDto extends createZodDto(questionSchema) {}
