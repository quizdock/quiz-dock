import { z } from 'zod';

/** A generated background: 2–4 CSS hex colours along an angle. */
export const gradientSchema = z.object({
  angle: z.number().int().min(0).max(360),
  colors: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .min(2)
    .max(4),
});

/** Full-cover background of a slide or a question: image or gradient (exclusive) + text contrast. */
export const backgroundFields = {
  backgroundMediaId: z.string().length(26).nullable().optional(),
  backgroundGradient: gradientSchema.nullable().optional(),
  textTone: z.enum(['light', 'dark']).default('light'),
  textOutline: z.boolean().default(true),
};

export const backgroundOutputFields = {
  backgroundMediaId: z.string().nullable(),
  backgroundGradient: gradientSchema.nullable(),
  textTone: z.enum(['light', 'dark']),
  textOutline: z.boolean(),
};

export const noBackgroundConflict = (d: {
  backgroundMediaId?: string | null;
  backgroundGradient?: unknown;
}) => !(d.backgroundMediaId && d.backgroundGradient);
