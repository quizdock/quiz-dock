import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { MediaService } from './media.service';

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

const file = (over: Partial<{ mimetype: string; size: number }> = {}) => ({
  buffer: Buffer.from('x'),
  mimetype: 'image/png',
  size: 10,
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

  it('refuse un mime non supporté (avant tout écrit)', async () => {
    await expect(service.upload('o1', file({ mimetype: 'text/plain' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('refuse un média audio tant qu’aucun écran ne le joue (#42)', async () => {
    await expect(service.upload('o1', file({ mimetype: 'audio/mpeg' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('refuse un fichier trop volumineux', async () => {
    await expect(service.upload('o1', file({ size: service.maxUploadBytes + 1 }))).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
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
