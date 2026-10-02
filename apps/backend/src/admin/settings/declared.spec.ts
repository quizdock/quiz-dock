import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOYMENT_VARIABLES, SETTING_LIST, isDeclaredVariable } from '@quiz-dock/contracts';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The variables a file sets, mentions in an example, or interpolates. */
function variablesOf(path: string): string[] {
  const text = read(path);
  const names = [
    ...text.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm),
    ...text.matchAll(/\$\{([A-Z][A-Z0-9_]+)/g),
    ...(path.endsWith('.yml') ? text.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gm) : []),
  ].map((m) => m[1]);
  return [...new Set(names)];
}

const files = [
  '.env.example',
  ...readdirSync(join(ROOT, 'env'))
    .filter((f) => f.endsWith('.env.example'))
    .map((f) => `env/${f}`),
  ...readdirSync(ROOT).filter((f) => /^docker-compose.*\.yml$/.test(f)),
];

describe('every variable is declared', () => {
  it.each(files)('%s names declared variables only', (path) => {
    expect(variablesOf(path).filter((key) => !isDeclaredVariable(key))).toEqual([]);
  });

  it('the backend reads process.env in the settings module only', () => {
    // Named here, not excused by a lint comment (which would excuse anything): the
    // settings' environment source, and the tool that writes the OpenAPI document.
    const allowed = new Set(['admin/settings/settings.service.ts', 'openapi.ts']);
    const readers: string[] = [];
    const src = join(ROOT, 'apps/backend/src');
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
          if (/process\.env\b/.test(readFileSync(path, 'utf8')))
            readers.push(path.slice(src.length + 1));
        }
      }
    };
    walk(src);
    expect(readers.filter((p) => !allowed.has(p))).toEqual([]);
  });

  it('an application setting and a deployment variable never share a name', () => {
    const keys = [...SETTING_LIST.map((d) => d.key), ...DEPLOYMENT_VARIABLES.map((v) => v.key)];
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('the production Compose file passes every operator setting the image does not set itself', () => {
    const compose = read('docker-compose.prod.yml');
    /** Set by the image (Dockerfile `ENV`), or not for operators. */
    const byImage = ['SAMPLES_DIR'];
    const missing = SETTING_LIST.filter(
      (d) => !d.internal && !d.deprecated && !byImage.includes(d.key),
    ).filter((d) => !new RegExp(`^ {6}${d.key}:`, 'm').test(compose));
    expect(missing.map((d) => d.key)).toEqual([]);
  });
});
