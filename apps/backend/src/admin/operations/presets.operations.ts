import { Injectable } from '@nestjs/common';
import { NAMED_PRESETS, PRESET_AXES, SETTING_LIST } from '@quiz-dock/contracts';
import { z } from 'zod';
import { PresetService } from '../presets/preset.service';
import { type AdminOperation, defineOperation, done, nothingToDo } from './operation';

const target = z
  .object({
    preset: z.enum(NAMED_PRESETS.map((p) => p.id) as [string, ...string[]]).optional(),
    pace: z.string().max(32).optional(),
    venue: z.string().max(32).optional(),
    audience: z.string().max(32).optional(),
  })
  .refine((t) => !!t.preset !== !!(t.pace || t.venue || t.audience), {
    message: 'a preset, or levels of axes',
  });

const axesOf = (t: z.infer<typeof target>) =>
  Object.fromEntries(
    (['pace', 'venue', 'audience'] as const).flatMap((a) => (t[a] ? [[a, t[a]]] : [])),
  );

const C2 = new Set(SETTING_LIST.filter((d) => d.criticality === 'C2').map((d) => d.key));

/** Presets as operations (§3.9): listed, previewed, applied. */
@Injectable()
export class PresetsOperations {
  constructor(private readonly presets: PresetService) {}

  list(): AdminOperation[] {
    const plan = (t: z.infer<typeof target>, actor: Parameters<PresetService['plan']>[1]) =>
      this.presets.plan(this.presets.resolve({ preset: t.preset, axes: axesOf(t) }), actor);
    return [
      defineOperation({
        id: 'presets.list',
        domain: 'instance',
        category: 'presets',
        effect: 'read',
        summary:
          'The axes of presets, their levels, the named presets, and where the instance stands on each axis.',
        params: z.object({}),
        run: () =>
          Promise.resolve(
            done({
              axes: PRESET_AXES.map((a) => ({
                ...a,
                settings: SETTING_LIST.filter((d) => d.preset?.axis === a.id).map((d) => ({
                  key: d.key,
                  levels: d.preset!.levels,
                })),
              })),
              presets: NAMED_PRESETS,
              current: this.presets.current(),
            }),
          ),
      }),
      defineOperation({
        id: 'presets.plan',
        domain: 'instance',
        category: 'presets',
        effect: 'read',
        summary:
          'What applying a preset would change, variable by variable, and what it would leave alone.',
        params: target,
        validate: (t) => void this.presets.resolve({ preset: t.preset, axes: axesOf(t) }),
        run: (ctx, t) => Promise.resolve(done({ plan: plan(t, ctx.actor) })),
      }),
      defineOperation({
        id: 'presets.apply',
        domain: 'instance',
        category: 'presets',
        effect: 'write',
        summary:
          'Applies a named preset, or levels of axes: every variable concerned at once, a locked one skipped.',
        params: target,
        dryRun: true,
        validate: (t) => void this.presets.resolve({ preset: t.preset, axes: axesOf(t) }),
        run: async (ctx, t) => {
          const p = plan(t, ctx.actor);
          if (ctx.dryRun) return done({ plan: p });
          if (!p.changes.some((c) => !c.skipped)) {
            return nothingToDo('The instance is already there.', 'presets.unchanged', { plan: p });
          }
          const applied = await this.presets.apply(p, ctx.actor);
          return {
            ...done({ plan: p }),
            notes: p.changes
              .filter((c) => c.skipped)
              .map((c) => ({
                level: 'warn' as const,
                code: `presets.skipped.${c.skipped}`,
                text: `${c.key} left alone (${c.skipped}).`,
                params: { key: c.key },
              })),
            memento: Object.fromEntries(applied.map((c) => [c.key, c.from])),
          };
        },
        // A preset that changes a level C2 variable (a size, open access) is confirmed.
        confirmation: (t) => {
          const keys = plan(t, { via: 'api', name: '' })
            .changes.filter((c) => !c.skipped && C2.has(c.key))
            .map((c) => c.key);
          return keys.length ? `This changes ${keys.join(', ')}.` : null;
        },
      }),
    ];
  }
}
