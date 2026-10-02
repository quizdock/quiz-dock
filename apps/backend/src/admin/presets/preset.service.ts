import { Injectable } from '@nestjs/common';
import {
  PRESET_AXES,
  type PresetAxisId,
  SETTING_LIST,
  SETTINGS,
  type SettingDefinition,
} from '@quiz-dock/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { CallActor } from '../operations/operation';
import { OperationError } from '../operations/operation';
import { OverridesService } from '../settings/overrides.service';
import { type SettingsService, settings as appSettings } from '../settings/settings.service';

export type AxisLevels = Partial<Record<PresetAxisId, string>>;

export interface PresetChange {
  key: string;
  from: { value: unknown; source: 'default' | 'env' | 'override' };
  to: unknown;
  /** Left alone, and why: locked by `ADMIN_LOCK`, or an axis that does not apply here. */
  skipped?: 'locked' | 'not-applicable';
}

export interface PresetPlan {
  axes: AxisLevels;
  changes: PresetChange[];
}

/** The variables of an axis: those whose definition names it (§3.9). */
export const axisSettings = (axis: PresetAxisId): SettingDefinition[] =>
  SETTING_LIST.filter((d) => d.preset?.axis === axis);

/** The raw text a typed value is written as, in an override. */
const raw = (def: SettingDefinition, value: unknown): string => {
  // The media libraries: a JSON list, or `none` for no library at all.
  if (def.key === 'MEDIA_LIBRARY_LINKS') {
    return Array.isArray(value) && value.length ? JSON.stringify(value) : 'none';
  }
  return Array.isArray(value) ? value.join(',') : String(value);
};

/**
 * Presets (§3.9): levels on independent axes, and named shortcuts to them. Goes
 * through the overrides like any change — validation, locks and audit apply
 * with no rule of its own.
 */
@Injectable()
export class PresetService {
  settings: SettingsService = appSettings;

  constructor(private readonly overrides: OverridesService) {}

  /** Each axis's level, `custom` once one of its variables strays from every level. */
  current(): Record<PresetAxisId, string> {
    return Object.fromEntries(
      PRESET_AXES.map((axis) => {
        const defs = axisSettings(axis.id);
        const level = axis.levels.find((l) =>
          defs.every((d) => isDeepStrictEqual(this.settings.get(d), d.preset!.levels[l])),
        );
        return [axis.id, level ?? 'custom'];
      }),
    ) as Record<PresetAxisId, string>;
  }

  /** The answers, checked against the questions. */
  resolve(axes: AxisLevels): AxisLevels {
    for (const [id, level] of Object.entries(axes)) {
      const axis = PRESET_AXES.find((a) => a.id === id);
      if (!axis?.levels.includes(level)) {
        throw new OperationError('invalid_params', `No answer "${level}" to "${id}".`);
      }
    }
    return axes;
  }

  /** What applying it would change, variable by variable, and what it leaves alone. */
  plan(axes: AxisLevels, actor: CallActor): PresetPlan {
    const locks = actor.via === 'api' ? this.settings.get(SETTINGS.ADMIN_LOCK) : [];
    const changes: PresetChange[] = [];
    for (const axis of PRESET_AXES) {
      const level = axes[axis.id];
      if (!level) continue;
      for (const def of axisSettings(axis.id)) {
        const requires = def.preset!.requires;
        const applies =
          !requires || String(this.settings.get(SETTINGS[requires.key])) === requires.value;
        const state = this.settings.describe(def);
        const to = def.preset!.levels[level];
        if (isDeepStrictEqual(state.value, to)) continue;
        changes.push({
          key: def.key,
          from: { value: state.value, source: state.source },
          to,
          ...(!applies
            ? { skipped: 'not-applicable' as const }
            : locks.includes(def.key)
              ? { skipped: 'locked' as const }
              : {}),
        });
      }
    }
    return { axes, changes };
  }

  /** Every change of the plan, all together or none (§3.11, unit of work). */
  async apply(plan: PresetPlan, actor: CallActor): Promise<PresetChange[]> {
    const applied = plan.changes.filter((c) => !c.skipped);
    if (applied.length) {
      await this.overrides.apply(
        applied.map((c) => ({
          key: c.key,
          value: raw(SETTING_LIST.find((d) => d.key === c.key)!, c.to),
        })),
        actor,
      );
    }
    return applied;
  }
}
