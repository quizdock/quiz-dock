import { createZodDto } from 'nestjs-zod';
import { PARTICIPANT_ACCESS, userPreferencesSchema } from '@quiz-dock/contracts';
import { z } from 'zod';

/** What the account remembers (`GET /me/preferences`); an absent key is the default. */
export class UserPreferencesDto extends createZodDto(userPreferencesSchema) {}

/**
 * Partial change (`PATCH /me/preferences`): a key left out is kept, `null` goes
 * back to the default. Unknown keys are refused rather than stored unread.
 */
export const updatePreferencesSchema = z
  .object({
    participantAccess: z.enum(PARTICIPANT_ACCESS).nullable().optional(),
  })
  .strict();

export class UpdatePreferencesDto extends createZodDto(updatePreferencesSchema) {}
