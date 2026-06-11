import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Résultat d'un upload média. */
export const mediaUploadResultSchema = z.object({
  mediaId: z.string(),
  url: z.string(),
});

export class MediaUploadResultDto extends createZodDto(mediaUploadResultSchema) {}
