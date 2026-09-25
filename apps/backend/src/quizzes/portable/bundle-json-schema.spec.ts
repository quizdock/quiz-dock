import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { BUNDLE_SCHEMA_FILE, bundleJsonSchema, bundleJsonSchemaText } from './bundle-json-schema';
import { quizBundleSchema } from './quiz-bundle.schema';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');

const question = {
  kind: 'question',
  type: 'single_choice',
  prompt: 'Capital of France?',
  media: 'media/paris.webp',
  options: [
    { text: 'Paris', color: 'red', shape: 'triangle', isCorrect: true },
    { text: 'Lyon', color: 'blue', shape: 'diamond' },
  ],
};
const bundle = (quiz: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  format: 'quizdock/quiz',
  version: 3,
  quiz: { title: 'Capitals', language: 'en', ...quiz },
  items: [question],
  ...over,
});

/** Bundles on both sides of every rule the published schema has to carry. */
const VALID: [string, unknown][] = [
  ['a minimal bundle', bundle()],
  ['a bundle written before versioning', bundle({}, { version: undefined })],
  [
    'every Store field',
    bundle({
      slug: 'capitals',
      namespace: null,
      revision: 2,
      updatedAt: '2026-09-25T12:00:00.000Z',
      domain: 'geography',
      tags: ['europe', 'cities'],
      license: 'CC-BY-4.0',
      loudnessTargetLufs: -16,
      audioTarget: 'everyone',
      cover: 'media/paris.webp',
    }),
  ],
  [
    'media metadata',
    bundle({}, { media: { 'media/paris.webp': { alt: 'The Eiffel Tower', credit: 'Own work' } } }),
  ],
  ['a slide', bundle({}, { items: [{ kind: 'slide', blocks: [] }, question] })],
];
const INVALID: [string, unknown][] = [
  ['a blank title', bundle({ title: '   ' })],
  ['a title too long', bundle({ title: 'x'.repeat(201) })],
  ['a newer version', bundle({}, { version: 4 })],
  ['another format', bundle({}, { format: 'kahoot' })],
  ['a slug that is not kebab-case', bundle({ slug: 'Not A Slug' })],
  ['six tags', bundle({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })],
  ['a tag with capitals', bundle({ tags: ['Europe'] })],
  ['a media path outside media/', bundle({}, { items: [{ ...question, media: '../etc/passwd' }] })],
  [
    'a media path in a sub-folder',
    bundle({}, { items: [{ ...question, media: 'media/a/b.png' }] }),
  ],
  ['an unknown question type', bundle({}, { items: [{ ...question, type: 'essay' }] })],
  ['an unknown item kind', bundle({}, { items: [{ kind: 'video' }] })],
  ['a loudness not offered', bundle({ loudnessTargetLufs: -20 })],
  ['a date that is not ISO 8601', bundle({ updatedAt: '25/09/2026' })],
  ['no quiz', { format: 'quizdock/quiz', items: [] }],
];

describe('bundle JSON Schema', () => {
  it('is committed as generated: run `pnpm generate:schema` after changing the bundle schema', () => {
    const committed = readFileSync(join(ROOT, BUNDLE_SCHEMA_FILE), 'utf8');
    expect(committed).toBe(bundleJsonSchemaText());
  });

  it('gives the same verdict as the importer on every case', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(bundleJsonSchema());
    const verdicts = (cases: [string, unknown][]) =>
      cases.map(([name, value]) => ({
        name,
        schema: validate(value),
        importer: quizBundleSchema.safeParse(value).success,
      }));
    for (const v of verdicts(VALID))
      expect(v).toEqual({ name: v.name, schema: true, importer: true });
    for (const v of verdicts(INVALID)) {
      expect(v).toEqual({ name: v.name, schema: false, importer: false });
    }
  });
});
