import { BadRequestException } from '@nestjs/common';
import type { AudioOrigin, MediaKind } from '@prisma/client';
import { audioPeaksSchema, loudnessSchema, peakDbfsSchema } from '@quiz-dock/contracts';
import { z } from 'zod';

/** Multipart fields are strings; numbers and the waveform arrive as text. */
const number = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), schema.optional());

const json = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch {
      return v; // left for the schema to refuse
    }
  }, schema.optional());

const uploadMetaSchema = z.object({
  durationMs: number(z.number().int().positive()),
  peaks: json(audioPeaksSchema),
  origin: z.enum(['upload', 'recording']).optional(),
  loudnessLufs: number(loudnessSchema),
  peakDbfs: number(peakDbfsSchema),
});

export interface UploadMeta {
  durationMs?: number;
  peaks?: number[];
  audioOrigin?: AudioOrigin;
  loudnessLufs?: number;
  peakDbfs?: number;
}

/**
 * What the editor measured while decoding a sound, sent along with the file.
 * A sound must come with its duration and waveform — the players draw it
 * without decoding the file; a video may bring its duration and loudness; an
 * image brings nothing. Bounds are checked here, the values are the editor's.
 */
export function parseUploadMeta(kind: MediaKind, fields: Record<string, unknown>): UploadMeta {
  if (kind === 'image') return {};
  const parsed = uploadMetaSchema.safeParse(fields);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'media.metadata_invalid',
      params: { field: parsed.error.issues[0]?.path.join('.') || '_' },
    });
  }
  const m = parsed.data;
  if (kind === 'audio' && (m.durationMs === undefined || m.peaks === undefined)) {
    throw new BadRequestException({
      code: 'media.metadata_invalid',
      params: { field: m.durationMs === undefined ? 'durationMs' : 'peaks' },
    });
  }
  return {
    durationMs: m.durationMs,
    loudnessLufs: m.loudnessLufs,
    peakDbfs: m.peakDbfs,
    ...(kind === 'audio' ? { peaks: m.peaks, audioOrigin: m.origin ?? 'upload' } : {}),
  };
}
