import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { resolveQuestionMedia } from './question-media';

const id = (c: string) => c.repeat(26);
const audio = { assetId: id('A'), origin: 'upload' as const, durationMs: 1, peaks: [] };

function prismaWith(assets: { id: string; kind: string }[]) {
  const findMany = jest.fn(async () => assets);
  return { prisma: { mediaAsset: { findMany } } as unknown as PrismaService, findMany };
}

describe('resolveQuestionMedia', () => {
  it('writes both slots when each asset is the author’s and of the right kind', async () => {
    const { prisma, findMany } = prismaWith([
      { id: id('I'), kind: 'image' },
      { id: id('A'), kind: 'audio' },
    ]);
    await expect(
      resolveQuestionMedia(prisma, 'o1', {
        visual: { kind: 'image', assetId: id('I') },
        audio,
      }),
    ).resolves.toEqual({ visualMediaId: id('I'), audioMediaId: id('A') });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [id('I'), id('A')] }, OR: [{ ownerId: 'o1' }, { id: { in: [] } }] },
      }),
    );
  });

  it('refuses a video with an audio track, even past the schema', async () => {
    const { prisma } = prismaWith([]);
    const media = { visual: { kind: 'video', source: 'upload', assetId: id('V') }, audio };
    await expect(resolveQuestionMedia(prisma, 'o1', media as never)).rejects.toThrow(
      new BadRequestException('media.video_with_audio'),
    );
  });

  it('refuses a video smuggled into the image slot', async () => {
    const { prisma } = prismaWith([
      { id: id('V'), kind: 'video' },
      { id: id('A'), kind: 'audio' },
    ]);
    const media = { visual: { kind: 'image' as const, assetId: id('V') }, audio };
    await expect(resolveQuestionMedia(prisma, 'o1', media)).rejects.toThrow('media.wrong_kind');
  });

  it('refuses an asset that is not the author’s', async () => {
    const { prisma } = prismaWith([]);
    const media = { visual: { kind: 'image' as const, assetId: id('I') }, audio: null };
    await expect(resolveQuestionMedia(prisma, 'o1', media)).rejects.toThrow('media.not_found');
  });

  it('keeps a media the question already holds, whoever owns it (a transferred quiz)', async () => {
    const { prisma, findMany } = prismaWith([{ id: id('I'), kind: 'image' }]);
    const media = { visual: { kind: 'image' as const, assetId: id('I') }, audio: null };
    await resolveQuestionMedia(prisma, 'o1', media, [id('I'), null]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ ownerId: 'o1' }, { id: { in: [id('I')] } }] }),
      }),
    );
  });

  it('keeps embeds closed until they have their switch', async () => {
    const { prisma } = prismaWith([]);
    const embed = { kind: 'video', source: 'embed', provider: 'youtube', videoId: 'x' } as const;
    await expect(
      resolveQuestionMedia(prisma, 'o1', { visual: embed, audio: null }),
    ).rejects.toThrow('media.embeds_disabled');
  });

  it('clears both slots when no media is sent', async () => {
    const { prisma, findMany } = prismaWith([]);
    await expect(resolveQuestionMedia(prisma, 'o1', undefined)).resolves.toEqual({
      visualMediaId: null,
      audioMediaId: null,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
