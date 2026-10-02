import { CircleAlert, CircleCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StaleNotice } from '@/components/ui/stale-notice';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { cn } from '@/lib/utils';
import { PhoneTests } from '../setup/setup-page';
import { type OutputEntry, useReadOperation } from './admin-api';

type Check = {
  level: 'ok' | 'warn' | 'fail';
  text: string;
  code?: string;
  params?: Record<string, unknown>;
};
interface Group {
  title: string;
  code?: string;
  checks: Check[];
}

/** A line in the page's language when it has a code; the shell's English otherwise. */
function useSay() {
  const { t } = useTranslation('admin');
  return (line: { text: string; code?: string; params?: Record<string, unknown> }) =>
    line.code ? t(line.code, { ...line.params, defaultValue: line.text }) : line.text;
}

/**
 * The doctor's output as groups of checks: a line opens a group, the checks
 * below it are its own. A closing line no check follows (its own verdict) is
 * left out: the page says it with the counts.
 */
export function groupChecks(output: OutputEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of output) {
    if (entry.level === 'line')
      groups.push({ title: entry.text, ...(entry.code ? { code: entry.code } : {}), checks: [] });
    else if (entry.level === 'ok' || entry.level === 'warn' || entry.level === 'fail') {
      if (!groups.length) groups.push({ title: '', checks: [] });
      const { level, text, code, params } = entry;
      groups[groups.length - 1].checks.push({
        level,
        text,
        ...(code ? { code } : {}),
        ...(params ? { params } : {}),
      });
    }
  }
  return groups.filter((g) => g.checks.length > 0);
}

const ICON = { ok: CircleCheck, warn: TriangleAlert, fail: CircleAlert } as const;
const TONE = { ok: 'text-success', warn: 'text-warning-text', fail: 'text-destructive' } as const;

/**
 * The instance's health (§3.7): a verdict first — everything fine, or what is
 * not —, then each part checked, the database migrations, and the invitation
 * addresses tried from a phone.
 */
export function HealthPage() {
  const { t } = useTranslation('admin');
  const doctor = useReadOperation('health.doctor');
  const migrations = useReadOperation('migrations.status');
  const list = useReadOperation('settings.list');
  const groups = doctor.data?.data ? groupChecks(doctor.data.data.output) : null;
  const checks = groups?.flatMap((g) => g.checks) ?? [];
  const problems = checks.filter((c) => c.level !== 'ok');
  const m = migrations.data?.data;
  const migrationProblems = m ? m.pending.length + m.failed.length : 0;
  const busy = doctor.isFetching || migrations.isFetching;

  return (
    <div className="flex flex-col gap-6">
      {doctor.isError && groups ? <StaleNotice onRetry={() => void doctor.refetch()} /> : null}
      {doctor.isError && !groups ? (
        <LoadFailed error={doctor.error} />
      ) : !groups ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : (
        <>
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4',
              problems.length + migrationProblems
                ? 'border-warning/45 bg-warning/10'
                : 'border-success/40 bg-success/10',
            )}
          >
            <div className="flex items-center gap-3">
              {problems.length + migrationProblems ? (
                <TriangleAlert aria-hidden className="text-warning-text size-6" />
              ) : (
                <CircleCheck aria-hidden className="text-success size-6" />
              )}
              <div className="flex flex-col">
                <span className="font-medium">
                  {problems.length + migrationProblems
                    ? t('health.problems', { count: problems.length + migrationProblems })
                    : t('health.allGood')}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t('health.checked', { count: checks.length })}
                </span>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void Promise.all([doctor.refetch(), migrations.refetch()])}
            >
              <RefreshCw aria-hidden className={cn('size-4', busy && 'animate-spin')} />
              {t('health.again')}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <CheckGroup key={group.title} group={group} />
            ))}
            {m ? (
              <section className="flex flex-col gap-2 rounded-lg border p-4">
                <h2 className="flex items-center justify-between gap-2 font-medium">
                  {t('health.migrations.title')}
                  <GroupMark checks={[{ level: migrationProblems ? 'warn' : 'ok', text: '' }]} />
                </h2>
                <p className="text-sm">
                  {[
                    t('health.migrations.applied', { count: m.applied.length }),
                    t('health.migrations.pending', { count: m.pending.length }),
                    ...(m.failed.length
                      ? [t('health.migrations.failed', { count: m.failed.length })]
                      : []),
                  ].join(' · ')}
                </p>
                {[...m.failed, ...m.pending].map((name) => (
                  <p key={name} className="text-warning-text flex items-center gap-2 text-sm">
                    <TriangleAlert aria-hidden className="size-4 shrink-0" />
                    <code className="text-xs break-all">{name}</code>
                  </p>
                ))}
                <Disclosure flush title={t('health.migrations.list')}>
                  <ul className="text-muted-foreground flex max-h-64 flex-col gap-0.5 overflow-y-auto text-xs">
                    {[...m.applied].reverse().map((name) => (
                      <li key={name}>
                        <code className="break-all">{name}</code>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </section>
            ) : null}
          </div>
        </>
      )}
      {list.data?.data ? <PhoneTests data={list.data.data} /> : null}
    </div>
  );
}

/**
 * The doctor's checks, part by part (the administration's health page and the
 * setup wizard's health step): a check's level is said in words too, not only
 * by its icon's colour.
 */
export function DoctorChecks({ groups }: { groups: Group[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <CheckGroup key={group.title} group={group} />
      ))}
    </div>
  );
}

/** Whether the doctor found a problem that keeps the instance from working (a `fail`). */
export const isBlocking = (groups: Group[] | null) =>
  !!groups?.some((g) => g.checks.some((c) => c.level === 'fail'));

function CheckGroup({ group }: { group: Group }) {
  const { t } = useTranslation('admin');
  const say = useSay();
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 className="flex items-center justify-between gap-2 font-medium">
        {say({ text: group.title, code: group.code })}
        <GroupMark checks={group.checks} />
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {group.checks.map((check, i) => {
          const Icon = ICON[check.level];
          return (
            <li key={i} className="flex items-start gap-2">
              <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', TONE[check.level])} />
              <span className="break-words">
                <span className="sr-only">{t(`health.level.${check.level}`)}: </span>
                {say(check)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A group's verdict at a glance: the worst of its checks. */
function GroupMark({ checks }: { checks: Check[] }) {
  const level = checks.some((c) => c.level === 'fail')
    ? 'fail'
    : checks.some((c) => c.level === 'warn')
      ? 'warn'
      : 'ok';
  const { t } = useTranslation('admin');
  const Icon = ICON[level];
  return (
    <span role="img" aria-label={t(`health.level.${level}`)}>
      <Icon aria-hidden className={cn('size-4', TONE[level])} />
    </span>
  );
}
