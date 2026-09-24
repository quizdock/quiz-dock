import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { MediaService, uploadName } from './media.service';

// Accepted files would land on the volume: the write is not what these tests are about.
jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  writeFile: jest.fn(async () => undefined),
  rename: jest.fn(async () => undefined),
}));

/** Real files (ffmpeg, 0.5 s) — the content check must hold on what encoders produce. */
const fixture = (name: string) => {
  const buffer = readFileSync(join(__dirname, '../../test/fixtures/media', name));
  return { buffer, mimetype: 'application/octet-stream', size: buffer.length };
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const peaks = JSON.stringify(new Array(200).fill(0.5));

function makePrisma() {
  const prisma = {
    mediaAsset: {
      create: jest.fn(async () => ({ id: 'm1' })),
      update: jest.fn(async () => ({ id: 'm1', url: '/api/v1/media/m1' })),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        blobSha256: null as string | null,
      })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => [] as { id: string }[]),
      count: jest.fn(async () => 1),
    },
    mediaBlob: {
      upsert: jest.fn(async () => ({})),
      findMany: jest.fn(async () => [] as { sha256: string }[]),
      findUnique: jest.fn(async () => null as { sha256: string } | null),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    $queryRaw: jest.fn(async () => [{ used: false }]),
    $transaction: jest.fn(
      async (arg: unknown): Promise<unknown> =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : Promise.all(arg as unknown[]),
    ),
  };
  return prisma;
}

const file = (over: Partial<{ buffer: Buffer; mimetype: string; size: number }> = {}) => ({
  buffer: PNG,
  mimetype: 'image/png',
  size: PNG.length,
  ...over,
});

describe('uploadName', () => {
  it('reads again as UTF-8 a name multer decoded as latin1, and leaves a right one alone', () => {
    const mangled = Buffer.from('église-台北.png', 'utf8').toString('latin1');
    expect(uploadName(mangled)).toBe('église-台北.png');
    expect(uploadName('photo.png')).toBe('photo.png');
    expect(uploadName('café.png')).toBe('café.png');
    expect(uploadName('台北.png')).toBe('台北.png');
    expect(uploadName('  ')).toBeNull();
    expect(uploadName(undefined)).toBeNull();
  });
});

describe('MediaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: MediaService;
  const redis = {
    keys: jest.fn(async () => [] as string[]),
    mget: jest.fn(async () => []),
    hget: jest.fn(async () => 'ANSWERING' as string | null),
  };

  beforeEach(() => {
    prisma = makePrisma();
    redis.keys.mockResolvedValue([]);
    service = new MediaService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  it('refuse un upload sans fichier', async () => {
    await expect(service.upload('o1', undefined)).rejects.toThrow(BadRequestException);
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('refuse tout upload en mode démo (avant tout écrit)', async () => {
    const env = process.env;
    process.env = { ...env, DEMO_MODE: 'true' };
    try {
      await expect(service.upload('o1', file())).rejects.toThrow(ForbiddenException);
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
    } finally {
      process.env = env;
    }
  });

  it('refuses what the bytes do not show to be a supported media, whatever it claims', async () => {
    const text = file({ buffer: Buffer.from('hello'), mimetype: 'image/png', size: 5 });
    await expect(service.upload('o1', text)).rejects.toThrow('media.unsupported_type');
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  describe('content check on real files', () => {
    const rejection = async (name: string) => {
      const err = await service.upload('o1', fixture(name)).catch((e: BadRequestException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
      return (err as BadRequestException).getResponse();
    };

    it('refuses an iPhone-style HEVC film, naming the codec', async () => {
      expect(await rejection('hevc.mp4')).toEqual({
        code: 'media.unsupported_video_codec',
        params: { codec: 'hvc1' },
      });
    });

    it('refuses a QuickTime movie, a WebM named .mp4 and a FLAC named .mp3', async () => {
      expect(await rejection('h264.mov')).toMatchObject({ message: 'media.quicktime' });
      expect(await rejection('webm-named.mp4')).toMatchObject({
        message: 'media.unsupported_type',
      });
      expect(await rejection('flac-named.mp3')).toMatchObject({
        message: 'media.unsupported_type',
      });
    });

    it('takes an H.264 video and stores the type found, not the one declared', async () => {
      await service.upload('o1', fixture('h264-aac.mp4'), { durationMs: '500' });
      expect(prisma.mediaAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'video', mime: 'video/mp4', durationMs: 500 }),
      });
    });

    it('takes an MP3 with its waveform and loudness', async () => {
      await service.upload('o1', fixture('tone.mp3'), {
        durationMs: '500',
        peaks,
        loudnessLufs: '-18.5',
        peakDbfs: '-3',
      });
      expect(prisma.mediaAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'audio',
          mime: 'audio/mpeg',
          durationMs: 500,
          peaks: new Array(200).fill(0.5),
          audioOrigin: 'upload',
          loudnessLufs: -18.5,
          peakDbfs: -3,
        }),
      });
    });

    it('refuses an MP3 without its waveform, or with one out of bounds', async () => {
      await expect(
        service.upload('o1', fixture('tone.mp3'), { durationMs: '500' }),
      ).rejects.toThrow(BadRequestException);
      const loud = JSON.stringify(new Array(200).fill(2));
      await expect(
        service.upload('o1', fixture('tone.mp3'), { durationMs: '500', peaks: loud }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
    });
  });

  it('applies the limit of the kind found: a sound is held to the audio limit', async () => {
    const env = process.env;
    process.env = { ...env, MEDIA_MAX_AUDIO_MB: '0.001' };
    try {
      const err = await service
        .upload('o1', fixture('tone.mp3'), { durationMs: '500', peaks })
        .catch((e: PayloadTooLargeException) => e);
      expect(err).toBeInstanceOf(PayloadTooLargeException);
      expect((err as PayloadTooLargeException).getResponse()).toMatchObject({
        code: 'media.file_too_large',
      });
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
    } finally {
      process.env = env;
    }
  });

  it('openStream : 404 si média inconnu', async () => {
    prisma.mediaAsset.findUnique.mockResolvedValue(null);
    await expect(service.openStream('x')).rejects.toThrow(NotFoundException);
  });

  it("remove : 404 si non possédé (isolation), ni pour un média de l'instance, pas de delete", async () => {
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(service.remove('o1', 'm1')).rejects.toThrow(NotFoundException);
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'm1', ownerId: 'o1', instance: false },
    });
    expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
  });

  describe('releaseUnused', () => {
    const unused = {
      _count: {
        coverForQuizzes: 0,
        questionVisuals: 0,
        questionAudios: 0,
        questionBackgrounds: 0,
        slides: 0,
        options: 0,
      },
    };

    it('deletes a media nothing uses any more, row and file', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      await service.releaseUnused(['m1', null, 'm1']);
      expect(prisma.mediaAsset.delete).toHaveBeenCalledTimes(1);
      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm1' } }),
      );
    });

    it('keeps a shared file while another media still holds it', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      prisma.mediaAsset.delete.mockResolvedValue({ id: 'm1', blobSha256: 'a'.repeat(64) });
      prisma.mediaBlob.deleteMany.mockResolvedValue({ count: 0 });
      await service.releaseUnused(['m1']);
      expect(prisma.mediaBlob.deleteMany).toHaveBeenCalledWith({
        where: { sha256: 'a'.repeat(64), assets: { none: {} } },
      });
    });

    it('keeps a media another quiz still uses (a duplicated quiz shares it)', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue({
        _count: { ...unused._count, questionVisuals: 1 },
      });
      await service.releaseUnused(['m1']);
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('keeps an image still typed into some Markdown', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      prisma.$queryRaw.mockResolvedValue([{ used: true }]);
      await service.releaseUnused(['m1']);
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('keeps a media a session is playing, from its frozen snapshot', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      redis.keys.mockResolvedValue(['game:123456:snapshot']);
      redis.mget.mockResolvedValue(['{"media":{"url":"/api/v1/media/m1"}}'] as never);
      await service.releaseUnused(['m1']);
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('lets go of a media once its session has ended, keys or not', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      redis.keys.mockResolvedValue(['game:123456:snapshot']);
      redis.hget.mockResolvedValueOnce('ENDED');
      redis.mget.mockResolvedValue(['{"media":{"url":"/api/v1/media/m1"}}'] as never);
      await service.releaseUnused(['m1']);
      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm1' } }),
      );
    });

    it('only releases what the save named: the rest is the scheduled sweep', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      await service.releaseUnused(['m1']);
      expect(prisma.mediaAsset.findMany).not.toHaveBeenCalled();
    });

    it('keeps a media an archived session still shows', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      prisma.$queryRaw.mockResolvedValue([{ used: true }]);
      await service.releaseUnused(['m1']);
      const [sql] = prisma.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];
      expect(sql.join('?')).toContain('"game_session_log"');
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('sweeps media of every kind nothing took, once their editor had time', async () => {
      prisma.mediaAsset.findMany.mockResolvedValue([{ id: 'old' }]);
      prisma.mediaAsset.findUnique.mockResolvedValue(unused);
      await expect(service.sweepOrphans()).resolves.toBe(1);
      const { where } = (
        prisma.mediaAsset.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
      )[0];
      expect(where).not.toHaveProperty('kind');
      expect(where).toMatchObject({
        coverForQuizzes: { none: {} },
        questionVisuals: { none: {} },
        questionAudios: { none: {} },
        questionBackgrounds: { none: {} },
        slides: { none: {} },
        options: { none: {} },
      });
      expect(prisma.mediaAsset.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'old' } }),
      );
    });

    it('spares a media the full check finds held (a slot, Markdown)', async () => {
      prisma.mediaAsset.findMany.mockResolvedValue([{ id: 'bg' }]);
      prisma.mediaAsset.findUnique.mockResolvedValue({
        _count: { ...unused._count, questionBackgrounds: 1 },
      });
      await expect(service.sweepOrphans()).resolves.toBe(0);
      expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('never fails the save that called it', async () => {
      prisma.mediaAsset.findUnique.mockRejectedValue(new Error('db down'));
      await expect(service.releaseUnused(['m1'])).resolves.toBeUndefined();
    });
  });

  describe('purgeStrayFiles', () => {
    const fs = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
    const KNOWN = '01K0000000000000000000KNWN';
    const STRAY = '01K0000000000000000000STRY';
    const FRESH = '01K0000000000000000000FRSH';
    let dir: string;
    let env: NodeJS.ProcessEnv;

    beforeEach(async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'media-'));
      env = process.env;
      process.env = { ...env, MEDIA_DIR: dir };
      service = new MediaService(
        prisma as unknown as PrismaService,
        redis as unknown as RedisService,
      );
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      for (const name of [KNOWN, STRAY, 'README.txt']) {
        await fs.writeFile(join(dir, name), 'x');
        await fs.utimes(join(dir, name), old, old);
      }
      await fs.writeFile(join(dir, FRESH), 'x');
      prisma.mediaAsset.findMany.mockResolvedValue([{ id: KNOWN }]);
    });

    afterEach(async () => {
      process.env = env;
      await fs.rm(dir, { recursive: true, force: true });
    });

    it('deletes old files no media row points to, and nothing else', async () => {
      await expect(service.purgeStrayFiles()).resolves.toBe(1);
      expect((await fs.readdir(dir)).sort()).toEqual([FRESH, KNOWN, 'README.txt'].sort());
    });

    it('keeps every file when the database holds no media at all', async () => {
      prisma.mediaAsset.count.mockResolvedValue(0);
      await expect(service.purgeStrayFiles()).resolves.toBe(0);
      expect(await fs.readdir(dir)).toHaveLength(4);
    });
  });
});
