import type { PresetAxis, PresetAxisId } from '@quiz-dock/contracts';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { apiErrorText } from '../../api/http';
import {
  type Answer,
  useReadOperation,
  useRefreshAdmin,
  useRunOperation,
} from '../admin/admin-api';
import type { SettingRow } from '../admin/settings-model';
import { Value } from '../admin/settings-page';

interface PresetsData {
  axes: PresetAxis[];
  current: Record<PresetAxisId, string>;
}

interface PlanChange {
  key: string;
  from: { value: unknown; source: SettingRow['source'] };
  to: unknown;
  skipped?: 'locked' | 'not-applicable';
}

type Answers = Partial<Record<PresetAxisId, string>>;

/** « Other, a bit of everything »: no answer, nothing changed. */
const OTHER = 'other';

/**
 * The quick setup of a new instance (§3.9): three questions in plain words —
 * internet, who plays, accessibility —, each answer setting several variables
 * at once, previewed before it is applied. The steps after it come filled in.
 */
export function UsageStep() {
  const { t } = useTranslation('admin');
  const presets = useReadOperation<PresetsData>('presets.list');
  const run = useRunOperation();
  const refresh = useRefreshAdmin();
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [changes, setChanges] = useState<PlanChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Extract<Answer, { kind: 'confirm' }> | null>(null);
  const [applied, setApplied] = useState(false);
  const data = presets.data?.data;

  // The instance's own answers, as a start; a question it answers no way stays open.
  useEffect(() => {
    if (!data || answers) return;
    setAnswers(
      Object.fromEntries(
        data.axes
          .filter((a) => data.current[a.id] !== 'custom')
          .map((a) => [a.id, data.current[a.id]]),
      ),
    );
  }, [data, answers]);

  // What the answers would change, read again at each answer.
  useEffect(() => {
    if (!answers) return;
    if (Object.keys(answers).length === 0) {
      setChanges([]);
      return;
    }
    let live = true;
    run('presets.plan', answers)
      .then((a) => {
        if (live && a.kind === 'result') {
          setChanges((a.result.data as { plan: { changes: PlanChange[] } }).plan.changes);
        }
      })
      .catch((err) => live && setError(apiErrorText(err)));
    return () => {
      live = false;
    };
  }, [answers, run]);

  if (!data || !answers) return null;

  const apply = async (confirmation?: string) => {
    setError(null);
    try {
      const a = await run('presets.apply', answers, { confirmation });
      if (a.kind === 'confirm') setConfirm(a);
      else {
        setApplied(true);
        await refresh();
        // The preview, read again: what is left to change.
        setAnswers((prev) => ({ ...prev }));
      }
    } catch (err) {
      setError(apiErrorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {data.axes.map((axis) => (
        <fieldset key={axis.id} className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t(`usage.${axis.id}.question`)}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {[...axis.levels, ...(axis.id === 'audience' ? [OTHER] : [])].map((level) => {
              const chosen =
                level === OTHER ? answers[axis.id] === undefined : answers[axis.id] === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={chosen}
                  // No answer forces anything: choosing the one already chosen, or
                  // « other », leaves the question unanswered and its settings alone.
                  onClick={() => {
                    setApplied(false);
                    setAnswers((prev) => {
                      const next = { ...prev };
                      if (level === OTHER || prev?.[axis.id] === level) delete next[axis.id];
                      else next[axis.id] = level;
                      return next;
                    });
                  }}
                  className={cn(
                    'flex flex-col gap-1 rounded-md border p-3 text-left text-sm',
                    chosen ? 'border-primary bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <span className="font-medium">
                    {t(`usage.${axis.id}.answers.${level}.title`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`usage.${axis.id}.answers.${level}.help`)}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {changes ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Eye aria-hidden className="size-4" />
            {changes.length ? t('usage.preview') : t('usage.nothing')}
          </p>
          {changes.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {changes.map((c) => (
                <li
                  key={c.key}
                  className={cn('flex flex-wrap gap-x-2', c.skipped && 'text-muted-foreground')}
                >
                  <span className="font-medium">
                    {t(`labels.${c.key}`, { defaultValue: c.key })}
                  </span>
                  <span className={cn(c.skipped && 'line-through')}>
                    <Value row={{ key: c.key, secret: false }} value={c.from.value} /> →{' '}
                    <Value row={{ key: c.key, secret: false }} value={c.to} />
                  </span>
                  {c.skipped ? <span>({t(`usage.skipped.${c.skipped}`)})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={!changes.some((c) => !c.skipped)}
              onClick={() => void apply()}
            >
              {t('usage.apply')}
            </Button>
            {applied ? (
              <p role="status" className="text-success text-sm">
                {t('usage.applied')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={t('setup.step.usage.title')}
        description={confirm?.summary}
        confirmLabel={t('run.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const token = confirm?.token;
          setConfirm(null);
          void apply(token);
        }}
      />
    </div>
  );
}
