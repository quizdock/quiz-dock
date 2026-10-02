import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIGURATION_FILE,
  ENV_EXAMPLE_FILE,
  configurationText,
  envExampleText,
} from './admin/settings/settings-docs';

/**
 * Writes the documentation generated from the settings registry
 * (`pnpm generate:settings-docs`): the environment reference of the
 * self-hosting guide and the development stack's `.env.example`.
 */
const ROOT = join(__dirname, '..', '..', '..');
const guide = join(ROOT, CONFIGURATION_FILE);
writeFileSync(guide, configurationText(readFileSync(guide, 'utf8')));
writeFileSync(join(ROOT, ENV_EXAMPLE_FILE), envExampleText());
