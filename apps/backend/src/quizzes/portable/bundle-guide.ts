import { z } from 'zod';
import {
  OPTION_COLORS,
  OPTION_SHAPES,
  OPTIONS_MAX,
  OPTIONS_MIN,
  POINTS_MODES,
  QUESTION_TYPES,
  SCORING_BY_TYPE,
  questionContentSchema,
} from '../../questions/dto/question-content.schema';
import { slideBlockSchema } from '../../slides/dto/slide-content.schema';
import { bundleSchemaId } from './bundle-json-schema';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  type QuizBundle,
  bundleVersionOf,
  quizBundleSchema,
} from './quiz-bundle.schema';

/**
 * The format guide: how to write a `quiz.json` by hand or with a chatbot
 * (docs/self-hosting/import-from-other-tools.md). Generated from the importer's
 * own schemas, like the JSON Schema, so every bound and every name follows the
 * code; a test keeps the committed file in step. It covers the text-only part
 * of the format: what a converted quiz can carry. Unlike the JSON Schema it is
 * not frozen per manifest version — it describes what the importer takes today.
 */
export const BUNDLE_GUIDE_FILE = 'schema/quiz-format-guide.md';

/**
 * The types a text-only file can hold: an image choice's answers are pictures,
 * which the guide leaves out (as every media).
 */
const GUIDE_TYPES = QUESTION_TYPES.filter(
  (t): t is Exclude<(typeof QUESTION_TYPES)[number], 'image_choice'> => t !== 'image_choice',
);
type QuestionType = (typeof GUIDE_TYPES)[number];

/**
 * Every field of the format is either described by the guide or left out on
 * purpose (media, layout, store metadata): a new field has to be sorted into
 * one of the two before the build passes.
 */
export const GUIDE_FIELDS = {
  bundle: { described: ['format', 'version', 'quiz', 'items'], left: ['media'] },
  quiz: {
    described: ['title', 'description', 'language'],
    left: [
      'feedbackEnabled',
      'mediaTailS',
      'loudnessTargetLufs',
      'audioTarget',
      'cover',
      'slug',
      'namespace',
      'revision',
      'updatedAt',
      'domain',
      'tags',
      'license',
    ],
  },
  question: {
    described: [
      'kind',
      'type',
      'prompt',
      'answerExplanation',
      'timeLimitS',
      'pointsMode',
      'scoring',
      'numericValue',
      'numericTolerance',
      'options',
      'acceptedAnswers',
    ],
    left: [
      'media',
      'audio',
      'backgroundImage',
      'backgroundGradient',
      'textTone',
      'textOutline',
      'revealDelayS',
      'audioTarget',
      'waveformSize',
      'mediaPosition',
      'timerAfterMedia',
      'multiSelect',
    ],
  },
  option: {
    described: ['text', 'color', 'shape', 'isCorrect', 'correctOrderIndex'],
    left: ['media', 'alt'],
  },
  slide: {
    described: ['kind', 'blocks'],
    left: [
      'backgroundImage',
      'backgroundGradient',
      'textTone',
      'textOutline',
      'video',
      'videoLoop',
      'videoSound',
      'audio',
      'waveformSize',
      'audioTarget',
      'displayDelayS',
    ],
  },
  block: { described: ['heading', 'text'], left: ['image', 'columns'] },
} as const;

/** What each type asks for, beyond the fields every question shares. */
const TYPE_RULES: Record<QuestionType, string> = {
  single_choice: `one correct answer. ${OPTIONS_MIN} to ${OPTIONS_MAX} options, exactly one with \`"isCorrect": true\`.`,
  multiple_choice: `several correct answers. ${OPTIONS_MIN} to ${OPTIONS_MAX} options, at least one with \`"isCorrect": true\`.`,
  true_false: `true or false. Exactly 2 options, "True" then "False" written in the quiz's language, exactly one with \`"isCorrect": true\`.`,
  text_input:
    'the player types the answer. No `options`; `acceptedAnswers` lists the accepted spellings (case and accents are ignored when comparing).',
  numeric:
    'the answer is a number (a slider, a year, a count). No `options`; `numericValue` is the right number, `numericTolerance` the margin accepted on either side (0 = exact).',
  ordering: `answers to put in order (a puzzle). ${OPTIONS_MIN} to ${OPTIONS_MAX} options, in any display order, each with \`correctOrderIndex\`: its place in the right order, counted from 0, each place used once.`,
  poll: `a survey, no correct answer and no points. ${OPTIONS_MIN} to ${OPTIONS_MAX} options, none with \`isCorrect\`.`,
};

/** What each points mode means for the players. */
const POINTS_TEXT: Record<(typeof POINTS_MODES)[number], string> = {
  standard: 'faster answers score more',
  double: 'twice that',
  none: 'no points',
  fixed: 'full points whatever the speed',
};

/** A small quiz using every type once, and a slide: the guide's example, checked by a test. */
export function guideExample(): z.input<typeof quizBundleSchema> {
  const opt = (i: number, text: string, extra: Record<string, unknown> = {}) => ({
    text,
    color: OPTION_COLORS[i],
    shape: OPTION_SHAPES[i],
    ...extra,
  });
  const byType: Record<QuestionType, Record<string, unknown>> = {
    single_choice: {
      prompt: 'Which planet is the largest?',
      timeLimitS: 20,
      options: [
        opt(0, 'Mars'),
        opt(1, 'Jupiter', { isCorrect: true }),
        opt(2, 'Venus'),
        opt(3, 'Mercury'),
      ],
    },
    multiple_choice: {
      prompt: 'Which of these are gas giants?',
      timeLimitS: 30,
      options: [
        opt(0, 'Jupiter', { isCorrect: true }),
        opt(1, 'Earth'),
        opt(2, 'Saturn', { isCorrect: true }),
      ],
    },
    true_false: {
      prompt: 'The Sun is a star.',
      timeLimitS: 10,
      answerExplanation: 'A yellow dwarf, about 4.6 billion years old.',
      options: [opt(0, 'True', { isCorrect: true }), opt(1, 'False')],
    },
    text_input: {
      prompt: 'What is the name of our galaxy?',
      pointsMode: 'double',
      acceptedAnswers: ['Milky Way', 'The Milky Way'],
    },
    numeric: {
      prompt: 'In which year did a human first walk on the Moon?',
      numericValue: 1969,
      numericTolerance: 0,
    },
    ordering: {
      prompt: 'Put these planets in order, closest to the Sun first.',
      timeLimitS: 60,
      options: [
        opt(0, 'Earth', { correctOrderIndex: 2 }),
        opt(1, 'Mercury', { correctOrderIndex: 0 }),
        opt(2, 'Venus', { correctOrderIndex: 1 }),
      ],
    },
    poll: {
      prompt: 'Which planet would you visit?',
      options: [opt(0, 'Mars'), opt(1, 'Saturn'), opt(2, 'Neptune')],
    },
  };
  const items = [
    {
      kind: 'slide',
      blocks: [
        { type: 'heading', id: 'h1', text: 'Round 1: the planets', level: 1 },
        { type: 'text', id: 't1', md: 'Seven questions, **double points** on the galaxy.' },
      ],
    },
    ...GUIDE_TYPES.map(
      (type) =>
        ({ kind: 'question', type, ...byType[type] }) as z.input<
          typeof quizBundleSchema
        >['items'][number],
    ),
  ] as z.input<typeof quizBundleSchema>['items'];
  return {
    format: BUNDLE_FORMAT,
    // The lowest version it needs, as an export stamps it: text alone never needs the latest.
    version: bundleVersionOf(items as QuizBundle['items']),
    quiz: { title: 'Space', language: 'en' },
    items,
  };
}

/**
 * A node of a generated JSON Schema, walked by hand. Typed as if every keyword
 * were there: one that is not throws, and the tests read every path.
 */
export interface JsonSchema {
  properties: Record<string, JsonSchema>;
  items: JsonSchema;
  anyOf: JsonSchema[];
  oneOf: JsonSchema[];
  type?: string;
  const?: string;
  default?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
}
export const jsonSchema = (schema: z.ZodType): JsonSchema =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
/** The non-null branch of an optional/nullable property. */
const branch = (prop: JsonSchema): JsonSchema =>
  prop.anyOf ? prop.anyOf.find((b) => b.type !== 'null')! : prop;

export function bundleGuideText(): string {
  const version = guideExample().version ?? BUNDLE_VERSION;
  const q = jsonSchema(questionContentSchema).properties;
  const quiz = jsonSchema(quizBundleSchema).properties.quiz.properties;
  const option = q.options.items.properties;
  const leaves = jsonSchema(slideBlockSchema).anyOf[0].oneOf;
  const block = (type: string) => leaves.find((b) => b.properties.type.const === type)!.properties;
  const heading = block('heading');
  const text = block('text');
  const time = q.timeLimitS;
  const scoring = GUIDE_TYPES.filter((t) => SCORING_BY_TYPE[t].length)
    .map((t) => `\`${SCORING_BY_TYPE[t].join('`, `')}\` for ${t}`)
    .join(', ');
  const palette = OPTION_COLORS.map((c, i) => `${i + 1}. \`${c}\` / \`${OPTION_SHAPES[i]}\``).join(
    '\n',
  );
  const left = (keys: readonly string[]) => keys.map((k) => `\`${k}\``).join(', ');

  return `# QuizDock quiz file — format guide

<!-- Generated by \`pnpm generate:schema\` from the importer's schemas. Do not edit by hand. -->

How to write a QuizDock quiz file (\`quiz.json\`) that the importer accepts, text
only. It writes manifest version ${version} of the format \`${BUNDLE_FORMAT}\`; the
structure is also published as a JSON Schema: ${bundleSchemaId(version)}

## The file

\`\`\`json
{ "format": "${BUNDLE_FORMAT}", "version": ${version}, "quiz": { … }, "items": [ … ] }
\`\`\`

- \`quiz.title\` — required, at most ${quiz.title.maxLength} characters.
- \`quiz.description\` — optional, Markdown.
- \`quiz.language\` — the BCP 47 code of the quiz's language (\`en\`, \`fr\`, \`es\`, \`zh-TW\`…).
- \`items\` — the questions and slides, in playing order, at most ${jsonSchema(quizBundleSchema).properties.items.maxItems}.

## Questions

\`{ "kind": "question", "type": "…", "prompt": "…", … }\`

Every question:

- \`prompt\` — required, Markdown, at most ${q.prompt.maxLength} characters.
- \`timeLimitS\` — whole seconds, ${time.minimum} to ${time.maximum}; ${time.default} when left out.
- \`pointsMode\` — ${POINTS_MODES.map((m) => `\`${m}\` (${POINTS_TEXT[m]})`).join(', ')}; \`standard\` when left out.
- \`scoring\` — \`standard\` when left out; also ${scoring}.
- \`answerExplanation\` — optional, Markdown, shown at the reveal, at most ${branch(q.answerExplanation).maxLength} characters.

\`type\`, and what each one asks for:

${GUIDE_TYPES.map((t) => `- \`${t}\` — ${TYPE_RULES[t]}`).join('\n')}

- \`acceptedAnswers\` — ${q.acceptedAnswers.items.properties.text.minLength} to ${q.acceptedAnswers.items.properties.text.maxLength} characters each, at most ${q.acceptedAnswers.maxItems} (plain strings).
- \`numericTolerance\` — ${q.numericTolerance.minimum} or more.

## Options

\`{ "text": "…", "color": "…", "shape": "…", "isCorrect": true }\`

- \`text\` — Markdown, at most ${option.text.maxLength} characters.
- \`isCorrect\` — \`true\` on the correct ones; leave it out on the others.
- \`correctOrderIndex\` — ordering questions only.
- \`color\` and \`shape\` go by position, never repeated within a question:

${palette}

## Slides

A page of information between questions:
\`{ "kind": "slide", "blocks": [ … ] }\`, with at least one block.

- \`{ "type": "heading", "id": "h1", "text": "…", "level": 1 }\` — at most ${heading.text.maxLength} characters; level 1 or 2.
- \`{ "type": "text", "id": "t1", "md": "…" }\` — Markdown, at most ${text.md.maxLength} characters.

Each \`id\` is unique within its slide, at most ${heading.id.maxLength} characters.

## Left out

A converted quiz carries no media and no layout: the author adds them in
QuizDock. Never write these fields (a zipped export carries them, with its files):

- the file: ${left(GUIDE_FIELDS.bundle.left)};
- \`quiz\`: ${left(GUIDE_FIELDS.quiz.left)};
- a question: ${left(GUIDE_FIELDS.question.left)};
- an option: ${left(GUIDE_FIELDS.option.left)};
- a slide: ${left(GUIDE_FIELDS.slide.left)}; block types ${left(GUIDE_FIELDS.block.left)};
- Markdown images (\`![…](…)\`) anywhere.

## Writing it

- Valid JSON: double quotes, no comments, no trailing commas.
- Markdown is read in prompts, options, explanations and slide text: a literal
  \`*\` or \`_\` is written \`\\\\*\` or \`\\\\_\` inside the JSON string.
- An invalid file is refused as a whole; the message names the item (counted
  from 1) and the field at fault.

## Checklist

Go through it before handing the file over; an item that fails makes the whole
import fail.

- [ ] Every \`timeLimitS\` is a whole number from ${time.minimum} to ${time.maximum}: a longer time is written ${time.maximum}.
- [ ] Every \`prompt\` has ${q.prompt.maxLength} characters at most, every option \`text\` ${option.text.maxLength}.
- [ ] Every question with options has ${OPTIONS_MIN} to ${OPTIONS_MAX} of them.
- [ ] \`single_choice\` and \`true_false\`: exactly one \`"isCorrect": true\`; \`multiple_choice\`: at least one; \`poll\`: none.
- [ ] \`ordering\`: the \`correctOrderIndex\` values are 0 to n-1, each once.
- [ ] \`text_input\` has \`acceptedAnswers\` and no options; \`numeric\` has \`numericValue\` and \`numericTolerance\`, and no options.
- [ ] Option \`color\` and \`shape\` follow the positions listed under *Options*.
- [ ] No field from *Left out*, no Markdown image.

## Example

\`\`\`json
${JSON.stringify(guideExample(), null, 2)}
\`\`\`
`;
}
