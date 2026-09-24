import { BadRequestException, NotFoundException } from '@nestjs/common';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { MediaService } from '../../media/media.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { QuizPortableService, slugify } from './quiz-portable.service';

const OWNER = 'owner-1';

const manifest = (over: Record<string, unknown> = {}) => ({
  format: 'quizdock/quiz',
  version: 1,
  quiz: { title: 'Ports', language: 'en' },
  items: [
    { kind: 'slide', blocks: [{ type: 'image', id: 'i', media: 'media/a.png' }] },
    {
      kind: 'question',
      type: 'true_false',
      prompt: 'Sure?',
      options: [
        { text: 'True', color: 'red', shape: 'triangle', isCorrect: true },
        { text: 'False', color: 'blue', shape: 'diamond' },
      ],
    },
  ],
  ...over,
});

const zipOf = (json: unknown, files: Record<string, Uint8Array> = {}) =>
  Buffer.from(zipSync({ 'quiz.json': strToU8(JSON.stringify(json)), ...files }));

function makePrisma() {
  const tx = {
    quiz: { create: jest.fn() },
    slide: { createMany: jest.fn() },
  };
  return {
    tx,
    quiz: { findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
}

function makeMedia() {
  let n = 0;
  return {
    maxUploadBytes: 64 * 1024, // roomy enough for a manifest carrying a waveform
    upload: jest.fn(async (_owner: string, file: { mimetype: string }) => ({
      mediaId: `01ARZ3NDEKTSV4RRFFQ69G5FA${n++}`,
      url: '',
      kind: file.mimetype.split('/')[0] as 'image' | 'video' | 'audio',
    })),
    readAsset: jest.fn(),
  };
}

describe('QuizPortableService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let media: ReturnType<typeof makeMedia>;
  let service: QuizPortableService;

  beforeEach(() => {
    prisma = makePrisma();
    media = makeMedia();
    service = new QuizPortableService(
      prisma as unknown as PrismaService,
      media as unknown as MediaService,
    );
    prisma.tx.quiz.create.mockImplementation(
      ({ data }: { data: { questions: { create: unknown[] } } }) =>
        Promise.resolve({
          id: 'new',
          questions: data.questions.create.map((_q, orderIndex) => ({
            id: `nq${orderIndex}`,
            orderIndex,
          })),
        }),
    );
  });

  describe('import', () => {
    it('brings back a video and a sound with its measures (version 3)', async () => {
      const peaks = new Array(200).fill(0.25);
      const options = [
        { text: 'A', color: 'red', shape: 'triangle' },
        { text: 'B', color: 'blue', shape: 'diamond' },
      ];
      const buffer = zipOf(
        {
          format: 'quizdock/quiz',
          version: 3,
          quiz: { title: 'Media' },
          media: {
            'media/tone.mp3': { durationMs: 8000, peaks, loudnessLufs: -18, peakDbfs: -3 },
          },
          items: [
            { kind: 'question', type: 'poll', prompt: 'Film', media: 'media/clip.mp4', options },
            { kind: 'question', type: 'poll', prompt: 'Song', audio: 'media/tone.mp3', options },
          ],
        },
        { 'media/clip.mp4': new Uint8Array([1]), 'media/tone.mp3': new Uint8Array([2]) },
      );
      await service.importBundle(OWNER, { buffer, mimetype: 'application/zip' });
      expect(media.upload).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ mimetype: 'audio/mpeg' }),
        expect.objectContaining({
          durationMs: 8000,
          peaks: JSON.stringify(peaks),
          loudnessLufs: -18,
          peakDbfs: -3,
        }),
      );
      const created = prisma.tx.quiz.create.mock.calls[0][0] as {
        data: {
          questions: { create: { visualMediaId: string | null; audioMediaId: string | null }[] };
        };
      };
      const [film, song] = created.data.questions.create;
      expect(film.visualMediaId).toMatch(/^01ARZ/);
      expect(film.audioMediaId).toBeNull();
      expect(song.visualMediaId).toBeNull();
      expect(song.audioMediaId).toMatch(/^01ARZ/);
    });

    it('refuses a sound that comes without its measures', async () => {
      const options = [
        { text: 'A', color: 'red', shape: 'triangle' },
        { text: 'B', color: 'blue', shape: 'diamond' },
      ];
      const buffer = zipOf(
        {
          format: 'quizdock/quiz',
          version: 3,
          quiz: { title: 'Media' },
          items: [
            { kind: 'question', type: 'poll', prompt: 'Song', audio: 'media/t.mp3', options },
          ],
        },
        { 'media/t.mp3': new Uint8Array([2]) },
      );
      await expect(
        service.importBundle(OWNER, { buffer, mimetype: 'application/zip' }),
      ).rejects.toMatchObject({ response: { code: 'import.invalid_item' } });
    });

    it('uploads the media, creates a draft and anchors the slides', async () => {
      const buffer = zipOf(manifest(), { 'media/a.png': new Uint8Array([1, 2, 3]) });
      const quiz = await service.importBundle(OWNER, { buffer, mimetype: 'application/zip' });

      expect(quiz.id).toBe('new');
      expect(media.upload).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ mimetype: 'image/png', size: 3 }),
        expect.anything(),
      );
      const data = prisma.tx.quiz.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        ownerId: OWNER,
        title: 'Ports',
        status: 'draft',
        questionCount: 1,
        // Store fields absent from the bundle: defaults, slug derived from the title.
        slug: 'ports',
        namespace: null,
        revision: 0,
        domain: null,
        tags: [],
        license: null,
      });
      expect(data.questions.create[0]).toMatchObject({ orderIndex: 0, type: 'true_false' });
      expect(data.questions.create[0].options.create).toHaveLength(2);
      const slides = prisma.tx.slide.createMany.mock.calls[0][0].data;
      expect(slides).toHaveLength(1);
      expect(slides[0]).toMatchObject({ quizId: 'new', beforeQuestionId: 'nq0', orderIndex: 0 });
      expect(JSON.stringify(slides[0].blocks)).toContain('"mediaId":"01ARZ3NDEKTSV4RRFFQ69G5FA0"');
    });

    it('accepts a bare quiz.json when it needs no media', async () => {
      const json = manifest({ items: [manifest().items[1]] });
      const buffer = Buffer.from(JSON.stringify(json));
      await service.importBundle(OWNER, { buffer, mimetype: 'application/json' });
      expect(media.upload).not.toHaveBeenCalled();
      expect(prisma.tx.slide.createMany).not.toHaveBeenCalled();
    });

    it('keeps the Store fields of a bundle that carries them', async () => {
      const json = manifest({
        items: [manifest().items[1]],
        quiz: {
          title: 'Ports',
          slug: 'harbours-101',
          namespace: 'alice/harbours-101',
          revision: 3,
          updatedAt: '2026-09-01T10:00:00.000Z',
          domain: 'geography',
          tags: ['sea', 'europe'],
          license: 'CC-BY-4.0',
        },
      });
      await service.importBundle(OWNER, {
        buffer: Buffer.from(JSON.stringify(json)),
        mimetype: '',
      });
      expect(prisma.tx.quiz.create.mock.calls[0][0].data).toMatchObject({
        slug: 'harbours-101',
        namespace: 'alice/harbours-101',
        // The copy has never been shared: the origin's revision is not its own (#39).
        revision: 0,
        domain: 'geography',
        tags: ['sea', 'europe'],
        license: 'CC-BY-4.0',
      });
    });

    it('reads a bundle written before the schema was versioned', async () => {
      const json = manifest({ items: [manifest().items[1]], version: undefined });
      await service.importBundle(OWNER, {
        buffer: Buffer.from(JSON.stringify(json)),
        mimetype: '',
      });
      expect(prisma.tx.quiz.create).toHaveBeenCalled();
    });

    it('refuses a bundle from a newer schema, a bad slug, too many tags', async () => {
      const only = [manifest().items[1]];
      for (const json of [
        manifest({ items: only, version: 4 }),
        manifest({ items: only, quiz: { title: 'X', slug: 'Not A Slug' } }),
        manifest({ items: only, quiz: { title: 'X', tags: ['a', 'b', 'c', 'd', 'e', 'f'] } }),
      ]) {
        await expect(
          service.importBundle(OWNER, { buffer: Buffer.from(JSON.stringify(json)), mimetype: '' }),
        ).rejects.toMatchObject({ response: { code: 'import.invalid_bundle' } });
      }
      expect(prisma.tx.quiz.create).not.toHaveBeenCalled();
    });

    it('rejects a referenced media absent from the zip, before touching the database', async () => {
      const buffer = zipOf(manifest());
      await expect(
        service.importBundle(OWNER, { buffer, mimetype: 'application/zip' }),
      ).rejects.toMatchObject({
        response: { code: 'import.media_missing', params: { path: 'media/a.png' } },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an unknown media type and an oversize entry', async () => {
      const svg = manifest({
        items: [{ kind: 'slide', blocks: [{ type: 'image', id: 'i', media: 'media/a.svg' }] }],
      });
      await expect(
        service.importBundle(OWNER, {
          buffer: zipOf(svg, { 'media/a.svg': new Uint8Array(1) }),
          mimetype: '',
        }),
      ).rejects.toMatchObject({ response: { code: 'import.media_unsupported' } });
      // Larger than the upload limit: filtered out of the zip, hence reported missing.
      const big = new Uint8Array(media.maxUploadBytes + 1);
      await expect(
        service.importBundle(OWNER, {
          buffer: zipOf(manifest(), { 'media/a.png': big }),
          mimetype: '',
        }),
      ).rejects.toMatchObject({ response: { code: 'import.media_missing' } });
    });

    it('rejects a broken manifest and an item failing the content rules', async () => {
      await expect(
        service.importBundle(OWNER, { buffer: Buffer.from('nope'), mimetype: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.importBundle(OWNER, { buffer: zipOf({ format: 'x' }), mimetype: '' }),
      ).rejects.toMatchObject({ response: { code: 'import.invalid_bundle' } });
      const bad = manifest({
        items: [{ kind: 'question', type: 'single_choice', prompt: 'No options' }],
      });
      await expect(
        service.importBundle(OWNER, { buffer: zipOf(bad), mimetype: '' }),
      ).rejects.toMatchObject({
        response: { code: 'import.invalid_item', params: { item: 1, field: 'options' } },
      });
      await expect(service.importBundle(OWNER, undefined)).rejects.toMatchObject({
        response: { message: 'import.file_missing' },
      });
    });
  });

  describe('export', () => {
    it('zips quiz.json with the media it can read, and stamps the slug', async () => {
      prisma.quiz.findFirst.mockResolvedValue({
        id: 'q',
        title: 'Été à Paris !',
        description: null,
        coverMediaId: null,
        language: 'fr',
        feedbackEnabled: true,
        slug: null,
        namespace: null,
        revision: 2,
        domain: 'travel',
        tags: ['paris'],
        license: null,
        updatedAt: new Date('2026-09-01T10:00:00Z'),
        questions: [
          {
            id: 'q1',
            orderIndex: 0,
            type: 'poll',
            prompt: 'Hi',
            visualMediaId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            audioMediaId: null,
            answerExplanation: null,
            backgroundMediaId: null,
            backgroundGradient: null,
            textTone: 'light',
            textOutline: false,
            timeLimitS: 20,
            revealDelayS: null,
            pointsMode: 'none',
            numericValue: null,
            numericTolerance: null,
            options: [
              {
                orderIndex: 0,
                text: 'A',
                mediaId: null,
                color: 'red',
                shape: 'circle',
                isCorrect: false,
                correctOrderIndex: null,
              },
            ],
            acceptedAnswers: [],
          },
        ],
        slides: [],
      });
      media.readAsset.mockResolvedValue({
        buffer: Buffer.from([9]),
        mime: 'image/jpeg',
        asset: { kind: 'image', alt: null, peaks: [] },
      });
      const exportedAt = new Date('2026-09-20T12:00:00Z');
      prisma.quiz.update.mockResolvedValue({
        slug: 'ete-a-paris',
        revision: 3,
        updatedAt: exportedAt,
      });

      const { filename, zip } = await service.exportZip('q', OWNER);
      expect(prisma.quiz.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q', ownerId: OWNER } }),
      );
      // First export: the slug is derived from the title and written back. The
      // revision belongs to sharing (#39) — a backup export must not move it.
      expect(prisma.quiz.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'q' }, data: { slug: 'ete-a-paris' } }),
      );
      expect(filename).toBe('ete-a-paris.quizdock.zip');
      const files = unzipSync(new Uint8Array(zip));
      expect(Object.keys(files).sort()).toEqual([
        'media/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg',
        'quiz.json',
      ]);
      const json = JSON.parse(Buffer.from(files['quiz.json']).toString());
      expect(json.version).toBe(3);
      expect(json.quiz).toMatchObject({
        slug: 'ete-a-paris',
        namespace: null,
        revision: 3,
        updatedAt: exportedAt.toISOString(),
        domain: 'travel',
        tags: ['paris'],
        license: null,
      });
      expect(json.quiz).not.toHaveProperty('id');
      expect(json.items[0].media).toBe('media/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg');
    });

    it('404s on a quiz the caller does not own', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.exportZip('x', OWNER)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('exports any quiz when no owner is given (operator CLI)', async () => {
      prisma.quiz.findFirst.mockResolvedValue(null);
      await expect(service.exportZip('x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.quiz.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'x', ownerId: undefined } }),
      );
    });
  });

  it('slugify folds accents and punctuation', () => {
    expect(slugify('  Ça — c\'est "génial" ! ')).toBe('ca-c-est-genial');
  });
});
