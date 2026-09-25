import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_SCHEMA_FILE, bundleJsonSchemaText } from './quizzes/portable/bundle-json-schema';

/**
 * Writes the bundle JSON Schema of the current manifest version at the repo
 * root (`pnpm generate:schema`). Earlier versions stay as they were published.
 */
writeFileSync(join(__dirname, '..', '..', '..', BUNDLE_SCHEMA_FILE), bundleJsonSchemaText());
