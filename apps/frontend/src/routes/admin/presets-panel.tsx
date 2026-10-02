import type { NamedPreset, PresetAxis, PresetAxisId } from '@quiz-dock/contracts';
import { Check, Eye } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { apiErrorText } from '../../api/http';
import { type Answer, useRunOperation, useReadOperation, useRefreshAdmin } from './admin-api';
import type { SettingRow, SettingsAccess } from './settings-model';
import { Value } from './settings-page';

interface PresetsData {
  axes: (PresetAxis & { settings: { key: string; levels: Record<string, unknown> }[] })[];
  presets: NamedPreset[];
  current: Record<PresetAxisId, string>;
}

interface PlanChange {
  key: string;
  from: { value: unknown; source: SettingRow['source'] };
  to: unknown;
  skipped?: 'locked' | 'not-applicable';
}

type Target = { preset: string } | Partial<Record<PresetAxisId, string>>;

export const usePresets = () => useReadOperation<PresetsData>('presets.list');

/** Where the instance stands on a setting's axis: "Pace · comfortable" (§3.9). */
export function AxisBadge({ settingKey }: { settingKey: string }) {
  const { t } = useTranslation('admin');
  const presets = usePresets().data?.data;
  const axis = presets?.axes.find((a) => a.settings.some((s) => s.key === settingKey));
  if (!presets || !axis) return null;
  return (
    <Badge variant="muted">
      {t(`presets.axes.${axis.id}`)} · {t(`presets.levels.${presets.current[axis.id]}`)}
    </Badge>
  );
}

/**
 * Ready-made sets of values (§3.9): the named presets, one selector per axis,
 * the preview of every change before it is applied — at once, or not at all.
 */
export function PresetsPanel({
  access,
  wizard = false,
}: {
  access: SettingsAccess;
  /** The setup wizard applies presets whatever the scope (§3.8). */
  wizard?: boolean;
}) {
  const { t } = useTranslation('admin');
  const refresh = useRefreshAdmin();
  const runOperation = useRunOperation();
  const presets = usePresets();
  const [target, setTarget] = useState<Target | null>(null);
  const [changes, setChanges] = useState<PlanChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Extract<Answer, { kind: 'confirm' }> | null>(null);
  const [done, setDone] = useState(false);
  const data = presets.data?.data;
  if (!data) return null;
  const readOnly = (access.scope !== 'write' && !wizard) || access.safeMode;
  const matching = data.presets.find((p) =>
    Object.entries(p.levels).every(([axis, level]) => data.current[axis as PresetAxisId] === level),
  );

  const preview = async (next: Target) => {
    setTarget(next);
    setError(null);
    setDone(false);
    try {
      const answer = await runOperation('presets.plan', next);
      if (answer.kind === 'result')
        setChanges((answer.result.data as { plan: { changes: PlanChange[] } }).plan.changes);
    } catch (err) {
      setError(apiErrorText(err));
    }
  };
  const apply = async (confirmation?: string) => {
    if (!target) return;
    setError(null);
    try {
      const answer = await runOperation('presets.apply', target, { confirmation });
      if (answer.kind === 'confirm') setConfirm(answer);
      else {
        setTarget(null);
        setChanges(null);
        setDone(true);
        await refresh();
      }
    } catch (err) {
      setError(apiErrorText(err));
    }
  };

  return (
    <section aria-labelledby="presets-title" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="presets-title" className="font-semibold">
          {t('presets.title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {readOnly ? t('presets.readOnly') : t('presets.intro')}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {data.presets.map((p) => {
          const current = matching?.id === p.id;
          const chosen = target && 'preset' in target && target.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={readOnly}
              aria-pressed={!!chosen}
              onClick={() => void preview({ preset: p.id })}
              className={cn(
                'flex flex-col gap-1 rounded-md border p-3 text-left text-sm disabled:cursor-default disabled:opacity-70',
                chosen ? 'border-primary bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {current ? <Check aria-hidden className="text-success size-4" /> : null}
                {t(`presets.named.${p.id}.title`)}
              </span>
              <span className="text-muted-foreground text-xs">
                {t(`presets.named.${p.id}.help`)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4">
        {data.axes.map((axis) => {
          const notHere = axis.requires && access.authMode !== axis.requires.value;
          return (
            <label key={axis.id} className="flex flex-col gap-1 text-sm">
              {t(`presets.axes.${axis.id}`)}
              <Select
                value={data.current[axis.id]}
                disabled={readOnly || !!notHere}
                title={notHere ? t('presets.notHere') : undefined}
                onChange={(e) => void preview({ [axis.id]: e.target.value })}
                className="w-48"
              >
                {data.current[axis.id] === 'custom' ? (
                  <option value="custom">{t('presets.levels.custom')}</option>
                ) : null}
                {axis.levels.map((l) => (
                  <option key={l} value={l}>
                    {t(`presets.levels.${l}`)}
                  </option>
                ))}
              </Select>
            </label>
          );
        })}
      </div>
      {changes ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Eye aria-hidden className="size-4" />
            {changes.length ? t('presets.preview') : t('presets.nothing')}
          </p>
          {changes.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {changes.map((c) => (
                <li
                  key={c.key}
                  className={cn(
                    'flex flex-wrap gap-x-2',
                    c.skipped && 'text-muted-foreground line-through',
                  )}
                >
                  <span className="font-medium">
                    {t(`labels.${c.key}`, { defaultValue: c.key })}
                  </span>
                  <span>
                    <Value row={{ key: c.key, secret: false }} value={c.from.value} /> →{' '}
                    <Value row={{ key: c.key, secret: false }} value={c.to} />
                  </span>
                  <span className="text-muted-foreground">({t(`source.${c.from.source}`)})</span>
                  {c.skipped ? (
                    <span className="no-underline">{t(`presets.skipped.${c.skipped}`)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!changes.some((c) => !c.skipped)}
              onClick={() => void apply()}
            >
              {t('presets.apply')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTarget(null);
                setChanges(null);
              }}
            >
              {t('edit.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {done ? (
        <p role="status" className="text-success text-sm">
          {t('presets.applied')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={t('presets.title')}
        description={confirm?.summary}
        confirmLabel={t('run.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const token = confirm?.token;
          setConfirm(null);
          void apply(token);
        }}
      />
    </section>
  );
}
