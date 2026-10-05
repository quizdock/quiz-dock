import { Injectable } from '@nestjs/common';
import { readPreferences, type UserPreferences } from '@quiz-dock/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserPreferences> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferences: true, locale: true },
    });
    return withLanguage(readPreferences(user.preferences), user.locale);
  }

  /**
   * Merges a partial change in one statement, so two tabs saving different keys
   * never undo each other: set keys are written, `null` ones removed.
   */
  async update(
    userId: string,
    change: Partial<Record<keyof UserPreferences, unknown>>,
  ): Promise<UserPreferences> {
    const { language, ...rest } = change;
    // The language has a column of its own (#209).
    if (language !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { locale: (language as string | null) ?? null },
      });
    }
    const set: Record<string, unknown> = {};
    const removed: string[] = [];
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      if (value === null) removed.push(key);
      else set[key] = value;
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ preferences: unknown; locale: string | null }>
    >`
      UPDATE "user"
      SET preferences = (preferences || ${JSON.stringify(set)}::jsonb) - ${removed}::text[],
          updated_at = now()
      WHERE id = ${userId}
      RETURNING preferences, locale`;
    return withLanguage(readPreferences(rows[0]?.preferences), rows[0]?.locale ?? null);
  }
}

/** The preferences with the host's language, kept in `user.locale` (#209). */
function withLanguage(prefs: UserPreferences, locale: string | null): UserPreferences {
  return locale ? { ...prefs, language: locale } : prefs;
}
