import { z } from 'zod';
import { BUNDLE_FORMAT, BUNDLE_VERSION, quizBundleSchema } from './quiz-bundle.schema';

/**
 * The bundle manifest (`quiz.json`) as a published JSON Schema, generated from
 * `quizBundleSchema` so the two never drift (a test compares them). One file
 * per manifest version, never rewritten once published: a tool outside
 * QuizDock (the community store, #21) pins the version it validates against,
 * not an app release.
 *
 * Structural, like the first step of an import: the per-type rules of a
 * question or a slide are checked by the API content schemas afterwards.
 */
export const BUNDLE_SCHEMA_FILE = `schema/quiz-bundle.v${BUNDLE_VERSION}.json`;
export const BUNDLE_SCHEMA_ID = `https://raw.githubusercontent.com/quizdock/quiz-dock/main/${BUNDLE_SCHEMA_FILE}`;

export function bundleJsonSchema(): Record<string, unknown> {
  const { $schema, ...body } = z.toJSONSchema(quizBundleSchema, {
    target: 'draft-2020-12',
    // What a bundle may contain, as written: defaults are the importer's business.
    io: 'input',
  });
  return {
    $schema,
    $id: BUNDLE_SCHEMA_ID,
    title: `QuizDock quiz bundle manifest (${BUNDLE_FORMAT}), version ${BUNDLE_VERSION}`,
    description:
      'quiz.json at the root of a QuizDock bundle, next to its media/ folder. Structural rules only; see docs/quiz-bundle.md.',
    ...body,
  };
}

/** The file content, as committed: stable key order, trailing newline. */
export function bundleJsonSchemaText(): string {
  return `${JSON.stringify(bundleJsonSchema(), null, 2)}\n`;
}
