import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SETTING_LIST } from '@quiz-dock/contracts';
import { type OverrideStore, overrides } from './settings.service';

const SETTING_KEYS = new Set(SETTING_LIST.map((d) => d.key));

/** The Redis channel a replica publishes on when it changed an override (§3.1). */
export const SETTINGS_CHANNEL = 'settings:changed';
/** A periodic read again, as a safety net for a lost message (R8). */
export const OVERRIDES_REFRESH_MS = 60_000;

/** Keys of `instance_setting` that are the instance's own flags, not settings. */
export const FLAG_PREFIX = 'setup.';

export interface OverrideChange {
  key: string;
  /** The raw text; `null` removes the override (back to `.env`). */
  value: string | null;
}

/**
 * The settings changed from the administration (`instance_setting`, §3.1):
 * loaded at start into the store the settings read, written all together or
 * not at all, and announced to every replica through Redis.
 */
@Injectable()
export class OverridesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OverridesService.name);
  private subscriber: Redis | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** The store the backend's settings read (a fresh one in tests). */
  store: OverrideStore = overrides;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload().catch((err: Error) =>
      this.log.warn(`Overrides not loaded (${err.message}): the environment applies alone.`),
    );
    try {
      this.subscriber = this.redis.duplicate();
      this.subscriber.on('error', () => undefined);
      await this.subscriber.subscribe(SETTINGS_CHANNEL);
      this.subscriber.on('message', () => void this.reload().catch(() => undefined));
    } catch {
      // No Redis (a CLI without it): the periodic read keeps the replicas in step.
    }
    this.timer = setInterval(() => void this.reload().catch(() => undefined), OVERRIDES_REFRESH_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Reads every override again: the settings swap to them at once. */
  async reload(): Promise<void> {
    const rows = await this.prisma.instanceSetting.findMany({ select: { key: true, value: true } });
    // The settings only: the instance's flags and palette live in the same table.
    this.store.replace(rows.filter((r) => SETTING_KEYS.has(r.key)).map((r) => [r.key, r.value]));
  }

  /** The overrides with who changed them and when. */
  list() {
    return this.prisma.instanceSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /** Applies changes all together, or none (§3.11, unit of work), then tells every replica. */
  async apply(changes: OverrideChange[], actor: { name: string; userId?: string }): Promise<void> {
    await this.prisma.$transaction(
      changes.map((c) =>
        c.value === null
          ? this.prisma.instanceSetting.deleteMany({ where: { key: c.key } })
          : this.prisma.instanceSetting.upsert({
              where: { key: c.key },
              create: {
                key: c.key,
                value: c.value,
                updatedBy: actor.name,
                userId: actor.userId ?? null,
              },
              update: { value: c.value, updatedBy: actor.name, userId: actor.userId ?? null },
            }),
      ),
    );
    await this.reload();
    await this.redis.publish(SETTINGS_CHANNEL, changes.map((c) => c.key).join(',')).catch(() => 0);
  }

  /** A value of the instance that is not a setting (`setup.completed`, `theme.palette`…). */
  async value(key: string): Promise<string | null> {
    return (await this.prisma.instanceSetting.findUnique({ where: { key } }))?.value ?? null;
  }

  async setValue(
    key: string,
    value: string | null,
    actor: { name: string; userId?: string },
  ): Promise<void> {
    if (value === null) await this.prisma.instanceSetting.deleteMany({ where: { key } });
    else
      await this.prisma.instanceSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: actor.name, userId: actor.userId ?? null },
        update: { value, updatedBy: actor.name, userId: actor.userId ?? null },
      });
  }

  /** An instance flag (`setup.completed`…), not a setting. */
  flag(key: string): Promise<string | null> {
    return this.value(FLAG_PREFIX + key);
  }

  setFlag(
    key: string,
    value: string | null,
    actor: { name: string; userId?: string },
  ): Promise<void> {
    return this.setValue(FLAG_PREFIX + key, value, actor);
  }
}
