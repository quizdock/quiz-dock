import { z } from 'zod';

/**
 * How participants get into a live game (#57): with an account of the identity
 * provider, or with the PIN and a nickname alone.
 */
export const PARTICIPANT_ACCESS = ['account', 'open'] as const;
export type ParticipantAccess = (typeof PARTICIPANT_ACCESS)[number];

/**
 * What an account remembers wherever it signs in (`user.preferences`). Only the
 * choices that follow the person live here; the layout of one screen (a folded
 * sidebar, a grid view) stays in that browser. Every key is optional: absent
 * means the application's default.
 */
export const userPreferencesSchema = z.object({
  /**
   * The participant access a launch uses without asking (#57), set by the dialog's
   * "remember" box or the profile page; absent = ask at each launch.
   */
  participantAccess: z.enum(PARTICIPANT_ACCESS).optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/**
 * Reads stored preferences key by key: a value that no longer validates (a key
 * renamed, an option withdrawn) falls back to its default instead of losing the
 * others, and unknown keys are dropped.
 */
export function readPreferences(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const stored = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(userPreferencesSchema.shape)) {
    if (stored[key] === undefined) continue;
    const parsed = schema.safeParse(stored[key]);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as UserPreferences;
}
