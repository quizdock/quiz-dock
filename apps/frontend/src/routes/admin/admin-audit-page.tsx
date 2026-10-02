import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StaleNotice } from '@/components/ui/stale-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterField } from '@/components/ui/filter-field';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { Select } from '@/components/ui/select';
import { formatAgo } from '@/lib/format';
import { type AuditEntry, useCatalogue, useReadOperation } from './admin-api';

const PAGE = 50;

const OUTCOME_TONE = {
  done: 'success',
  'nothing-to-do': 'muted',
  partial: 'warning',
  refused: 'destructive',
  failed: 'destructive',
} as const;

/** A parameter's value on one line: text as is, the rest as JSON, long ones cut. */
const shown = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/**
 * The audit log (§3.3, step 7): who did what, through what, when, and how it
 * ended — filtered by operation, a page at a time, newest first. Parameters
 * read as `name value`; what a change replaced (`before`) is folded.
 */
export function AuditPage() {
  const { t, i18n } = useTranslation('admin');
  const catalogue = useCatalogue();
  const [operation, setOperation] = useState('');
  const [before, setBefore] = useState<string[]>([]);
  const audit = useReadOperation('audit.list', {
    limit: PAGE,
    ...(operation ? { operation } : {}),
    ...(before.length ? { before: before[before.length - 1] } : {}),
  });
  const entries = audit.data?.data?.entries ?? [];
  // Reads are never audited: only what changes, or was refused, is offered.
  const operations = (catalogue.data ?? []).filter((d) => d.effect !== 'read');
  const label = (id: string) => t(`operations.${id}`, { defaultValue: id });

  return (
    <div className="flex flex-col gap-4">
      <FilterField label={t('audit.filter')}>
        <Select
          className="w-full sm:w-72"
          value={operation}
          onChange={(e) => (setOperation(e.target.value), setBefore([]))}
        >
          <option value="">{t('audit.anyOperation')}</option>
          {operations.map((d) => (
            <option key={d.id} value={d.id}>
              {label(d.id)}
            </option>
          ))}
        </Select>
      </FilterField>
      {audit.isError && audit.data ? <StaleNotice onRetry={() => void audit.refetch()} /> : null}
      {audit.isError && !audit.data ? (
        <LoadFailed error={audit.error} />
      ) : !audit.data ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText}>{t('audit.empty')}</EmptyState>
      ) : (
        <DataTable columns={auditColumns(t, i18n.language, label)} data={entries} />
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!before.length}
          onClick={() => setBefore((b) => b.slice(0, -1))}
        >
          {t('audit.newer')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={entries.length < PAGE}
          onClick={() => setBefore((b) => [...b, entries[entries.length - 1].id])}
        >
          {t('audit.older')}
        </Button>
      </div>
    </div>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;

/** The audit's columns: a page of the log, newest first from the server, so none sorts. */
function auditColumns(
  t: T,
  locale: string,
  label: (id: string) => string,
): DataColumn<AuditEntry>[] {
  return [
    {
      id: 'at',
      header: t('audit.columns.at'),
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <span className="whitespace-nowrap" title={e.at}>
          {formatAgo(e.at, locale)}
        </span>
      ),
    },
    {
      id: 'who',
      header: t('audit.columns.who'),
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <>
          {e.actor}
          <span className="text-muted-foreground block text-xs">
            {t(`audit.via.${e.via}`)}
            {e.address ? ` · ${e.address}` : ''}
          </span>
        </>
      ),
    },
    {
      id: 'operation',
      header: t('audit.columns.operation'),
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <>
          {label(e.operation)}
          <code className="text-muted-foreground block text-xs">{e.operation}</code>
        </>
      ),
    },
    {
      id: 'params',
      header: t('audit.columns.params'),
      enableSorting: false,
      cell: ({ row: { original: e } }) => <Params params={e.params} />,
    },
    {
      id: 'outcome',
      header: t('audit.columns.outcome'),
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <>
          <Badge variant={OUTCOME_TONE[e.outcome]}>{t(`audit.outcomes.${e.outcome}`)}</Badge>
          {e.code ? (
            <span className="text-muted-foreground mt-1 block max-w-48 text-xs">
              {t(`refusals.${e.code}`, { defaultValue: e.code })}
            </span>
          ) : null}
        </>
      ),
    },
  ];
}

/** Parameters read by name; what a change replaced (`before`), folded. */
function Params({ params: all }: { params: Record<string, unknown> }) {
  const { t } = useTranslation('admin');
  const { before: previous, ...params } = all;
  const pairs = Object.entries(params);
  if (pairs.length === 0 && previous === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {pairs.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
          {pairs.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="font-mono break-all">{shown(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {previous !== undefined ? (
        <details className="mt-1 text-xs">
          <summary className="text-muted-foreground cursor-pointer">{t('audit.previous')}</summary>
          <pre className="bg-muted mt-1 max-w-md overflow-x-auto rounded p-2 whitespace-pre-wrap">
            {JSON.stringify(previous, null, 2)}
          </pre>
        </details>
      ) : null}
    </>
  );
}
