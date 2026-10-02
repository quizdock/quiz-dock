import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A call of an operation from the web (§3.4). */
export const runOperationSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  /** Say what would be done (operations that can). */
  dryRun: z.boolean().optional(),
  /** The token a `confirm` answer handed out. */
  confirmation: z.string().max(128).optional(),
});
export class RunOperationDto extends createZodDto(runOperationSchema) {}

const note = z.object({
  level: z.enum(['info', 'warn']),
  code: z.string(),
  text: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** What a call answers when it ran, or asks to be confirmed (a refusal is an HTTP error). */
export const operationAnswerSchema = z.object({
  kind: z.enum(['result', 'confirm']),
  result: z
    .object({
      outcome: z.enum(['done', 'nothing-to-do', 'partial']),
      notes: z.array(note),
      data: z.unknown().optional(),
    })
    .optional(),
  token: z.string().optional(),
  summary: z.string().optional(),
});
export class OperationAnswerDto extends createZodDto(operationAnswerSchema) {}

export const operationDescriptorSchema = z.object({
  id: z.string(),
  domain: z.enum(['media', 'quizzes', 'instance']),
  category: z.string(),
  effect: z.enum(['read', 'write', 'destructive']),
  summary: z.string(),
  params: z.record(z.string(), z.unknown()),
  dryRun: z.boolean(),
  upload: z.string().optional(),
  reachable: z.boolean(),
  refusal: z.string().optional(),
});
export class OperationCatalogueDto extends createZodDto(
  z.object({ operations: z.array(operationDescriptorSchema) }),
) {}
