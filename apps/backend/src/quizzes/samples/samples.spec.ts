import { questionIssues, slideIssues } from '@quiz-dock/contracts';
import { quizBundleSchema } from '../portable/quiz-bundle.schema';
import { collectMediaPaths, fromBundle } from '../portable/quiz-bundle';
import { ulid } from 'ulid';
import { loadSamples } from './samples';

const kindOf = (path: string) => (path.endsWith('.mp3') ? 'audio' : 'image');

describe('the shipped samples', () => {
  const samples = loadSamples();

  it('all in English', () => {
    expect(samples.map((s) => [s.key, s.manifest.quiz.language])).toEqual([
      ['discover-france', 'en'],
      ['discover-taiwan', 'en'],
      ['discover-turkiye', 'en'],
    ]);
  });

  describe.each(samples.map((s) => [s.key, s] as const))('%s', (_key, sample) => {
    const parsed = quizBundleSchema.safeParse(sample.manifest);

    it('is a bundle the importer takes, every step complete (a ready quiz)', () => {
      expect(parsed.error?.issues ?? null).toBeNull();
      const bundle = parsed.data!;
      const ids = new Map<string, string>();
      const idFor = (path: string) => ids.get(path) ?? ids.set(path, ulid()).get(path)!;
      let imported;
      try {
        imported = fromBundle(bundle, idFor, kindOf);
      } catch (err) {
        throw new Error(JSON.stringify(err), { cause: err });
      }
      for (const q of imported.questions) {
        expect({ prompt: q.prompt, issues: questionIssues(q) }).toEqual({
          prompt: q.prompt,
          issues: [],
        });
      }
      for (const { content } of imported.slides) {
        expect(slideIssues({ ...content, blocks: content.blocks as unknown[] })).toEqual([]);
      }
    });

    it('shows every question type, a picture and a slide with media', () => {
      const types = new Set(
        sample.manifest.items.flatMap((it) => (it.kind === 'question' && it.type ? [it.type] : [])),
      );
      expect([...types].sort()).toEqual([
        'image_choice',
        'multiple_choice',
        'numeric',
        'ordering',
        'poll',
        'single_choice',
        'text_input',
        'true_false',
      ]);
    });

    it('ships exactly the media it uses, each credited, the pictures described', () => {
      const used = collectMediaPaths(parsed.data!);
      expect([...used].sort()).toEqual(Object.keys(sample.files).sort());
      for (const path of used) {
        const meta = sample.manifest.media?.[path];
        expect({ path, credit: meta?.credit }).toEqual({
          path,
          credit: expect.stringContaining('Wikimedia Commons'),
        });
        if (kindOf(path) === 'image') expect(meta?.alt).toBeTruthy();
        else
          expect(meta).toMatchObject({ durationMs: expect.any(Number), peaks: expect.any(Array) });
      }
    });
  });
});
