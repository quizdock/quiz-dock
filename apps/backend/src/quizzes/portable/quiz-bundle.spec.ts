import { Prisma } from '@prisma/client';
import {
  BundleContentError,
  collectMediaIds,
  collectMediaPaths,
  type ExportableQuiz,
  fromBundle,
  toBundle,
} from './quiz-bundle';
import { quizBundleSchema } from './quiz-bundle.schema';

const IMG = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BG = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const INLINE = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const BLOCK_IMG = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

/** A quiz using every media slot: cover, question media, background, option, image block, inline Markdown. */
function makeQuiz(): ExportableQuiz {
  const now = new Date();
  return {
    id: 'quiz-1',
    ownerId: 'owner',
    title: 'Géo & co',
    description: `Intro ![map](/api/v1/media/${INLINE})`,
    coverMediaId: IMG,
    status: 'ready',
    visibility: 'private',
    language: 'fr',
    questionCount: 2,
    feedbackEnabled: false,
    audioTarget: 'projection',
    slug: 'geo-and-co',
    namespace: null,
    revision: 4,
    domain: 'geography',
    tags: ['capitals', 'europe'],
    license: 'CC-BY-4.0',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    questions: [
      {
        id: 'q1',
        quizId: 'quiz-1',
        orderIndex: 0,
        type: 'single_choice',
        prompt: 'Capital of France?',
        visualMediaId: IMG,
        audioMediaId: null,
        answerExplanation: `Because. ![why](/api/v1/media/${INLINE})`,
        backgroundMediaId: null,
        backgroundGradient: { angle: 90, colors: ['#000000', '#ffffff'] },
        textTone: 'dark',
        textOutline: true,
        timeLimitS: 30,
        revealDelayS: 8,
        audioTarget: 'everyone',
        waveformSize: 'S',
        timerAfterMedia: true,
        pointsMode: 'double',
        scoring: 'standard',
        numericValue: null,
        numericTolerance: null,
        createdAt: now,
        updatedAt: now,
        options: [
          {
            id: 'o1',
            questionId: 'q1',
            orderIndex: 0,
            text: 'Paris',
            mediaId: null,
            color: 'red',
            shape: 'triangle',
            isCorrect: true,
            correctOrderIndex: null,
          },
          {
            id: 'o2',
            questionId: 'q1',
            orderIndex: 1,
            text: null,
            mediaId: IMG,
            color: 'blue',
            shape: 'diamond',
            isCorrect: false,
            correctOrderIndex: null,
          },
        ],
        acceptedAnswers: [],
      },
      {
        id: 'q2',
        quizId: 'quiz-1',
        orderIndex: 1,
        type: 'numeric',
        prompt: 'Pi?',
        mediaId: null,
        answerExplanation: null,
        backgroundMediaId: BG,
        backgroundGradient: null,
        textTone: 'light',
        textOutline: false,
        timeLimitS: 20,
        revealDelayS: null,
        audioTarget: null,
        pointsMode: 'standard',
        scoring: 'standard',
        numericValue: new Prisma.Decimal('3.14'),
        numericTolerance: new Prisma.Decimal('0.01'),
        createdAt: now,
        updatedAt: now,
        options: [],
        acceptedAnswers: [],
      },
    ],
    slides: [
      {
        id: 's-end',
        quizId: 'quiz-1',
        beforeQuestionId: null,
        orderIndex: 0,
        blocks: [{ type: 'heading', id: 'h', text: 'The end', level: 1 }],
        mediaId: null,
        gradient: { angle: 45, colors: ['#111111', '#222222'] },
        displayDelayS: 0,
        textTone: 'light',
        textOutline: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 's-intro',
        quizId: 'quiz-1',
        beforeQuestionId: 'q1',
        orderIndex: 0,
        blocks: [
          { type: 'image', id: 'i', mediaId: BLOCK_IMG, size: 'large', align: 'center' },
          {
            type: 'columns',
            id: 'c',
            columns: [[{ type: 'text', id: 't', md: `See ![x](/api/v1/media/${INLINE})` }], []],
          },
        ],
        mediaId: BG,
        gradient: null,
        displayDelayS: null,
        textTone: 'dark',
        textOutline: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  } as unknown as ExportableQuiz;
}

const pathFor = (id: string) => `media/${id}.png`;
const idFor = (path: string) => path.slice('media/'.length, -'.png'.length);

describe('quiz bundle', () => {
  it('collects every media id, inline Markdown images included', () => {
    expect([...collectMediaIds(makeQuiz())].sort()).toEqual([IMG, BG, INLINE, BLOCK_IMG].sort());
  });

  it('exports items in sequence order with media as relative paths', () => {
    const src = makeQuiz();
    const bundle = toBundle(src, pathFor);
    expect(quizBundleSchema.safeParse(bundle).success).toBe(true);
    expect(bundle.items.map((i) => i.kind)).toEqual(['slide', 'question', 'question', 'slide']);
    expect(bundle.quiz).toMatchObject({
      title: 'Géo & co',
      cover: pathFor(IMG),
      feedbackEnabled: false,
      slug: 'geo-and-co',
      namespace: null,
      revision: 4,
      updatedAt: src.updatedAt.toISOString(),
      domain: 'geography',
      tags: ['capitals', 'europe'],
      license: 'CC-BY-4.0',
    });
    expect(bundle.quiz.description).toBe(`Intro ![map](${pathFor(INLINE)})`);
    expect(JSON.stringify(bundle)).not.toContain('/api/v1/media/');
    // No internal identity travels: the slug is the only one.
    expect(JSON.stringify(bundle)).not.toMatch(/quiz-1|ownerId/);
    expect([...collectMediaPaths(bundle)].sort()).toEqual(
      [IMG, BG, INLINE, BLOCK_IMG].map(pathFor).sort(),
    );
  });

  it('round-trips through import with the API content rules applied', () => {
    const src = makeQuiz();
    const imported = fromBundle(toBundle(src, pathFor), idFor);
    expect(imported).toMatchObject({
      title: 'Géo & co',
      language: 'fr',
      feedbackEnabled: false,
      coverMediaId: IMG,
      slug: 'geo-and-co',
      namespace: null,
      revision: 4,
      domain: 'geography',
      tags: ['capitals', 'europe'],
      license: 'CC-BY-4.0',
      audioTarget: 'projection',
    });
    expect(imported.description).toBe(src.description);
    expect(imported.questions).toHaveLength(2);
    const [q1, q2] = imported.questions;
    expect(q1).toMatchObject({
      type: 'single_choice',
      media: { visual: { kind: 'image', assetId: IMG }, audio: null },
      answerExplanation: src.questions[0].answerExplanation,
      backgroundGradient: { angle: 90, colors: ['#000000', '#ffffff'] },
      textTone: 'dark',
      textOutline: true,
      timeLimitS: 30,
      revealDelayS: 8,
      audioTarget: 'everyone',
      waveformSize: 'S',
      timerAfterMedia: true,
      pointsMode: 'double',
    });
    expect(q1.options.map((o) => [o.text, o.mediaId, o.isCorrect])).toEqual([
      ['Paris', undefined, true],
      [undefined, IMG, false],
    ]);
    expect(q2).toMatchObject({
      type: 'numeric',
      numericValue: 3.14,
      numericTolerance: 0.01,
      backgroundMediaId: BG,
      audioTarget: null,
      waveformSize: 'M', // absent from the bundle: the default
      timerAfterMedia: false,
    });
    expect(imported.slides.map((s) => [s.beforeQuestion, s.orderIndex])).toEqual([
      [0, 0],
      [null, 0],
    ]);
    const intro = imported.slides[0].content;
    expect(intro).toMatchObject({
      mediaId: BG,
      textTone: 'dark',
      textOutline: true,
      displayDelayS: undefined,
    });
    expect(JSON.stringify(intro.blocks)).toContain(`"mediaId":"${BLOCK_IMG}"`);
    expect(JSON.stringify(intro.blocks)).toContain(`/api/v1/media/${INLINE}`);
    expect(imported.slides[1].content.displayDelayS).toBe(0);
  });

  it('rejects an item breaking the per-type rules, naming it', () => {
    const bundle = toBundle(makeQuiz(), pathFor);
    // A numeric question with options is invalid for the API too.
    const numeric = bundle.items[2];
    if (numeric.kind !== 'question') throw new Error('expected a question');
    numeric.options = [{ color: 'red', shape: 'circle', text: 'x' }];
    expect(() => fromBundle(bundle, idFor)).toThrow(BundleContentError);
    try {
      fromBundle(bundle, idFor);
    } catch (err) {
      expect((err as BundleContentError).item).toBe(2);
      expect((err as BundleContentError).issues[0].field).toBe('options');
    }
  });

  it('defaults the Store fields of a bundle that predates them (version 0)', () => {
    const bundle: Record<string, unknown> = { ...toBundle(makeQuiz(), pathFor) };
    const old: Record<string, unknown> = { ...(bundle.quiz as object) };
    delete bundle.version;
    for (const k of [
      'slug',
      'namespace',
      'revision',
      'updatedAt',
      'domain',
      'tags',
      'license',
      'audioTarget',
    ]) {
      delete old[k];
    }
    const rest = { ...bundle, quiz: old };
    const parsed = quizBundleSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    const imported = fromBundle(parsed.data!, idFor);
    expect(imported).toMatchObject({
      slug: 'geo-co', // derived from the title
      namespace: null,
      revision: 0,
      domain: null,
      tags: [],
      license: null,
      audioTarget: 'projection_remote', // the default
    });
    // But never a bundle from a schema newer than this build.
    expect(quizBundleSchema.safeParse({ ...rest, version: 4 }).success).toBe(false);
  });

  it('validates the Store fields: kebab-case slug and tags, five tags at most, SPDX-like license', () => {
    const bundle = toBundle(makeQuiz(), pathFor);
    const withQuiz = (over: Record<string, unknown>) =>
      quizBundleSchema.safeParse({ ...bundle, quiz: { ...bundle.quiz, ...over } }).success;
    expect(withQuiz({ slug: 'Geo Co' })).toBe(false);
    expect(withQuiz({ slug: '-geo' })).toBe(false);
    expect(withQuiz({ tags: ['Capitals'] })).toBe(false);
    expect(withQuiz({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(false);
    expect(withQuiz({ license: 'CC BY 4.0' })).toBe(false);
    expect(withQuiz({ updatedAt: 'yesterday' })).toBe(false);
    expect(withQuiz({ revision: -1 })).toBe(false);
    expect(withQuiz({ license: null, domain: null, namespace: null, tags: [] })).toBe(true);
  });

  it('refuses paths outside media/ and unknown formats', () => {
    const bundle = toBundle(makeQuiz(), pathFor);
    expect(quizBundleSchema.safeParse({ ...bundle, format: 'other' }).success).toBe(false);
    expect(
      quizBundleSchema.safeParse({ ...bundle, quiz: { ...bundle.quiz, cover: '../etc/passwd' } })
        .success,
    ).toBe(false);
    expect(
      quizBundleSchema.safeParse({ ...bundle, quiz: { ...bundle.quiz, cover: 'media/../x.png' } })
        .success,
    ).toBe(false);
  });
});
