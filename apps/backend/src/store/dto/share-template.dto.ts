import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Body of `POST /store`: which of the caller's quizzes is shared as a template. */
export const shareTemplateSchema = z.object({
  quizId: z.string().length(26),
});

export class ShareTemplateDto extends createZodDto(shareTemplateSchema) {}
