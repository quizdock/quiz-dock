import { BadRequestException } from '@nestjs/common';
import type { MediaAsset, MediaKind, Prisma } from '@prisma/client';
import {
  type LiveQuestionMedia,
  type QuestionMedia,
  VIDEO_WITH_AUDIO,
  playbackGainDb,
} from '@quiz-dock/contracts';
import type { PrismaService } from '../prisma/prisma.service';

/** Relations a question needs to say what its media are. */
export const QUESTION_MEDIA_INCLUDE = {
  visualMedia: true,
  audioMedia: true,
} satisfies Prisma.QuestionInclude;

interface WithMedia {
  visualMedia: MediaAsset | null;
  audioMedia: MediaAsset | null;
}

/** The two slots of a stored question, in the shape of the shared contract. */
export function questionMediaOf(q: WithMedia): QuestionMedia {
  const visual = q.visualMedia;
  if (visual?.kind === 'video') {
    return { visual: { kind: 'video', source: 'upload', assetId: visual.id }, audio: null };
  }
  const audio = q.audioMedia;
  return {
    visual: visual ? { kind: 'image', assetId: visual.id } : null,
    audio: audio
      ? {
          assetId: audio.id,
          origin: audio.audioOrigin ?? 'upload',
          durationMs: audio.durationMs ?? 0,
          peaks: audio.peaks,
        }
      : null,
  };
}

/** The same slots as the screens receive them: URLs and the gain each sound plays at. */
export function liveMediaOf(q: WithMedia): LiveQuestionMedia {
  const visual = q.visualMedia;
  const audio = q.audioMedia;
  const gain = (m: MediaAsset) => playbackGainDb(m.loudnessLufs, m.peakDbfs);
  return {
    visual: !visual
      ? null
      : visual.kind === 'video'
        ? { kind: 'video', source: 'upload', url: visual.url, gainDb: gain(visual) }
        : { kind: 'image', url: visual.url, alt: visual.alt ?? null },
    audio:
      audio && visual?.kind !== 'video'
        ? {
            url: audio.url,
            durationMs: audio.durationMs ?? 0,
            peaks: audio.peaks,
            gainDb: gain(audio),
          }
        : null,
  };
}

/**
 * Checks the media a question is saved with, and returns the columns to write.
 * The shape was validated against the contract already; what only the server
 * can tell is whether each asset exists, belongs to the author and is of the
 * kind its slot holds — a video id in the image slot would slip past the
 * video/audio rule. `attached` are the assets the question already holds: a
 * quiz handed over to another owner keeps media its former owner still shares
 * (`qd quiz:transfer`), and saving it again must not fail on them.
 */
export async function resolveQuestionMedia(
  prisma: PrismaService,
  ownerId: string,
  media: QuestionMedia | undefined,
  attached: (string | null)[] = [],
): Promise<{ visualMediaId: string | null; audioMediaId: string | null }> {
  if (!media) return { visualMediaId: null, audioMediaId: null };
  const { visual, audio } = media;
  if (visual?.kind === 'video' && audio) {
    throw new BadRequestException(VIDEO_WITH_AUDIO);
  }
  if (visual?.kind === 'video' && visual.source === 'embed') {
    // YouTube / Vimeo come with their own switch (MEDIA_EMBEDS_ENABLED), not yet.
    throw new BadRequestException('media.embeds_disabled');
  }
  const expected = new Map<string, MediaKind>();
  if (visual) expected.set(visual.assetId, visual.kind);
  if (audio) expected.set(audio.assetId, 'audio');
  if (expected.size > 0) {
    const assets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: [...expected.keys()] },
        OR: [{ ownerId }, { id: { in: attached.filter((id): id is string => !!id) } }],
      },
      select: { id: true, kind: true },
    });
    for (const [id, kind] of expected) {
      const asset = assets.find((a) => a.id === id);
      if (!asset) throw new BadRequestException('media.not_found');
      if (asset.kind !== kind) throw new BadRequestException('media.wrong_kind');
    }
  }
  return {
    visualMediaId: visual && 'assetId' in visual ? visual.assetId : null,
    audioMediaId: audio?.assetId ?? null,
  };
}
