import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { MediaService } from './media.service';

// Accepted files would land on the volume: the write is not what these tests are about.
jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  writeFile: jest.fn(async () => undefined),
}));

/** Real files (ffmpeg, 0.5 s) — the content check must hold on what encoders produce. */
const fixture = (name: string) => {
  const buffer = readFileSync(join(__dirname, '../../test/fixtures/media', name));
  return { buffer, mimetype: 'application/octet-stream', size: buffer.length };
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const peaks = JSON.stringify(new Array(200).fill(0.5));

function makePrisma() {
  return {
    mediaAsset: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

const file = (over: Partial<{ buffer: Buffer; mimetype: string; size: number }> = {}) => ({
  buffer: PNG,
  mimetype: 'image/png',
  size: PNG.length,
  ...over,
});

describe('MediaService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: MediaService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new MediaService(prisma as unknown as PrismaService);
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
    beforeEach(() => {
      prisma.mediaAsset.create.mockResolvedValue({ id: 'm1' });
    });

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

  it('remove : 404 si non possédé (isolation), pas de delete', async () => {
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(service.remove('o1', 'm1')).rejects.toThrow(NotFoundException);
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'm1', ownerId: 'o1' },
    });
    expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
  });
});
