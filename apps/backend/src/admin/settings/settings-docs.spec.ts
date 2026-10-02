import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIGURATION_FILE,
  ENV_EXAMPLE_FILE,
  configurationText,
  envExampleText,
} from './settings-docs';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the documentation generated from the settings registry', () => {
  it(`${CONFIGURATION_FILE} carries the current environment reference (pnpm generate:settings-docs)`, () => {
    const committed = read(CONFIGURATION_FILE);
    expect(committed).toBe(configurationText(committed));
  });

  it(`${ENV_EXAMPLE_FILE} is the current one (pnpm generate:settings-docs)`, () => {
    expect(read(ENV_EXAMPLE_FILE)).toBe(envExampleText());
  });
});
