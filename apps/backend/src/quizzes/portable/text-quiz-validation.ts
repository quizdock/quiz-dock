import { questionIssues, slideIssues } from '@quiz-dock/contracts';
import { importMaxBytes } from './bundle-archive';
import { quizBundleSchema } from './quiz-bundle.schema';
import { BundleContentError, collectMediaPaths, fromBundle } from './quiz-bundle';

/**
 * Text-only conversion is bounded independently of uploads carrying binary
 * media: 1 MB at most — the size of the request bodies, fixed at start — and
 * never more than an import (read at each call: the administration may lower it).
 */
export const TEXT_QUIZ_MAX_BYTES = 1024 * 1024;
const textQuizMaxBytes = () => Math.min(importMaxBytes(), TEXT_QUIZ_MAX_BYTES);
export interface QuizValidationIssue {
  code: string;
  item?: number;
  field?: string;
  path?: string;
  detail?: string;
}
export interface QuizValidationResult {
  valid: boolean;
  errors: QuizValidationIssue[];
  warnings: QuizValidationIssue[];
}

/** Pure dry-run: the importer's structural and content schemas, with no database, media writes or network. */
export function validateTextQuiz(json: string): QuizValidationResult {
  if (Buffer.byteLength(json, 'utf8') > textQuizMaxBytes())
    return { valid: false, warnings: [], errors: [{ code: 'import.bundle_too_large' }] };
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return { valid: false, warnings: [], errors: [{ code: 'import.invalid_bundle' }] };
  }
  const parsed = quizBundleSchema.safeParse(input);
  if (!parsed.success)
    return {
      valid: false,
      warnings: [],
      errors: parsed.error.issues.slice(0, 100).map((issue) => ({
        code: 'import.invalid_bundle',
        field: issue.path.join('.') || '_',
        detail: issue.code,
      })),
    };
  const bundle = parsed.data;
  const errors: QuizValidationIssue[] = [];
  const warnings: QuizValidationIssue[] = [];
  for (const path of collectMediaPaths(bundle)) errors.push({ code: 'import.media_missing', path });
  if (errors.length) return { valid: false, warnings: [], errors: errors.slice(0, 100) };
  // Check every item so the model can repair several errors in one round.
  bundle.items.forEach((item, index) => {
    if (errors.length >= 100) return;
    try {
      const imported = fromBundle({ ...bundle, items: [item] }, () => {
        throw new Error('Unexpected media reference');
      });
      const issues =
        item.kind === 'question'
          ? questionIssues(imported.questions[0])
          : slideIssues(imported.slides[0].content);
      warnings.push(
        ...issues.map((issue) => ({
          code: issue.code,
          item: index + 1,
          field: issue.path.join('.') || '_',
        })),
      );
    } catch (err) {
      if (err instanceof BundleContentError)
        errors.push(
          ...err.issues.map((issue) => ({
            code: 'import.invalid_item' as const,
            item: index + 1,
            field: issue.field,
            detail: issue.code,
          })),
        );
      else errors.push({ code: 'import.invalid_bundle', item: index + 1 });
    }
  });
  return {
    valid: errors.length === 0,
    errors: errors.slice(0, 100),
    warnings: warnings.slice(0, 100),
  };
}
