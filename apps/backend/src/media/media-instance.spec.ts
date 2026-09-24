import { NotFoundException } from '@nestjs/common';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MediaAdminService } from './media-admin.service';
import type { MediaJanitor } from './media-janitor.service';
import { MediaLibraryService } from './media-library.service';
import { MediaService } from './media.service';

/** The instance's media (#62) and the sizes read from files, on the test database. */
describe('Instance media and dimensions (integration)', () => {
  let prisma: PrismaService;
  let media: MediaService;
  let library: MediaLibraryService;
  let admin: MediaAdminService;
  let dir: string;
  let adminId: string;
  let hostId: string;
  const env = process.env;
  const redis = { keys: jest.fn(async () => [] as string[]) } as unknown as RedisService;
  const janitor = { last: jest.fn(async () => null) } as unknown as MediaJanitor;

  /** A real PNG header (IHDR), then a tag so every file differs. */
  const png = (width: number, height: number, tag: string) => {
    const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13)]),
      Buffer.from('IHDR'),
      Buffer.from([...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
      Buffer.from(`${tag}-${Date.now()}-${Math.random()}`),
    ]);
  };
  const upload = (ownerId: string, name: string, buffer: Buffer, instance = false) =>
    media.upload(
      ownerId,
      { buffer, mimetype: 'image/png', size: buffer.length, originalname: name },
      {},
      { instance },
    );

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
    adminId = (await make('media-instance-admin')).id;
    hostId = (await make('media-instance-host')).id;
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-instance-'));
    process.env = { ...env, MEDIA_DIR: dir };
    media = new MediaService(prisma, redis);
    library = new MediaLibraryService(prisma);
    admin = new MediaAdminService(prisma, media, janitor);
  });

  afterEach(async () => {
    process.env = env;
    const owners = { ownerId: { in: [adminId, hostId] } };
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
    await prisma.user.deleteMany({ where: { id: { in: [adminId, hostId] } } });
    await prisma.$disconnect();
  });

  it('keeps the size read from the bytes, and carries it on reuse', async () => {
    const a = await upload(hostId, 'wide.png', png(1920, 1080, 'wide'));
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: a.mediaId } });
    expect({ width: row.width, height: row.height }).toEqual({ width: 1920, height: 1080 });
    const b = await media.reuse(hostId, a.mediaId);
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: b.mediaId } })).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });

  it('fills in the size of older media from their files, and marks an unreadable one', async () => {
    const readable = await prisma.mediaAsset.create({
      data: { ownerId: hostId, url: '', mime: 'image/png', sizeBytes: 1n, kind: 'image' },
    });
    await writeFile(join(dir, readable.id), png(800, 600, 'older'));
    const lost = await prisma.mediaAsset.create({
      data: { ownerId: hostId, url: '', mime: 'image/png', sizeBytes: 1n, kind: 'image' },
    });
    await media.fillDimensions(10_000, [hostId]);
    const [r, l] = await Promise.all(
      [readable.id, lost.id].map((id) => prisma.mediaAsset.findUniqueOrThrow({ where: { id } })),
    );
    expect([r.width, r.height]).toEqual([800, 600]);
    expect([l.width, l.height]).toEqual([0, 0]); // unknown: the next pass moves on
  });

  it('offers the instance media to every host, as a media of their own on the same file', async () => {
    const own = await upload(adminId, 'logo.png', png(512, 512, 'logo'));
    await media.setAlt(adminId, own.mediaId, 'Le logo de la société');
    const entry = await media.addToInstance(adminId, own.mediaId);
    // Added twice, listed once.
    expect((await media.addToInstance(adminId, own.mediaId)).mediaId).toBe(entry.mediaId);
    await media.setInstanceCredit(entry.mediaId, 'In-house');

    const catalogue = await library.instanceMedia({ kind: 'image', q: 'logo' });
    expect(catalogue.map((m) => m.id)).toContain(entry.mediaId);
    // The administrator's own library does not list the catalogue's copy.
    expect((await library.list(adminId)).map((m) => m.id)).not.toContain(entry.mediaId);

    const copy = await media.reuse(hostId, entry.mediaId);
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: copy.mediaId } });
    // The credit carries over; the alt text does not — it depends on the use and on the
    // quiz's language, the host writes it on their copy.
    expect(row).toMatchObject({
      ownerId: hostId,
      instance: false,
      alt: null,
      credit: 'In-house',
      width: 512,
    });
    const global = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: entry.mediaId } });
    expect(global.alt).toBeNull();
    // A host cannot change or delete the instance's copy through their own routes.
    await expect(media.remove(hostId, entry.mediaId)).rejects.toThrow(NotFoundException);
    await expect(media.setAlt(adminId, entry.mediaId, 'x')).rejects.toThrow(NotFoundException);

    // On the administration page the global media counts for "global", not for its administrator.
    const globalFiles = await admin.files({ ownerId: 'global', q: 'logo' });
    expect(globalFiles.items).toEqual([
      expect.objectContaining({
        inCatalog: true,
        instanceId: entry.mediaId,
        instanceCredit: 'In-house',
      }),
    ]);
    const overview = await admin.overview([adminId, hostId]);
    expect(overview.byOwner.map((o) => o.ownerId)).toContain('global');
  });

  it('never sweeps the instance media, and withdrawing one leaves the hosts their copies', async () => {
    const a = await upload(adminId, 'jingle.png', png(10, 10, 'jingle'), true);
    await prisma.mediaAsset.update({
      where: { id: a.mediaId },
      data: { createdAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    // The usual grace period: other suites' fresh media, on the same database, are left alone.
    await media.sweepOrphans();
    expect(await prisma.mediaAsset.count({ where: { id: a.mediaId } })).toBe(1);
    const copy = await media.reuse(hostId, a.mediaId);
    const before = await admin.overview([adminId]);
    expect(before.cleanup.orphans.count).toBe(0);

    await media.removeFromInstance(a.mediaId);
    expect(await prisma.mediaAsset.count({ where: { id: a.mediaId } })).toBe(0);
    expect(await prisma.mediaAsset.count({ where: { id: copy.mediaId } })).toBe(1);
    expect(await readdir(dir)).toHaveLength(1); // the file stays for the host's copy
  });
});
