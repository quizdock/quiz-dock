import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const kind = z.enum(['image', 'video', 'audio']);

/** One entry of the author's library: a file, reused or not (#53). */
export const mediaLibraryItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  kind,
  name: z.string().nullable(),
  alt: z.string().nullable(),
  credit: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  /** A sound's waveform (empty otherwise). */
  peaks: z.array(z.number()),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
  /** How many of the author's quizzes use it: an unused one can be deleted. */
  usedIn: z.number().int(),
  /** Shown in a past session's results: kept even when no quiz uses it any more. */
  inHistory: z.boolean(),
});

export class MediaLibraryItemDto extends createZodDto(mediaLibraryItemSchema) {}

export const mediaLibraryQuerySchema = z.object({
  kind: kind.optional(),
  q: z.string().max(100).optional(),
});

export class MediaLibraryQueryDto extends createZodDto(mediaLibraryQuerySchema) {}

/** A free media library the editor links to (`MEDIA_LIBRARY_LINKS`). */
export const mediaLibraryLinkSchema = z.object({
  name: z.string(),
  url: z.string(),
  kinds: z.array(kind),
});

export class MediaLibraryLinkDto extends createZodDto(mediaLibraryLinkSchema) {}

/** Who made a media, under which licence, from where. Empty clears it. */
export const mediaCreditSchema = z.object({
  credit: z.string().max(300),
});

export class MediaCreditDto extends createZodDto(mediaCreditSchema) {}

export const quizCreditsSchema = z.object({
  credits: z.array(z.string()),
});

export class QuizCreditsDto extends createZodDto(quizCreditsSchema) {}
