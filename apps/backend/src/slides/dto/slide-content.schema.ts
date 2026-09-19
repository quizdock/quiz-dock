import { z } from 'zod';
import { gradientSchema } from '../../common/background.schema';

export { gradientSchema };

const blockId = z.string().min(1).max(64);

/** Leaf blocks (#7): what a slide is made of; `columns` lays them side by side. */
const leafBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    id: blockId,
    text: z.string().trim().min(1).max(200),
    level: z.union([z.literal(1), z.literal(2)]).default(1),
    align: z.enum(['left', 'center', 'right']).optional(),
  }),
  z.object({
    type: z.literal('text'),
    id: blockId,
    /** Markdown, block profile (images inside are allowed too). */
    md: z.string().trim().min(1).max(5000),
    align: z.enum(['left', 'center', 'right']).optional(),
    size: z.enum(['small', 'medium', 'large']).optional(),
  }),
  z.object({
    type: z.literal('image'),
    id: blockId,
    mediaId: z.string().length(26),
    size: z.enum(['small', 'medium', 'large', 'full']).default('large'),
    align: z.enum(['left', 'center', 'right']).default('center'),
  }),
]);

const columnsBlockSchema = z.object({
  type: z.literal('columns'),
  id: blockId,
  columns: z.array(z.array(leafBlockSchema).max(10)).min(2).max(3),
  /** Width split for two columns (ignored for three). */
  ratio: z.enum(['1-1', '1-2', '2-1']).optional(),
});

export const slideBlockSchema = z.union([leafBlockSchema, columnsBlockSchema]);
export type SlideBlockInput = z.infer<typeof slideBlockSchema>;

/**
 * Content of a slide (#7): blocks, an optional full-cover background with its
 * text contrast settings, and the auto-mode display time. A slide needs at
 * least one block or a background, otherwise there is nothing to show.
 */
export const slideContentSchema = z
  .object({
    blocks: z.array(slideBlockSchema).max(30).default([]),
    mediaId: z.string().length(26).nullable().optional(),
    gradient: gradientSchema.nullable().optional(),
    textTone: z.enum(['light', 'dark']).default('light'),
    textOutline: z.boolean().default(true),
    // Auto-mode display time: null = engine default, 0 = manual override, else seconds.
    displayDelayS: z.number().int().min(0).max(600).nullable().optional(),
  })
  .refine((d) => d.blocks.length > 0 || Boolean(d.mediaId) || Boolean(d.gradient), {
    message: 'slide.empty',
    path: ['blocks'],
  })
  .refine((d) => !(d.mediaId && d.gradient), {
    message: 'slide.background_conflict',
    path: ['gradient'],
  });

export type SlideContent = z.infer<typeof slideContentSchema>;
