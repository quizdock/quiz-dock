import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const kind = z.enum(['image', 'video', 'audio']);
const sweep = z.object({
  adopted: z.number().int(),
  media: z.number().int(),
  blobs: z.number().int(),
  files: z.number().int(),
});

/** What the instance's media volume holds, and what the clean-up has to do (#54). */
export const mediaOverviewSchema = z.object({
  files: z.number().int(),
  bytes: z.number().int(),
  byKind: z.array(z.object({ kind, files: z.number().int(), bytes: z.number().int() })),
  byOwner: z.array(
    z.object({
      ownerId: z.string(),
      displayName: z.string(),
      files: z.number().int(),
      bytes: z.number().int(),
    }),
  ),
  legacy: z.object({
    files: z.number().int(),
    bytes: z.number().int(),
    mimes: z.array(z.string()),
  }),
  cleanup: z.object({
    orphans: z.object({
      count: z.number().int(),
      bytes: z.number().int(),
      /** Still within the day an editor may take to save them. */
      waiting: z.number().int(),
    }),
    strayFiles: z.object({ count: z.number().int(), bytes: z.number().int() }),
    guard: z.enum(['empty_database', 'database_older']).nullable(),
    lastRun: sweep.extend({ at: z.string() }).nullable(),
  }),
});

export class MediaOverviewDto extends createZodDto(mediaOverviewSchema) {}

export const mediaFilesQuerySchema = z.object({
  kind: kind.optional(),
  ownerId: z.string().max(26).optional(),
  legacy: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['size', 'usage', 'recent']).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class MediaFilesQueryDto extends createZodDto(mediaFilesQuerySchema) {}

export const mediaFileRowSchema = z.object({
  id: z.string(),
  url: z.string(),
  kind,
  mime: z.string(),
  name: z.string().nullable(),
  sizeBytes: z.number().int(),
  owners: z.array(z.string()),
  mediaCount: z.number().int(),
  quizCount: z.number().int(),
  inHistory: z.boolean(),
  /** Stored before the converter (MP3, PNG, JPEG…). */
  legacy: z.boolean(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Length of a sound or a video (ms). */
  durationMs: z.number().int().nullable(),
  /** A sound's waveform, for the preview's player (empty otherwise). */
  peaks: z.array(z.number()),
  /** Among the global media (#62). */
  inCatalog: z.boolean(),
  /** The global media on this file, and its credit: what the Global view edits and withdraws. */
  instanceId: z.string().nullable(),
  instanceCredit: z.string().nullable(),
  createdAt: z.string(),
});

export const mediaFilesPageSchema = z.object({
  total: z.number().int(),
  items: z.array(mediaFileRowSchema),
});

export class MediaFilesPageDto extends createZodDto(mediaFilesPageSchema) {}

export const mediaFileUsagesSchema = z.object({
  quizzes: z.array(z.object({ id: z.string(), title: z.string(), owner: z.string() })),
  archivedSessions: z.number().int(),
  /** A session plays it right now: it cannot be deleted. */
  playing: z.boolean(),
});

export class MediaFileUsagesDto extends createZodDto(mediaFileUsagesSchema) {}

export const mediaSweepResultSchema = z.object({
  /** False when another pass was running: nothing was done. */
  ran: z.boolean(),
  result: sweep.nullable(),
});

export class MediaSweepResultDto extends createZodDto(mediaSweepResultSchema) {}

/** The credit of a global media (no alt text: the host writes it for their quiz). */
export const instanceMediaCreditSchema = z.object({
  credit: z.string().max(300),
});

export class InstanceMediaCreditDto extends createZodDto(instanceMediaCreditSchema) {}
