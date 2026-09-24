import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Largest file accepted per kind, in bytes: the editor sizes its conversions to fit. */
export const mediaLimitsSchema = z.object({
  image: z.number().int(),
  video: z.number().int(),
  audio: z.number().int(),
});

export class MediaLimitsDto extends createZodDto(mediaLimitsSchema) {}
