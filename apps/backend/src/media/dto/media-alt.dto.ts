import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Alternative text of a media (#43). An empty string is a valid answer — for a
 * decorative image it is the right one, and a wrong text is worse than none.
 */
export const mediaAltSchema = z.object({
  alt: z.string().max(300),
});

export class MediaAltDto extends createZodDto(mediaAltSchema) {}

export const mediaDescriptionSchema = z.object({
  id: z.string(),
  alt: z.string().nullable(),
});

export class MediaDescriptionDto extends createZodDto(mediaDescriptionSchema) {}
