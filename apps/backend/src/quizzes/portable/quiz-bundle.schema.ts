import {
  AUDIO_TARGETS,
  WAVEFORM_SIZES,
  audioPeaksSchema,
  loudnessSchema,
  peakDbfsSchema,
  QUIZ_MAX_TAGS,
  SLUG_MAX_LENGTH,
  TAG_MAX_LENGTH,
  TAG_RE,
} from '@quiz-dock/contracts';
import { z } from 'zod';
import { gradientSchema } from '../../common/background.schema';
import { QUESTION_TYPES } from '../../questions/dto/question-content.schema';

/**
 * Portable quiz bundle (#19): `quiz.json` next to a `media/` folder, shipped as
 * a zip and shared as-is in the Quiz Store. Author-level format — no ids, no
 * owner, no statistics — with media referenced by relative path and the items
 * listed in sequence order (slides and questions interleaved).
 *
 * Structural validation only: once the media are uploaded, each item goes
 * through the API content schemas (`questionContentSchema`, `slideContentSchema`)
 * which carry the per-type rules.
 */
export const BUNDLE_FORMAT = 'quizdock/quiz';
/**
 * Schema version of the manifest. A bundle written before this field existed
 * reads as version 0 (same layout, every Store field absent); the importer
 * accepts anything up to the current version and fills the defaults.
 */
export const BUNDLE_VERSION = 3;

/** What a bundle says about one media file (all optional: an image carries at most its alt). */
export const bundleMediaMetaSchema = z.object({
  alt: z.string().max(300).nullable().optional(),
  /** Author, licence, source (#53): the attribution a licence asks for travels with the file. */
  credit: z.string().max(300).nullable().optional(),
  /** The name the author knew the file by, for their library. */
  name: z.string().max(200).nullable().optional(),
  durationMs: z.number().int().positive().optional(),
  peaks: audioPeaksSchema.optional(),
  origin: z.enum(['upload', 'recording']).optional(),
  loudnessLufs: loudnessSchema.optional(),
  peakDbfs: peakDbfsSchema.optional(),
});
export type BundleMediaMeta = z.infer<typeof bundleMediaMetaSchema>;

/** A media path inside the bundle: flat, under `media/`, no traversal. */
export const mediaPathSchema = z.string().regex(/^media\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/);

/** Kebab-case identifier: the quiz `slug`, and each tag. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const slugSchema = z.string().regex(SLUG_RE).max(SLUG_MAX_LENGTH);
export const tagSchema = z.string().regex(TAG_RE).max(TAG_MAX_LENGTH);
export const MAX_TAGS = QUIZ_MAX_TAGS;

/**
 * Quiz Store metadata (#20): the fields a future catalogue needs and that would
 * be costly to retrofit. `slug` is the only identity that travels — never an
 * internal id. `namespace` is reserved for a Store submission (`<username>/<slug>`)
 * and stays null on a local export.
 */
const storeBundleFields = {
  slug: slugSchema.optional(),
  namespace: z.string().min(1).max(120).nullable().optional(),
  /** Content revision, bumped by every export (an integer, not semver). */
  revision: z.number().int().min(0).optional(),
  /** ISO 8601, UTC. */
  updatedAt: z.iso.datetime().optional(),
  /** Vocabulary to be closed by the Store; free text until then. */
  domain: z.string().trim().min(1).max(50).nullable().optional(),
  tags: z.array(tagSchema).max(MAX_TAGS).optional(),
  /** SPDX identifier. */
  license: z
    .string()
    .regex(/^[A-Za-z0-9.+-]+$/)
    .max(64)
    .nullable()
    .optional(),
};

const backgroundBundleFields = {
  backgroundImage: mediaPathSchema.nullable().optional(),
  backgroundGradient: gradientSchema.nullable().optional(),
  textTone: z.enum(['light', 'dark']).optional(),
  textOutline: z.boolean().optional(),
};

const optionBundleSchema = z.object({
  text: z.string().optional(),
  media: mediaPathSchema.optional(),
  color: z.string(),
  shape: z.string(),
  isCorrect: z.boolean().optional(),
  correctOrderIndex: z.number().int().optional(),
});

export const questionBundleSchema = z.object({
  kind: z.literal('question'),
  type: z.enum(QUESTION_TYPES),
  prompt: z.string(),
  /** The visual slot: an image, or an MP4 video (version 3). */
  media: mediaPathSchema.optional(),
  /** The audio slot: an MP3, never alongside a video (version 3). */
  audio: mediaPathSchema.optional(),
  answerExplanation: z.string().nullable().optional(),
  ...backgroundBundleFields,
  timeLimitS: z.number().int().optional(),
  revealDelayS: z.number().int().nullable().optional(),
  /** Which devices play its sound (version 3); absent = the quiz's default. */
  audioTarget: z.enum(AUDIO_TARGETS).optional(),
  /** How thick its waveform is drawn (version 3); absent = M. */
  waveformSize: z.enum(WAVEFORM_SIZES).optional(),
  /** The timer starts when the media ends (version 3); absent = with the question. */
  timerAfterMedia: z.boolean().optional(),
  pointsMode: z.enum(['standard', 'double', 'none', 'fixed']).optional(),
  scoring: z.enum(['standard', 'closest', 'partial', 'lenient']).optional(),
  numericValue: z.number().optional(),
  numericTolerance: z.number().optional(),
  options: z.array(optionBundleSchema).optional(),
  acceptedAnswers: z.array(z.string()).optional(),
});

/** Slide blocks are validated by `slideContentSchema` after media resolution; here only the media paths matter. */
export const slideBundleSchema = z.object({
  kind: z.literal('slide'),
  blocks: z.array(z.unknown()).optional(),
  ...backgroundBundleFields,
  displayDelayS: z.number().int().nullable().optional(),
});

export const quizBundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().min(0).max(BUNDLE_VERSION).optional(),
  quiz: z.object({
    // Not blank: written as a pattern so the published JSON Schema says it too.
    title: z.string().trim().regex(/\S/).max(200),
    description: z.string().nullable().optional(),
    /** BCP 47 tag — a dedicated field, never a tag. */
    language: z.string().min(2).max(10).optional(),
    feedbackEnabled: z.boolean().optional(),
    /** Pause after a question's media before its time can run out (s, version 3). */
    mediaTailS: z.number().int().min(0).max(30).optional(),
    /** Playback level, LUFS: -14 loud, -16 balanced, -23 calm (version 3). */
    loudnessTargetLufs: z.union([z.literal(-14), z.literal(-16), z.literal(-23)]).optional(),
    /** Which devices play the sounds (version 3); absent = projection and remote players. */
    audioTarget: z.enum(AUDIO_TARGETS).optional(),
    cover: mediaPathSchema.nullable().optional(),
    ...storeBundleFields,
  }),
  /**
   * What each media file carries beyond its bytes, keyed by the same path the
   * items reference: its alternative text (#43, version 2); for a sound or a
   * video, what the editor measured on it (version 3) — a sound cannot be
   * imported without its duration and waveform, the players draw them. Absent
   * in a version 1 bundle, and an image may have no entry at all.
   */
  media: z.record(mediaPathSchema, bundleMediaMetaSchema).optional(),
  items: z.array(z.discriminatedUnion('kind', [questionBundleSchema, slideBundleSchema])).max(500),
});

export type QuizBundle = z.infer<typeof quizBundleSchema>;
export type QuestionBundleItem = z.infer<typeof questionBundleSchema>;
export type SlideBundleItem = z.infer<typeof slideBundleSchema>;
