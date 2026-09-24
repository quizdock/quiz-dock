import { createHash } from 'node:crypto';
import { link, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MediaService } from './media.service';

// Real files; `link` can be made to fail like on a volume without hard links.
jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, link: jest.fn(actual.link) };
});

/** Shared files on the test database and a scratch media directory: the SQL is the point here. */
describe('MediaService — shared files (integration)', () => {
  let prisma: PrismaService;
  let service: MediaService;
  let dir: string;
  let ownerId: string;
  const env = process.env;
  const redis = { keys: jest.fn(async () => [] as string[]) } as unknown as RedisService;

  /** A PNG signature and a tag: enough for the content check, different bytes per tag. */
  const png = (tag: string) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(tag),
    ]);
  const upload = (buffer: Buffer) =>
    service.upload(ownerId, { buffer, mimetype: 'image/png', size: buffer.length });
  const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const release = (id: string) => service.releaseUnused([id]);

  beforeAll(async () => {
    if (!env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    const owner = await prisma.user.upsert({
      where: { oidcSubject: 'local:media-blobs' },
      create: { oidcSubject: 'local:media-blobs', displayName: 'Media blobs', roles: ['host'] },
      update: {},
    });
    ownerId = owner.id;
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-blobs-'));
    process.env = { ...env, MEDIA_DIR: dir };
    service = new MediaService(prisma, redis);
  });

  afterEach(async () => {
    process.env = env;
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
    await prisma.user.delete({ where: { oidcSubject: 'local:media-blobs' } });
    await prisma.$disconnect();
  });

  it('stores the same bytes once, and keeps them until the last media lets go', async () => {
    const bytes = png(`same-${Date.now()}`);
    const a = await upload(bytes);
    const b = await upload(bytes);
    expect(a.mediaId).not.toBe(b.mediaId);
    expect(await readdir(dir)).toEqual([sha(bytes)]);
    expect(await prisma.mediaBlob.count({ where: { sha256: sha(bytes) } })).toBe(1);

    await release(a.mediaId);
    expect(await readdir(dir)).toEqual([sha(bytes)]);
    expect((await service.readAsset(b.mediaId))?.buffer.equals(bytes)).toBe(true);

    await release(b.mediaId);
    expect(await readdir(dir)).toEqual([]);
    expect(await prisma.mediaBlob.count({ where: { sha256: sha(bytes) } })).toBe(0);
  });

  it('moves an older file under its blob name, merging identical ones', async () => {
    const bytes = png(`legacy-${Date.now()}`);
    const legacy = await Promise.all(
      [0, 1].map(() =>
        prisma.mediaAsset.create({
          data: {
            ownerId,
            url: '',
            mime: 'image/png',
            sizeBytes: BigInt(bytes.length),
            kind: 'image',
          },
        }),
      ),
    );
    for (const { id } of legacy) await writeFile(join(dir, id), bytes);
    const lost = await prisma.mediaAsset.create({
      data: { ownerId, url: '', mime: 'image/png', sizeBytes: 1n, kind: 'image' },
    });

    await expect(service.adoptLegacyFiles()).resolves.toEqual({ adopted: 2, failed: 0 });
    expect(await readdir(dir)).toEqual([sha(bytes)]);
    const rows = await prisma.mediaAsset.findMany({
      where: { id: { in: [...legacy.map((l) => l.id), lost.id] } },
      select: { id: true, blobSha256: true },
    });
    expect(rows.find((r) => r.id === lost.id)?.blobSha256).toBeNull();
    expect(rows.filter((r) => r.blobSha256 === sha(bytes))).toHaveLength(2);
    expect((await service.readAsset(legacy[0].id))?.buffer.equals(bytes)).toBe(true);
    await expect(service.adoptLegacyFiles()).resolves.toEqual({ adopted: 0, failed: 0 });
  });

  it('copies an older file where the volume has no hard links', async () => {
    const bytes = png(`copy-${Date.now()}`);
    const legacy = await prisma.mediaAsset.create({
      data: { ownerId, url: '', mime: 'image/png', sizeBytes: BigInt(bytes.length), kind: 'image' },
    });
    await writeFile(join(dir, legacy.id), bytes);
    jest.mocked(link).mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    await expect(service.adoptLegacyFiles()).resolves.toEqual({ adopted: 1, failed: 0 });
    expect(await readdir(dir)).toEqual([sha(bytes)]);
  });

  it('keeps the stored files when the database is older than the volume', async () => {
    // Restored from before the upgrade: its media point at id-named files that were renamed since.
    const bytes = png(`restored-${Date.now()}`);
    await prisma.mediaAsset.create({
      data: { ownerId, url: '', mime: 'image/png', sizeBytes: BigInt(bytes.length), kind: 'image' },
    });
    await writeFile(join(dir, sha(bytes)), bytes);
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(join(dir, sha(bytes)), old, old);
    await expect(service.purgeStrayFiles()).resolves.toBe(0);
    expect(await readdir(dir)).toEqual([sha(bytes)]);
  });

  it('deletes a blob no media holds once its grace period is over', async () => {
    const bytes = png(`blob-${Date.now()}`);
    const { mediaId } = await upload(bytes);
    await prisma.mediaAsset.delete({ where: { id: mediaId } });
    await expect(service.sweepUnusedBlobs()).resolves.toBe(0);
    await expect(service.sweepUnusedBlobs(-1000)).resolves.toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});
