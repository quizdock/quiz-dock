import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MediaAdminService } from './media-admin.service';
import type { MediaJanitor } from './media-janitor.service';
import { MediaLibraryService } from './media-library.service';
import { MEDIA_SLOTS } from './media-usage.sql';
import { mediaUrl } from './media.config';
import { MediaService } from './media.service';
import { PNG_1X1 } from './testing/png';

/** Every place a quiz can use a media, and the one where an archived session shows it. */
const IN_QUIZ = [
  'cover',
  'visual',
  'audio',
  'background',
  'option',
  'slideImage',
  'slideVideo',
  'slideAudio',
  'slideBlock',
  'description',
  'prompt',
  'explanation',
  'optionText',
] as const;
type Place = (typeof IN_QUIZ)[number] | 'archive' | 'unused';

/**
 * "Where is a media used" is asked by the author's library, the credits, the
 * administration, a deletion and the clean-up. On the test database, with a
 * media in each place, they must all give the same answer (audit B2).
 */
describe('Where a media is used (integration)', () => {
  let prisma: PrismaService;
  let media: MediaService;
  let library: MediaLibraryService;
  let admin: MediaAdminService;
  let dir: string;
  let ownerId: string;
  let quizId: string;
  const ids = {} as Record<Place, string>;
  const env = process.env;
  const redis = { scanKeys: jest.fn(async () => [] as string[]) } as unknown as RedisService;
  const janitor = { last: jest.fn(async () => null), run: jest.fn(async () => null) };
  const image = (id: string) => `![](${mediaUrl(id)})`;
  const placeOf = (id: string) => (Object.keys(ids) as Place[]).find((p) => ids[p] === id);

  beforeAll(async () => {
    if (!env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    dir = await mkdtemp(join(tmpdir(), 'media-usage-'));
    process.env = { ...env, MEDIA_DIR: dir };
    prisma = new PrismaService();
    await prisma.$connect();
    media = new MediaService(prisma, redis);
    library = new MediaLibraryService(prisma);
    admin = new MediaAdminService(prisma, media, janitor as unknown as MediaJanitor);
    ownerId = (
      await prisma.user.upsert({
        where: { oidcSubject: 'local:media-usage' },
        create: { oidcSubject: 'local:media-usage', displayName: 'Usage', roles: ['host'] },
        update: {},
      })
    ).id;

    for (const place of [...IN_QUIZ, 'archive', 'unused'] as Place[]) {
      const buffer = Buffer.concat([
        PNG_1X1,
        Buffer.from(`${place}-${Date.now()}-${Math.random()}`),
      ]);
      const { mediaId } = await media.upload(ownerId, {
        buffer,
        mimetype: 'image/png',
        size: buffer.length,
        originalname: `${place}.png`,
      });
      await media.setCredit(ownerId, mediaId, `credit ${place}`);
      ids[place] = mediaId;
    }
    quizId = (
      await prisma.quiz.create({
        data: {
          ownerId,
          title: 'Every place',
          coverMediaId: ids.cover,
          description: image(ids.description),
          questions: {
            create: {
              orderIndex: 0,
              type: 'image_choice',
              prompt: image(ids.prompt),
              answerExplanation: image(ids.explanation),
              visualMediaId: ids.visual,
              audioMediaId: ids.audio,
              backgroundMediaId: ids.background,
              options: {
                create: [
                  { orderIndex: 0, color: 'red', shape: 'triangle', mediaId: ids.option },
                  { orderIndex: 1, color: 'blue', shape: 'circle', text: image(ids.optionText) },
                ],
              },
            },
          },
          slides: {
            create: {
              orderIndex: 0,
              mediaId: ids.slideImage,
              videoMediaId: ids.slideVideo,
              audioMediaId: ids.slideAudio,
              blocks: [{ type: 'image', id: 'b1', mediaId: ids.slideBlock, size: 'medium' }],
            },
          },
        },
      })
    ).id;
    await prisma.gameSessionLog.create({
      data: {
        quizId,
        hostId: ownerId,
        pin: '123456',
        language: 'en',
        startedAt: new Date(),
        endedAt: new Date(),
        retainUntil: new Date(Date.now() + 86_400_000),
        quizSnapshot: { questions: [{ media: { visual: { url: mediaUrl(ids.archive) } } }] },
      },
    });
  });

  afterAll(async () => {
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
    await prisma.user.delete({ where: { id: ownerId } });
    await prisma.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  it('knows every relation through which the schema lets a media be held', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const model = /model MediaAsset \{([^}]*)\}/.exec(schema)![1];
    const lists = [...model.matchAll(/^\s*(\w+)\s+\w+\[\]\s+@relation/gm)].map((m) => m[1]);
    expect([...MEDIA_SLOTS].sort()).toEqual(lists.sort());
  });

  it("the author's library: used by the quiz, kept for past results, or unused", async () => {
    const items = await library.list(ownerId);
    const usage = Object.fromEntries(
      items.map((i) => [placeOf(i.id), { usedIn: i.usedIn, inHistory: i.inHistory }]),
    );
    for (const place of IN_QUIZ)
      expect([place, usage[place]]).toEqual([place, { usedIn: 1, inHistory: false }]);
    expect(usage.archive).toEqual({ usedIn: 0, inHistory: true });
    expect(usage.unused).toEqual({ usedIn: 0, inHistory: false });
  });

  it("the quiz's credits: one per place it uses", async () => {
    expect(await library.creditsOf(quizId)).toEqual(IN_QUIZ.map((p) => `credit ${p}`).sort());
  });

  it("the administration's list of files, and what deleting one breaks", async () => {
    const { items } = await admin.files({ ownerId, limit: 100 });
    const usage = Object.fromEntries(
      items.map((f) => [placeOf(f.id), { quizCount: f.quizCount, inHistory: f.inHistory }]),
    );
    for (const place of IN_QUIZ) {
      expect([place, usage[place]]).toEqual([place, { quizCount: 1, inHistory: false }]);
      expect([place, (await admin.usages(ids[place])).quizzes.map((q) => q.id)]).toEqual([
        place,
        [quizId],
      ]);
    }
    expect(usage.archive).toEqual({ quizCount: 0, inHistory: true });
    expect(usage.unused).toEqual({ quizCount: 0, inHistory: false });
    expect(await admin.usages(ids.archive)).toMatchObject({ quizzes: [], archivedSessions: 1 });
    expect((await admin.overview([ownerId])).cleanup.orphans.count).toBe(1);
  });

  it('a deletion refuses a used media, and a release lets only the unused one go', async () => {
    for (const place of [...IN_QUIZ, 'archive'] as const) {
      await expect(media.remove(ownerId, ids[place])).rejects.toThrow(ConflictException);
    }
    await media.releaseUnused(Object.values(ids));
    const left = await prisma.mediaAsset.findMany({ where: { ownerId }, select: { id: true } });
    expect(left.map((m) => placeOf(m.id)).sort()).toEqual([...IN_QUIZ, 'archive'].sort());
  });
});
