import { Injectable } from '@nestjs/common';
import { readPreferences, type UserPreferences } from '@quiz-dock/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserPreferences> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferences: true },
    });
    return readPreferences(user.preferences);
  }

  /**
   * Merges a partial change in one statement, so two tabs saving different keys
   * never undo each other: set keys are written, `null` ones removed.
   */
  async update(
    userId: string,
    change: Partial<Record<keyof UserPreferences, unknown>>,
  ): Promise<UserPreferences> {
    const set: Record<string, unknown> = {};
    const removed: string[] = [];
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) continue;
      if (value === null) removed.push(key);
      else set[key] = value;
    }
    const rows = await this.prisma.$queryRaw<Array<{ preferences: unknown }>>`
      UPDATE "user"
      SET preferences = (preferences || ${JSON.stringify(set)}::jsonb) - ${removed}::text[],
          updated_at = now()
      WHERE id = ${userId}
      RETURNING preferences`;
    return readPreferences(rows[0]?.preferences);
  }
}
