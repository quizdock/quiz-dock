import { NotFoundException } from '@nestjs/common';
import { QuizStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { QuizPortableService } from './quiz-portable.service';
import { QuizPublicationService } from './quiz-publication.service';

const OWNER = 'owner-1';
const MB = 1024 * 1024;

/** A quiz as `EXPORT_INCLUDE` loads it, with one question showing `mediaId`. */
const quiz = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  title: 'World Capitals',
  slug: null,
  status: QuizStatus.ready,
  language: 'en',
  license: 'CC-BY-4.0',
  tags: ['geography'],
  coverMediaId: null,
  description: null,
  questions: [
    {
      prompt: 'Where?',
      answerExplanation: null,
      visualMediaId: 'm-photo',
      audioMediaId: 'm-sound',
      backgroundMediaId: null,
      options: [],
    },
  ],
  slides: [],
  ...over,
});

const assets = [
  {
    id: 'm-photo',
    kind: 'image',
    name: 'paris.webp',
    credit: 'Own work',
    sizeBytes: BigInt(2 * MB),
  },
  { id: 'm-sound', kind: 'audio', name: 'bell.m4a', credit: null, sizeBytes: BigInt(1 * MB) },
];

function setup(found: unknown = quiz(), rows = assets) {
  const prisma = {
    quiz: { findFirst: jest.fn(async () => found), update: jest.fn(async () => ({})) },
    mediaAsset: { findMany: jest.fn(async () => rows) },
  };
  const portable = {
    exportZip: jest.fn(async () => ({ filename: 'x.quizdock.zip', zip: Buffer.alloc(10) })),
  };
  const service = new QuizPublicationService(
    prisma as unknown as PrismaService,
    portable as unknown as QuizPortableService,
  );
  return { prisma, portable, service };
}

describe('QuizPublicationService', () => {
  const saved = process.env.PUBLICATION_MAX_MB;
  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLICATION_MAX_MB;
    else process.env.PUBLICATION_MAX_MB = saved;
  });

  it('reports a ready quiz: slug from the title, size, heaviest media, uncredited ones', async () => {
    const { service } = setup();
    const report = await service.report('q1', OWNER);
    expect(report).toMatchObject({
      slug: 'world-capitals',
      slugSet: false,
      maxBytes: 20 * MB,
      heaviest: [
        { id: 'm-photo', sizeBytes: 2 * MB },
        { id: 'm-sound', sizeBytes: 1 * MB },
      ],
      uncredited: [{ id: 'm-sound', name: 'bell.m4a' }],
    });
    expect(report.estimatedBytes).toBeGreaterThan(3 * MB);
    // A missing credit is the contributor's responsibility: a reminder, never a block.
    expect(report.issues).toEqual([{ code: 'credit_missing', level: 'warn', count: 1 }]);
  });

  it('keeps the slug the quiz already has', async () => {
    const { service } = setup(quiz({ slug: 'capitals' }));
    expect(await service.report('q1', OWNER)).toMatchObject({ slug: 'capitals', slugSet: true });
  });

  it('blocks a draft, a licence outside the list, no tags, and a bundle over the limit', async () => {
    process.env.PUBLICATION_MAX_MB = '2';
    const { service } = setup(quiz({ status: QuizStatus.draft, license: 'MIT', tags: [] }));
    const codes = (await service.report('q1', OWNER)).issues.map((i) => `${i.level}:${i.code}`);
    expect(codes).toEqual([
      'block:not_ready',
      'block:license',
      'block:tags',
      'block:too_large',
      'warn:credit_missing',
    ]);
  });

  it('404s on a quiz the caller does not own', async () => {
    const { service } = setup(null);
    await expect(service.report('q1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exports under the confirmed slug, which becomes the quiz slug', async () => {
    const { service, prisma, portable } = setup();
    await service.export('q1', OWNER, 'capitals-of-the-world');
    expect(prisma.quiz.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { slug: 'capitals-of-the-world' },
    });
    expect(portable.exportZip).toHaveBeenCalledWith('q1', OWNER);
  });

  it('refuses an invalid slug, and anything that blocks, before touching the quiz', async () => {
    const bad = setup();
    await expect(bad.service.export('q1', OWNER, 'Not A Slug')).rejects.toThrow(
      'publication.slug_invalid',
    );
    const draft = setup(quiz({ status: QuizStatus.draft }));
    await expect(draft.service.export('q1', OWNER, 'capitals')).rejects.toThrow(
      'publication.not_ready',
    );
    expect(bad.prisma.quiz.update).not.toHaveBeenCalled();
    expect(draft.prisma.quiz.update).not.toHaveBeenCalled();
  });

  it('refuses a zip over the limit even when the estimate passed', async () => {
    process.env.PUBLICATION_MAX_MB = '4';
    const { service, portable } = setup();
    portable.exportZip.mockResolvedValue({ filename: 'x', zip: Buffer.alloc(4 * MB + 1) });
    await expect(service.export('q1', OWNER, 'capitals')).rejects.toThrow('publication.too_large');
  });
});
