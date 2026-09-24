import { ConflictException } from '@nestjs/common';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MediaAdminService } from './media-admin.service';
import type { MediaJanitor } from './media-janitor.service';
import { MediaService } from './media.service';

/**
 * The instance's media administration on the test database. Other suites add
 * media at the same time: totals and lists are narrowed to this suite's authors.
 */
describe('MediaAdminService (integration)', () => {
  let prisma: PrismaService;
  let media: MediaService;
  let admin: MediaAdminService;
  let dir: string;
  let alice: string;
  let bob: string;
  const env = process.env;
  const redis = { keys: jest.fn(async () => [] as string[]) } as unknown as RedisService;
  const janitor = { last: jest.fn(async () => null), run: jest.fn(async () => null) };

  const png = (tag: string) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`${tag}-${Date.now()}-${Math.random()}`),
    ]);
  const upload = (ownerId: string, name: string, buffer = png(name)) =>
    media.upload(ownerId, {
      buffer,
      mimetype: 'image/png',
      size: buffer.length,
      originalname: name,
    });
  const quizUsing = (ownerId: string, mediaId: string) =>
    prisma.quiz.create({
      data: {
        ownerId,
        title: `Quiz of ${ownerId.slice(-4)}`,
        questions: {
          create: { orderIndex: 0, type: 'single_choice', prompt: 'Q', visualMediaId: mediaId },
        },
      },
      include: { questions: true },
    });

  beforeAll(async () => {
    if (!env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    const make = (slug: string) =>
      prisma.user.upsert({
        where: { oidcSubject: `local:${slug}` },
        create: { oidcSubject: `local:${slug}`, displayName: slug, roles: ['host'] },
        update: {},
      });
    alice = (await make('media-admin-alice')).id;
    bob = (await make('media-admin-bob')).id;
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-admin-'));
    process.env = { ...env, MEDIA_DIR: dir };
    media = new MediaService(prisma, redis);
    admin = new MediaAdminService(prisma, media, janitor as unknown as MediaJanitor);
  });

  afterEach(async () => {
    process.env = env;
    const owners = { ownerId: { in: [alice, bob] } };
    await prisma.quiz.deleteMany({ where: owners });
    const assets = await prisma.mediaAsset.findMany({
      where: owners,
      select: { blobSha256: true },
    });
    await prisma.mediaAsset.deleteMany({ where: owners });
    const shas = assets.map((a) => a.blobSha256).filter((s): s is string => !!s);
    await prisma.mediaBlob.deleteMany({ where: { sha256: { in: shas } } });
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    await prisma.$disconnect();
  });

  it('counts files once, however many media share them, by kind and by owner', async () => {
    const before = await admin.overview([alice, bob]);
    const bytes = png('shared');
    const own = png('own');
    await upload(alice, 'shared.webp', bytes);
    await upload(bob, 'shared.webp', bytes); // the same file, another author
    await upload(alice, 'own.webp', own);
    const after = await admin.overview([alice, bob]);
    expect(after.files - before.files).toBe(2);
    const images = (o: typeof after) => o.byKind.find((k) => k.kind === 'image')?.files ?? 0;
    expect(images(after) - images(before)).toBe(2);
    // A shared file counts for each of its owners.
    const owner = (id: string) => after.byOwner.find((o) => o.ownerId === id);
    expect(owner(alice)).toMatchObject({ files: 2 });
    expect(owner(bob)).toMatchObject({ files: 1 });
    // Freshly uploaded and used by nothing: orphans, still in their grace period.
    expect(after.cleanup.orphans.count - before.cleanup.orphans.count).toBe(3);
    expect(after.cleanup.orphans.waiting - before.cleanup.orphans.waiting).toBe(3);
    // What the sweep will free: the shared file once.
    expect(after.cleanup.orphans.bytes - before.cleanup.orphans.bytes).toBe(
      bytes.length + own.length,
    );
  });

  it('lists files with their owners and usages, sorted and filtered', async () => {
    const bytes = png('popular');
    const a = await upload(alice, 'popular.webp', bytes);
    const b = await upload(bob, 'popular.webp', bytes);
    await upload(alice, 'big.webp', Buffer.concat([png('big'), Buffer.alloc(5000)]));
    await quizUsing(alice, a.mediaId);
    await quizUsing(bob, b.mediaId);

    const bySize = await admin.files({ ownerId: alice, sort: 'size' });
    expect(bySize.total).toBe(2);
    expect(bySize.items.map((f) => f.name)).toEqual(['big.webp', 'popular.webp']);
    const byUsage = await admin.files({ ownerId: alice, sort: 'usage' });
    expect(byUsage.items[0]).toMatchObject({
      name: 'popular.webp',
      quizCount: 2,
      mediaCount: 2,
      owners: expect.arrayContaining(['media-admin-alice', 'media-admin-bob']),
      legacy: true, // a PNG: stored before the converter would have made it WebP
    });
    expect((await admin.files({ ownerId: bob, q: 'big' })).total).toBe(0);
  });

  it('lists what deleting a file breaks, then deletes it for every owner', async () => {
    const bytes = png('moderated');
    const a = await upload(alice, 'moderated.webp', bytes);
    const b = await upload(bob, 'moderated.webp', bytes);
    const quiz = await quizUsing(bob, b.mediaId);

    const usages = await admin.usages(a.mediaId);
    expect(usages).toMatchObject({ archivedSessions: 0, playing: false });
    expect(usages.quizzes).toEqual([{ id: quiz.id, title: quiz.title, owner: 'media-admin-bob' }]);

    await admin.deleteFile(a.mediaId);
    expect(await prisma.mediaAsset.count({ where: { id: { in: [a.mediaId, b.mediaId] } } })).toBe(
      0,
    );
    // The quiz's slot is emptied, not the quiz.
    const question = await prisma.question.findUniqueOrThrow({
      where: { id: quiz.questions[0].id },
    });
    expect(question.visualMediaId).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses to delete a file while a session plays it', async () => {
    const a = await upload(alice, 'playing.webp');
    const playing = {
      keys: jest.fn(async () => ['game:123456:snapshot']),
      hget: jest.fn(async () => 'ANSWERING'),
      mget: jest.fn(async () => [`{"media":{"url":"/api/v1/media/${a.mediaId}"}}`]),
    } as unknown as RedisService;
    const live = new MediaAdminService(
      prisma,
      new MediaService(prisma, playing),
      janitor as unknown as MediaJanitor,
    );
    expect(await live.usages(a.mediaId)).toMatchObject({ playing: true });
    await expect(live.deleteFile(a.mediaId)).rejects.toThrow(ConflictException);
    expect(await prisma.mediaAsset.count({ where: { id: a.mediaId } })).toBe(1);
  });

  it('counts the stray files on the volume without deleting them', async () => {
    await upload(alice, 'kept.webp');
    // Named like a media id no row has (a SHA-named one would depend on the shared test
    // database: media other suites leave without a file here hold those back).
    await writeFile(join(dir, '01ZZZZZZZZZZZZZZZZZZZZZZZZ'), 'left behind');
    const { cleanup } = await admin.overview();
    expect(cleanup.strayFiles).toEqual({ count: 1, bytes: 11 });
    expect(await readdir(dir)).toHaveLength(2);
  });
});
