import { z } from 'zod';
import { backgroundFields, noBackgroundConflict } from './background';
import { IMAGE_CHOICE_OPTION_COUNTS, OPTION_ALT_MAX } from './image-choice';
import {
  AUDIO_TARGETS,
  MEDIA_POSITIONS,
  WAVEFORM_SIZES,
  questionMediaSchema,
} from './question-media';

/**
 * A question's content, validated in two layers (UI system §1.5):
 *
 * - **structure** (`questionContentSchema`): what no question may break — bounds,
 *   enums, a field outside its type. Checked on every save; the editor makes it
 *   impossible to break, so an author never meets it.
 * - **completeness** (`questionIssues`): what a question needs to be played — a right
 *   answer ticked, two options, a target… A draft may miss it; a quiz needs it to be
 *   *ready*, and a ready quiz keeps it on every save.
 *
 * Every rule carries a domain code (`question.*`) with its own text in the editor.
 */

export const QUESTION_TYPES = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'text_input',
  'numeric',
  'ordering',
  'poll',
  'image_choice',
] as const;
/** A type of question by its name (the `QuestionType` enum holds the same values). */
export type QuestionTypeName = (typeof QUESTION_TYPES)[number];

/** Answer colours and shapes, in the order the editor gives them to options 1 to 8. */
export const OPTION_COLORS = [
  'red',
  'blue',
  'yellow',
  'green',
  'purple',
  'orange',
  'pink',
  'teal',
] as const;
export const OPTION_SHAPES = [
  'triangle',
  'diamond',
  'circle',
  'square',
  'star',
  'hexagon',
  'heart',
  'cross',
] as const;
/** How many options a type with options takes. */
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 8;
export const ACCEPTED_ANSWERS_MAX = 20;
export const PROMPT_MAX = 1000;
export const OPTION_TEXT_MAX = 500;
export const ACCEPTED_ANSWER_MAX = 200;
export const EXPLANATION_MAX = 2000;
/** A question's answering time, and the auto mode's pause on its answer (SQL CHECKs). */
export const TIME_LIMIT_S = { min: 5, max: 240, default: 20 } as const;
export const REVEAL_DELAY_S = { min: 1, max: 300 } as const;

export const POINTS_MODES = ['standard', 'double', 'none', 'fixed'] as const;
export type PointsModeName = (typeof POINTS_MODES)[number];

/** A question's base points by its mode: 1000, 2000 when doubled, none in a poll. */
export function basePointsFor(mode: PointsModeName): number {
  return mode === 'double' ? 2000 : mode === 'none' ? 0 : 1000;
}

/**
 * A typed answer as it is compared (RG-06): lower case, no accents, spaces
 * collapsed. The server computes it; the screens show the accepted answers so.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
export const SCORINGS = ['standard', 'closest', 'partial', 'lenient'] as const;
export type Scoring = (typeof SCORINGS)[number];

/** Scoring variants each type accepts besides `standard`. */
export const SCORING_BY_TYPE: Record<QuestionTypeName, readonly Scoring[]> = {
  single_choice: [],
  multiple_choice: ['partial'],
  true_false: [],
  text_input: ['lenient'],
  numeric: ['closest'],
  ordering: ['partial'],
  poll: [],
  // `partial` only with several right pictures.
  image_choice: ['partial'],
};

/** The variants a question offers: an image choice gives partial credit only with several right pictures. */
export const scoringsFor = (type: QuestionTypeName, multiSelect: boolean): readonly Scoring[] =>
  type === 'image_choice' && !multiSelect ? [] : SCORING_BY_TYPE[type];

/** Types built on a list of options. */
export const OPTION_TYPES: readonly QuestionTypeName[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'ordering',
  'poll',
  'image_choice',
];

const optionInputSchema = z.object({
  text: z.string().trim().max(OPTION_TEXT_MAX).optional(),
  mediaId: z.string().length(26).optional(),
  // The picture's alternative text, in the quiz's language (image_choice).
  alt: z.string().trim().max(OPTION_ALT_MAX).optional(),
  color: z.enum(OPTION_COLORS),
  shape: z.enum(OPTION_SHAPES),
  isCorrect: z.boolean().default(false),
  correctOrderIndex: z.number().int().min(0).optional(),
});

const acceptedAnswerInputSchema = z.object({
  text: z.string().trim().min(1).max(ACCEPTED_ANSWER_MAX),
});

/** The structure of a question (always required). Bounds match the SQL CHECKs. */
export const questionContentSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    // May be empty in a draft: a question also asks through its media.
    prompt: z.string().trim().max(PROMPT_MAX),
    // Markdown, shown at REVEAL only (#5). `null` clears it.
    answerExplanation: z.string().trim().max(EXPLANATION_MAX).nullable().optional(),
    ...backgroundFields,
    // Visual + audio slots (shared contract: never a video with an audio track).
    media: questionMediaSchema.optional(),
    // Where the visual sits against the text on the projection.
    mediaPosition: z.enum(MEDIA_POSITIONS).default('bottom'),
    timeLimitS: z
      .number()
      .int()
      .min(TIME_LIMIT_S.min)
      .max(TIME_LIMIT_S.max)
      .default(TIME_LIMIT_S.default),
    // Auto-mode delay on REVEAL (#6); null = engine default.
    revealDelayS: z
      .number()
      .int()
      .min(REVEAL_DELAY_S.min)
      .max(REVEAL_DELAY_S.max)
      .nullable()
      .optional(),
    // Which devices play its sound; null = the game's default.
    audioTarget: z.enum(AUDIO_TARGETS).nullable().optional(),
    // How thick its waveform is drawn on the screens.
    waveformSize: z.enum(WAVEFORM_SIZES).default('M'),
    // Listen first: the timer starts when the media ends (a known duration is needed).
    timerAfterMedia: z.boolean().default(false),
    pointsMode: z.enum(POINTS_MODES).default('standard'),
    // Per-type scoring rule (see `SCORING_BY_TYPE`); `standard` everywhere by default.
    scoring: z.enum(SCORINGS).default('standard'),
    numericValue: z.number().optional(),
    numericTolerance: z.number().min(0).optional(),
    // image_choice: several pictures may be right.
    multiSelect: z.boolean().default(false),
    options: z.array(optionInputSchema).max(OPTIONS_MAX).default([]),
    acceptedAnswers: z.array(acceptedAnswerInputSchema).max(ACCEPTED_ANSWERS_MAX).default([]),
  })
  .superRefine((d, ctx) => {
    const add = (issue: { message: string; path: (string | number)[] }) =>
      ctx.addIssue({ code: 'custom', ...issue });
    if (!noBackgroundConflict(d)) {
      add({ message: 'slide.background_conflict', path: ['backgroundGradient'] });
    }
    if (d.scoring !== 'standard' && !scoringsFor(d.type, d.multiSelect).includes(d.scoring)) {
      add({ message: 'question.scoring.not_available', path: ['scoring'] });
    }
    // Fields outside their type.
    if (!OPTION_TYPES.includes(d.type) && d.options.length > 0) {
      add({ message: 'question.options.not_allowed', path: ['options'] });
    }
    if (d.type !== 'text_input' && d.acceptedAnswers.length > 0) {
      add({ message: 'question.accepted_answers.not_allowed', path: ['acceptedAnswers'] });
    }
    if (d.type !== 'numeric' && (d.numericValue != null || d.numericTolerance != null)) {
      add({ message: 'question.numeric.not_allowed', path: ['numericValue'] });
    }
    if (d.type !== 'image_choice' && d.multiSelect) {
      add({ message: 'question.multi_select.not_allowed', path: ['multiSelect'] });
    }
    if (d.type === 'poll' && d.options.some((o) => o.isCorrect)) {
      add({ message: 'question.poll.no_correct', path: ['options'] });
    }
    if (d.type === 'true_false' && d.options.length > 2) {
      add({ message: 'question.true_false.two_options', path: ['options'] });
    }
    if (d.type === 'ordering') {
      // Positions are chosen by swapping them: always a permutation of 0..n-1.
      const idx = d.options.map((o) => o.correctOrderIndex);
      const sorted = [...idx].sort((a, b) => (a ?? -1) - (b ?? -1));
      if (!sorted.every((v, i) => v === i)) {
        add({ message: 'question.ordering.positions', path: ['options'] });
      }
    }
    if (d.type === 'image_choice') {
      d.options.forEach((o, i) => {
        if (o.text) add({ message: 'question.image.no_text', path: ['options', i, 'text'] });
      });
      // The answers are the pictures: no picture or video of the question's own.
      if (d.media?.visual) add({ message: 'question.image.no_visual', path: ['media'] });
    }
  });

export type QuestionContent = z.infer<typeof questionContentSchema>;
export type QuestionContentInput = z.input<typeof questionContentSchema>;

/** A rule of completeness a question misses, and where. */
export interface QuestionIssue {
  code: string;
  path: (string | number)[];
}

/** What completeness reads of a question: its payload, or a stored row mapped to it. */
export interface QuestionCompletenessInput {
  type: QuestionTypeName;
  prompt: string;
  media?: { visual?: unknown; audio?: unknown } | null;
  multiSelect?: boolean;
  numericValue?: number | null;
  numericTolerance?: number | null;
  options?: {
    text?: string | null;
    mediaId?: string | null;
    alt?: string | null;
    isCorrect?: boolean;
  }[];
  acceptedAnswers?: { text: string }[];
}

/**
 * What a question still needs to be played (level 3). Empty when it is complete.
 * A draft saves without it; becoming *ready* requires it of every question.
 */
export function questionIssues(q: QuestionCompletenessInput): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const miss = (issue: QuestionIssue) => issues.push(issue);
  const options = q.options ?? [];
  const correct = options.filter((o) => o.isCorrect).length;

  if (!q.prompt.trim() && !q.media?.visual && !q.media?.audio) {
    miss({ code: 'question.prompt.required', path: ['prompt'] });
  }
  if (OPTION_TYPES.includes(q.type) && q.type !== 'image_choice') {
    if (options.length < OPTIONS_MIN) miss({ code: 'question.options.too_few', path: ['options'] });
  }
  switch (q.type) {
    case 'single_choice':
    case 'true_false':
      if (correct !== 1) miss({ code: 'question.options.one_correct', path: ['options'] });
      break;
    case 'multiple_choice':
      if (correct < 1) miss({ code: 'question.options.some_correct', path: ['options'] });
      break;
    case 'text_input':
      if (!(q.acceptedAnswers ?? []).some((a) => a.text.trim())) {
        miss({ code: 'question.accepted_answers.required', path: ['acceptedAnswers'] });
      }
      break;
    case 'numeric':
      if (q.numericValue == null) {
        miss({ code: 'question.numeric.value_required', path: ['numericValue'] });
      }
      if (q.numericTolerance == null) {
        miss({ code: 'question.numeric.tolerance_required', path: ['numericTolerance'] });
      }
      break;
    case 'image_choice':
      if (!(IMAGE_CHOICE_OPTION_COUNTS as readonly number[]).includes(options.length)) {
        miss({ code: 'question.image.count', path: ['options'] });
      }
      if (q.multiSelect ? correct < 1 : correct !== 1) {
        miss({
          code: q.multiSelect ? 'question.options.some_correct' : 'question.options.one_correct',
          path: ['options'],
        });
      }
      options.forEach((o, i) => {
        if (!o.mediaId)
          miss({ code: 'question.image.picture_required', path: ['options', i, 'mediaId'] });
        if (!o.alt?.trim())
          miss({ code: 'question.image.alt_required', path: ['options', i, 'alt'] });
      });
      break;
  }
  return issues;
}
