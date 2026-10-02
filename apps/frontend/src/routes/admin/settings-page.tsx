import { DEPLOYMENT_VARIABLES, type SettingDefinition } from '@quiz-dock/contracts';
import { ExternalLink, LayoutGrid, Lock, PanelLeft, Rows3, Search, SearchX } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StaleNotice } from '@/components/ui/stale-notice';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { Notice } from '@/components/ui/notice';
import { SectionTitle } from '@/components/ui/page-title';
import { Segmented } from '@/components/ui/segmented';
import { formatAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type AuditEntry, useReadOperation } from './admin-api';
import {
  CATEGORIES,
  RULES,
  type SettingFilter,
  type SettingRow,
  type SettingsAccess,
  type SettingsList,
  definitionOf,
  docLink,
  matches,
  readOnlyReason,
  shownValue,
} from './settings-model';
import { useStoredChoice } from './use-stored-choice';

export type SettingsView = 'cards' | 'split' | 'table';
const VIEWS: SettingsView[] = ['cards', 'split', 'table'];
const FILTERS: SettingFilter[] = ['changed', 'overridden', 'problem', 'editable'];

/** On a phone the cards; elsewhere the list and its detail (§3.7). */
const defaultView = (): SettingsView =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches
    ? 'cards'
    : 'split';

/**
 * Every variable of the instance (§3.7): what it is set to, where that comes
 * from, whether the web may change it and why not, and what it does. The
 * same parts in three layouts.
 */
export function SettingsPage({
  editor,
}: {
  editor?: (row: SettingRow, access: SettingsAccess) => ReactNode;
}) {
  const { t } = useTranslation('admin');
  const list = useReadOperation<SettingsList>('settings.list');
  const [view, setView] = useStoredChoice<SettingsView>(
    'qd-admin-settings-view',
    VIEWS,
    defaultView,
  );
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<SettingFilter>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const label = (key: string) => t(`labels.${key}`, { defaultValue: key });

  const data = list.data?.data;
  const rows = useMemo(
    () => (data ? data.rows.filter((r) => matches(r, query, filters, data.access, label)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `label` follows the language, as `t` does
    [data, query, filters, t],
  );

  if (list.isError && !data) return <LoadFailed error={list.error} />;
  if (!data) return <Spinner label={t('loading')} showLabel className="text-sm" />;

  const toggle = (f: SettingFilter) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  const current = rows.find((r) => r.key === selected) ?? rows[0];
  const parts = { access: data.access, editor };

  return (
    <div className="flex flex-col gap-4">
      {list.isError ? <StaleNotice onRetry={() => void list.refetch()} /> : null}
      <AccessBanner access={data.access} />
      {data.rules.length ? (
        <Notice role="status">
          <p className="font-medium">{t('settings.rules')}</p>
          <ul className="list-disc pl-5">
            {data.rules.map((r) => (
              <li key={r.message}>{r.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">{t('settings.search')}</span>
          <Search
            aria-hidden
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.search')}
            className="pl-8"
          />
        </label>
        <Segmented
          label={t('settings.view')}
          value={view}
          onChange={setView}
          options={[
            { value: 'cards', label: t('settings.views.cards'), icon: LayoutGrid },
            { value: 'split', label: t('settings.views.split'), icon: PanelLeft },
            { value: 'table', label: t('settings.views.table'), icon: Rows3 },
          ]}
        />
      </div>
      <div role="group" aria-label={t('settings.filters.label')} className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filters.has(f)}
            onClick={() => toggle(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              filters.has(f)
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'hover:bg-accent',
            )}
          >
            {t(`settings.filters.${f}`)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={SearchX}>{t('settings.none')}</EmptyState>
      ) : view === 'cards' ? (
        <CardsView rows={rows} {...parts} />
      ) : view === 'split' ? (
        <SplitView rows={rows} current={current} onSelect={setSelected} {...parts} />
      ) : (
        <TableView rows={rows} current={current} onSelect={setSelected} {...parts} />
      )}

      <OutsideVariables />
    </div>
  );
}

interface Parts {
  access: SettingsAccess;
  editor?: (row: SettingRow, access: SettingsAccess) => ReactNode;
}

/** What the web may do, and how to change it (`.env`, then restart). */
function AccessBanner({ access }: { access: SettingsAccess }) {
  const { t } = useTranslation('admin');
  return (
    <Notice tone="info">
      <p>
        {t(access.scope === 'write' ? 'settings.access.write' : 'settings.access.read')}{' '}
        <span className="text-muted-foreground">{t('settings.access.how')}</span>
      </p>
      {access.locks.length ? (
        <p className="mt-1">
          {t('settings.access.locks')} <code className="text-xs">{access.locks.join(', ')}</code>
        </p>
      ) : null}
      {access.safeMode ? <p className="mt-1 font-medium">{t('settings.access.safeMode')}</p> : null}
      {access.tokenRequired ? (
        <p className="mt-1">
          {t(access.tokenSet ? 'settings.access.token' : 'settings.access.noToken')}
        </p>
      ) : null}
    </Notice>
  );
}

function byCategory(rows: SettingRow[]) {
  return CATEGORIES.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  })).filter((g) => g.rows.length);
}

function CardsView({ rows, ...parts }: { rows: SettingRow[] } & Parts) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-6">
      {byCategory(rows).map(({ category, rows: group }) => (
        <section key={category} className="flex flex-col gap-3">
          <SectionTitle>{t(`categories.${category}`)}</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {group.map((row) => (
              <Card key={row.key} className="flex flex-col gap-3 p-4">
                <SettingDetail row={row} {...parts} />
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A state dot: default, from `.env`, changed here, or with a problem. */
function StateDot({ row }: { row: SettingRow }) {
  const { t } = useTranslation('admin');
  const tone = row.issues.length
    ? 'bg-warning'
    : row.source === 'override'
      ? 'bg-primary'
      : row.source === 'env'
        ? 'bg-foreground/60'
        : 'bg-muted-foreground/30';
  const title = row.issues.length ? t('settings.problem') : t(`source.${row.source}`);
  return (
    <span
      aria-label={title}
      title={title}
      className={cn('inline-block size-2 shrink-0 rounded-full', tone)}
    />
  );
}

function SplitView({
  rows,
  current,
  onSelect,
  ...parts
}: { rows: SettingRow[]; current?: SettingRow; onSelect: (key: string) => void } & Parts) {
  const { t } = useTranslation('admin');
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <nav aria-label={t('settings.list')} className="flex flex-col gap-3">
        {byCategory(rows).map(({ category, rows: group }) => (
          <div key={category}>
            <p className="text-muted-foreground px-2 pb-1 text-xs font-medium uppercase">
              {t(`categories.${category}`)}
            </p>
            <ul>
              {group.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    aria-current={row.key === current?.key}
                    onClick={() => onSelect(row.key)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                      row.key === current?.key ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                    )}
                  >
                    <StateDot row={row} />
                    <span className="min-w-0 flex-1 truncate">
                      {t(`labels.${row.key}`, { defaultValue: row.key })}
                    </span>
                    {row.locked || !row.overridable ? (
                      <Lock aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {current ? (
        <Card className="flex h-fit flex-col gap-3 p-4 md:sticky md:top-4">
          <SettingDetail row={current} {...parts} history />
        </Card>
      ) : null}
    </div>
  );
}

function TableView({
  rows,
  current,
  onSelect,
  ...parts
}: { rows: SettingRow[]; current?: SettingRow; onSelect: (key: string) => void } & Parts) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">{t('settings.columns.variable')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.value')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.source')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.env')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.default')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.level')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.applies')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                onClick={() => onSelect(row.key)}
                aria-selected={row.key === current?.key}
                className={cn(
                  'cursor-pointer border-t',
                  row.key === current?.key ? 'bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => onSelect(row.key)}
                  >
                    <StateDot row={row} />
                    <code className="text-xs">{row.key}</code>
                  </button>
                </td>
                <td className="px-3 py-1.5">
                  <Value row={row} value={row.value} />
                </td>
                <td className="px-3 py-1.5">{t(`source.${row.source}`)}</td>
                <td className="px-3 py-1.5">
                  {row.source === 'override' ? <Value row={row} value={row.envValue} /> : '—'}
                </td>
                <td className="px-3 py-1.5">
                  <Value row={row} value={row.default} />
                </td>
                <td className="px-3 py-1.5">{row.criticality}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{t(`applies.${row.applies}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current ? (
        <Card className="flex flex-col gap-3 p-4">
          <SettingDetail row={current} {...parts} history />
        </Card>
      ) : null}
    </div>
  );
}

/** A value as people read it: in megabytes or seconds, a secret only as set or not. */
export function Value({ row, value }: { row: Pick<SettingRow, 'key' | 'secret'>; value: unknown }) {
  const { t, i18n } = useTranslation('admin');
  const shown = shownValue(row, value);
  switch (shown.kind) {
    case 'empty':
      return <span className="text-muted-foreground">{t('value.empty')}</span>;
    case 'secret':
      return <span>{t(shown.set ? 'value.set' : 'value.notSet')}</span>;
    case 'flag':
      return <span>{t(shown.on ? 'value.on' : 'value.off')}</span>;
    case 'number':
      return (
        <span className="tabular-nums">
          {shown.amount.toLocaleString(i18n.language)}
          {shown.unit ? ` ${t(`units.${shown.unit}`)}` : ''}
        </span>
      );
    case 'list':
      return <span className="break-words">{shown.items.join(', ')}</span>;
    default:
      return <span className="break-all">{shown.text}</span>;
  }
}

const CRITICALITY_VARIANT = {
  C1: 'destructive',
  C2: 'warning',
  C3: 'default',
  C4: 'muted',
} as const;

/** One setting: name, value and source, badges, problems, its control, its help (§3.7). */
export function SettingDetail({
  row,
  access,
  editor,
  history = false,
  wizard = false,
}: { row: SettingRow; history?: boolean; wizard?: boolean } & Parts) {
  const { t } = useTranslation('admin');
  const def = definitionOf(row.key);
  const reason = readOnlyReason(row, access, wizard);
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h3 className="font-semibold">{t(`labels.${row.key}`, { defaultValue: row.key })}</h3>
        <code className="text-muted-foreground text-xs">{row.key}</code>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="text-base font-medium">
          <Value row={row} value={row.value} />
        </span>
        <span className="text-muted-foreground">{t(`source.${row.source}`)}</span>
        {row.source === 'override' ? (
          <span className="text-muted-foreground">
            {t('settings.envValue')} <Value row={row} value={row.envValue} />
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant={CRITICALITY_VARIANT[row.criticality]}
          title={t(`criticality.${row.criticality}`)}
        >
          {row.criticality}
        </Badge>
        <Badge variant="muted">{t(`applies.${row.applies}`)}</Badge>
        {reason ? (
          <Badge variant="muted" className="gap-1">
            <Lock aria-hidden className="size-3" />
            {t(`readOnly.${reason}`)}
          </Badge>
        ) : null}
      </div>
      {row.issues.length ? (
        <Notice role="status">
          <ul className="flex flex-col gap-1">
            {row.issues.map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {editor && !reason ? editor(row, access) : null}
      {def ? <SettingHelp def={def} row={row} /> : null}
      {history ? <SettingHistory settingKey={row.key} /> : null}
    </>
  );
}

/** What it does, what it takes, when it applies, what goes with it (§3.7, help). */
function SettingHelp({ def, row }: { def: SettingDefinition; row: SettingRow }) {
  const { t } = useTranslation('admin');
  const doc = docLink(def.category);
  const related = RULES[def.key as keyof typeof RULES] ?? [];
  return (
    <div className="text-muted-foreground flex flex-col gap-2 text-sm">
      <p className="text-foreground">{def.description}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>{t('help.accepts')}</dt>
        <dd className="text-foreground">{def.accepts}</dd>
        <dt>{t('help.default')}</dt>
        <dd className="text-foreground">
          <Value row={row} value={row.default} />
        </dd>
        {def.example ? (
          <>
            <dt>{t('help.example')}</dt>
            <dd>
              <code className="text-xs">
                {def.key}={def.example}
              </code>
            </dd>
          </>
        ) : null}
        <dt>{t('help.applies')}</dt>
        <dd className="text-foreground">{t(`appliesHelp.${def.applies}`)}</dd>
        {related.length ? (
          <>
            <dt>{t('help.rules')}</dt>
            <dd className="text-foreground">{related.join(', ')}</dd>
          </>
        ) : null}
      </dl>
      {doc ? (
        <a
          href={doc}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          {t('help.doc')}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

/** Its last changes, from the audit. */
function SettingHistory({ settingKey }: { settingKey: string }) {
  const { t, i18n } = useTranslation('admin');
  const audit = useReadOperation<{ entries: AuditEntry[] }>('audit.list', {
    setting: settingKey,
    limit: 5,
  });
  const entries = audit.data?.data?.entries ?? [];
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium">{t('help.history')}</p>
      {audit.isLoading ? (
        <Spinner className="text-sm" />
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground">{t('help.noHistory')}</p>
      ) : (
        <ul className="text-muted-foreground flex flex-col gap-0.5">
          {entries.map((e) => (
            <li key={e.id}>
              {formatAgo(e.at, i18n.language)} · {e.actor} ·{' '}
              {t(`operations.${e.operation}`, { defaultValue: e.operation })}
              {e.params.value !== undefined ? (
                <>
                  {' → '}
                  <HistoryValue settingKey={settingKey} raw={String(e.params.value)} />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A value as the audit kept it (the raw text of `.env`), shown in the administration's units. */
function HistoryValue({ settingKey, raw }: { settingKey: string; raw: string }) {
  const parsed = definitionOf(settingKey)?.schema.safeParse(raw);
  return parsed?.success ? (
    <Value row={{ key: settingKey, secret: false }} value={parsed.data} />
  ) : (
    <span>{raw}</span>
  );
}

/** The variables read before or around the application (§1.8): shown, never changed here. */
function OutsideVariables() {
  const { t } = useTranslation('admin');
  const vars = DEPLOYMENT_VARIABLES.filter((v) => !v.internal);
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{t('outside.title')}</SectionTitle>
      <p className="text-muted-foreground text-sm">{t('outside.intro')}</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">{t('settings.columns.variable')}</th>
              <th className="px-3 py-2 font-medium">{t('outside.readBy')}</th>
              <th className="px-3 py-2 font-medium">{t('settings.columns.default')}</th>
              <th className="px-3 py-2 font-medium">{t('outside.what')}</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.key} className="border-t align-top">
                <td className="px-3 py-1.5">
                  <code className="text-xs">{v.key}</code>
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {t(`outside.readers.${v.readBy}`)}
                </td>
                <td className="px-3 py-1.5">{v.defaultText?.replace(/`/g, '') ?? '—'}</td>
                <td className="text-muted-foreground px-3 py-1.5">
                  {v.description.replace(/`/g, '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
