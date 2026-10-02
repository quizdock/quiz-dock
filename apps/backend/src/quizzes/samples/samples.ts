import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../../admin/settings/settings.service';

/**
 * The sample quizzes ship with the application as bundles (docs/quiz-bundle.md):
 * one folder each under `samples/`, a `quiz.json` next to its `media/`. Their
 * media come from Wikimedia Commons, under licences a CC BY 4.0 quiz can carry,
 * credited in the manifest; `sources.json` says where each came from, and
 * `tools/sample-media` fetches them again.
 */
export interface SampleBundle {
  /** The folder's name: what identifies a sample from one release to the next. */
  key: string;
  manifest: {
    version?: number;
    quiz: {
      title: string;
      description?: string | null;
      language?: string | null;
      license?: string | null;
      revision?: number;
    };
    media?: Record<
      string,
      { alt?: string | null; credit?: string | null } & Record<string, unknown>
    >;
    items: { kind: string; type?: string }[];
  };
  /** The manifest as shipped, byte for byte. */
  manifestText: string;
  /** `media/<name>` → bytes. */
  files: Record<string, Buffer>;
}

/** `SAMPLES_DIR`, else `samples/` in the working directory (the image's `/app`, the dev `apps/backend`). */
export function samplesDir(): string {
  return settings.path(SETTINGS.SAMPLES_DIR);
}

let cache: { dir: string; samples: SampleBundle[] } | null = null;

/** Every shipped sample, in folder order; none when the folder is missing. */
export function loadSamples(dir = samplesDir()): SampleBundle[] {
  if (cache?.dir === dir) return cache.samples;
  const samples: SampleBundle[] = [];
  const names = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const key of names) {
    const manifestPath = join(dir, key, 'quiz.json');
    if (!existsSync(manifestPath)) continue;
    const manifestText = readFileSync(manifestPath, 'utf8');
    const files: Record<string, Buffer> = {};
    const mediaDir = join(dir, key, 'media');
    for (const name of existsSync(mediaDir) ? readdirSync(mediaDir).sort() : []) {
      files[`media/${name}`] = readFileSync(join(mediaDir, name));
    }
    samples.push({
      key,
      manifest: JSON.parse(manifestText) as SampleBundle['manifest'],
      manifestText,
      files,
    });
  }
  cache = { dir, samples };
  return samples;
}

/** How many questions a sample holds. */
export const questionCountOf = (sample: SampleBundle): number =>
  sample.manifest.items.filter((it) => it.kind === 'question').length;
