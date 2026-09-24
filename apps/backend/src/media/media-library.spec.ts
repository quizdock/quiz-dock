import { ConflictException } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MediaLibraryService } from './media-library.service';
import { MediaService } from './media.service';

/** The author's library on the test database: grouping, usages, credits, guarded delete. */
describe('MediaLibraryService (integration)', () => {
  let prisma: PrismaService;
  let media: MediaService;
  let library: MediaLibraryService;
  let dir: string;
  let ownerId: string;
  const env = process.env;
  const redis = { keys: jest.fn(async () => [] as string[]) } as unknown as RedisService;

  const png = (tag: string) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`${tag}-${Date.now()}-${Math.random()}`),
    ]);
  const upload = (name: string, buffer = png(name)) =>
    media.upload(ownerId, {
      buffer,
      mimetype: 'image/png',
      size: buffer.length,
      originalname: name,
    });
  const quizUsing = (mediaId: string) =>
    prisma.quiz.create({
      data: {
        ownerId,
        title: 'Library',
        questions: {
          create: { orderIndex: 0, type: 'single_choice', prompt: 'Q', visualMediaId: mediaId },
        },
      },
    });

  beforeAll(async () => {
    if (!env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    const owner = await prisma.user.upsert({
      where: { oidcSubject: 'local:media-library' },
      create: { oidcSubject: 'local:media-library', displayName: 'Library', roles: ['host'] },
      update: {},
    });
    ownerId = owner.id;
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-library-'));
    process.env = { ...env, MEDIA_DIR: dir };
    media = new MediaService(prisma, redis);
    library = new MediaLibraryService(prisma);
  });

  afterEach(async () => {
    process.env = env;
    await prisma.gameSessionLog.deleteMany({ where: { hostId: ownerId } });
    await prisma.quiz.deleteMany({ where: { ownerId } });
    const assets = await prisma.mediaAsset.findMany({
      where: { ownerId },
      select: { blobSha256: true },
    });
    await prisma.mediaAsset.deleteMany({ where: { ownerId } });
    const shas = assets.map((a) => a.blobSha256).filter((s): s is string => !!s);
    await prisma.mediaBlob.deleteMany({ where: { sha256: { in: shas } } });
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { oidcSubject: 'local:media-library' } });
    await prisma.$disconnect();
  });

  it('lists one entry per file, newest first, with how many quizzes use it', async () => {
    const lake = await upload('sun-moon-lake.webp');
    const reused = await media.reuse(ownerId, lake.mediaId);
    await upload('taipei-101.webp');
    await quizUsing(lake.mediaId);
    await quizUsing(reused.mediaId);

    const items = await library.list(ownerId, { kind: 'image' });
    expect(items.map((i) => i.name)).toEqual(['taipei-101.webp', 'sun-moon-lake.webp']);
    // The reused media is the same file: one entry, used by both quizzes.
    expect(items[1]).toMatchObject({ id: reused.mediaId, usedIn: 2 });
    expect(items[0]).toMatchObject({ usedIn: 0, inHistory: false });
    expect(await library.list(ownerId, { kind: 'audio' })).toEqual([]);
  });

  it('tells a media kept for past results from an unused one', async () => {
    const a = await upload('archived.webp');
    const quiz = await quizUsing(a.mediaId);
    await prisma.gameSessionLog.create({
      data: {
        quizId: quiz.id,
        hostId: ownerId,
        pin: '123456',
        language: 'en',
        startedAt: new Date(),
        endedAt: new Date(),
        retainUntil: new Date(Date.now() + 86_400_000),
        quizSnapshot: { questions: [{ media: { visual: { url: `/api/v1/media/${a.mediaId}` } } }] },
      },
    });
    await prisma.question.updateMany({ where: { quizId: quiz.id }, data: { visualMediaId: null } });
    const [item] = await library.list(ownerId);
    expect(item).toMatchObject({ usedIn: 0, inHistory: true });
    await expect(media.remove(ownerId, a.mediaId)).rejects.toThrow(ConflictException);
  });

  it('searches the name, the alt text and the credit', async () => {
    const a = await upload('temple.webp');
    await upload('night-market.webp');
    await media.setCredit(ownerId, a.mediaId, 'Photo: Lin, CC BY 4.0');
    expect((await library.list(ownerId, { q: 'market' })).map((i) => i.name)).toEqual([
      'night-market.webp',
    ]);
    expect((await library.list(ownerId, { q: 'lin, cc' })).map((i) => i.name)).toEqual([
      'temple.webp',
    ]);
    // Wildcards typed by the author are taken literally.
    expect(await library.list(ownerId, { q: '%' })).toEqual([]);
  });

  it('reuses a media as a new one on the same file, alt text and credit to start from', async () => {
    const a = await upload('lantern.webp');
    await media.setAlt(ownerId, a.mediaId, 'Sky lanterns over Pingxi');
    await media.setCredit(ownerId, a.mediaId, 'CC0');
    const b = await media.reuse(ownerId, a.mediaId);
    expect(b.mediaId).not.toBe(a.mediaId);
    const [ra, rb] = await Promise.all(
      [a.mediaId, b.mediaId].map((id) => prisma.mediaAsset.findUniqueOrThrow({ where: { id } })),
    );
    expect(rb).toMatchObject({
      blobSha256: ra.blobSha256,
      alt: 'Sky lanterns over Pingxi',
      credit: 'CC0',
      url: `/api/v1/media/${b.mediaId}`,
    });
    // Changing one use's alt text leaves the other alone.
    await media.setAlt(ownerId, b.mediaId, 'Lanterns');
    expect((await media.describe(ownerId, a.mediaId)).alt).toBe('Sky lanterns over Pingxi');
  });

  it('refuses to delete a file a quiz uses, and deletes every unused media on it', async () => {
    const a = await upload('used.webp');
    await quizUsing(a.mediaId);
    await expect(media.remove(ownerId, a.mediaId)).rejects.toThrow(ConflictException);

    const b = await upload('unused.webp');
    const c = await media.reuse(ownerId, b.mediaId);
    await media.remove(ownerId, b.mediaId);
    expect(await prisma.mediaAsset.count({ where: { id: { in: [b.mediaId, c.mediaId] } } })).toBe(
      0,
    );
  });

  it("collects a quiz's credits, from its slots and from a slide's image block", async () => {
    const a = await upload('a.webp');
    const b = await upload('b.webp');
    const c = await upload('c.webp');
    await media.setCredit(ownerId, a.mediaId, 'Sound: Wang, CC BY');
    await media.setCredit(ownerId, b.mediaId, 'Photo: Chen, CC BY-SA');
    await media.setCredit(ownerId, c.mediaId, 'Not in this quiz');
    const quiz = await quizUsing(a.mediaId);
    await prisma.slide.create({
      data: {
        quizId: quiz.id,
        orderIndex: 0,
        blocks: [{ type: 'image', mediaId: b.mediaId, size: 'medium' }],
      },
    });
    expect(await library.creditsOf(quiz.id)).toEqual([
      'Photo: Chen, CC BY-SA',
      'Sound: Wang, CC BY',
    ]);
  });

  it('reads the libraries to link to from the environment', () => {
    process.env = { ...env, MEDIA_LIBRARY_LINKS: 'none' };
    expect(library.links()).toEqual([]);
    process.env = {
      ...env,
      MEDIA_LIBRARY_LINKS: JSON.stringify([
        { name: 'Ours', url: 'https://media.example.org', kinds: ['image', 'bogus'] },
        { name: 'Bad', url: 'javascript:alert(1)' },
      ]),
    };
    expect(library.links()).toEqual([
      { name: 'Ours', url: 'https://media.example.org', kinds: ['image'] },
    ]);
    process.env = { ...env, MEDIA_LIBRARY_LINKS: '{not json' };
    expect(library.links().map((l) => l.name)).toContain('OpenSoundLibrary');
  });
});
