import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Résultat d'un upload média. */
export const mediaUploadResultSchema = z.object({
  mediaId: z.string(),
  url: z.string(),
  /** What the content turned out to be, whatever the file was called. */
  kind: z.enum(['image', 'audio', 'video']),
});

export class MediaUploadResultDto extends createZodDto(mediaUploadResultSchema) {}
