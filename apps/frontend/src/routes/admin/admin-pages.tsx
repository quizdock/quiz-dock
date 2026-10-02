import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { SectionTitle } from '@/components/ui/page-title';
import { formatAgo } from '@/lib/format';
import { type AuditEntry, useCatalogue, useReadOperation } from './admin-api';
import { OperationPanel, ReadPanel } from './operation-panel';
import type { SettingsList } from './settings-model';
import { PhoneTests } from '../setup/setup-page';

/** Panels for some operations of the catalogue, in this order. */
function Operations({ ids }: { ids: string[] }) {
  const catalogue = useCatalogue();
  if (catalogue.isError) return <LoadFailed error={catalogue.error} />;
  if (!catalogue.data) return <Spinner className="text-sm" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {ids.map((id) => {
        const descriptor = catalogue.data.find((d) => d.id === id);
        return descriptor ? <OperationPanel key={id} descriptor={descriptor} /> : null;
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** The instance's health: the doctor's checks, the migrations, the invitation addresses from a phone. */
export function HealthPage() {
  const { t } = useTranslation('admin');
  const list = useReadOperation<SettingsList>('settings.list');
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadPanel id="health.doctor" title={t('operations.health.doctor')} />
        <ReadPanel id="migrations.status" title={t('operations.migrations.status')} />
      </div>
      {list.data?.data ? <PhoneTests data={list.data.data} /> : null}
    </div>
  );
}

/** Accounts and roles, the local mode's host seat. */
export function AccountsPage() {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-6">
      <ReadPanel id="users.list" title={t('operations.users.list')} />
      <Section title={t('sections.changes')}>
        <Operations ids={['users.set-role', 'seat.status', 'seat.release']} />
      </Section>
    </div>
  );
}

const PAGE = 50;

/** The audit log (§3.3, step 7): who did what, through what, when, and how it ended. */
export function AuditPage() {
  const { t, i18n } = useTranslation('admin');
  const [operation, setOperation] = useState('');
  const [before, setBefore] = useState<string[]>([]);
  const params = {
    limit: PAGE,
    ...(operation.trim() ? { operation: operation.trim() } : {}),
    ...(before.length ? { before: before[before.length - 1] } : {}),
  };
  const audit = useReadOperation<{ entries: AuditEntry[] }>('audit.list', params);
  const entries = audit.data?.data?.entries ?? [];
  return (
    <div className="flex flex-col gap-4">
      <label className="flex max-w-sm flex-col gap-1 text-sm">
        {t('audit.filter')}
        <Input
          value={operation}
          placeholder="users.set-role"
          onChange={(e) => {
            setOperation(e.target.value);
            setBefore([]);
          }}
        />
      </label>
      {audit.isError ? (
        <LoadFailed error={audit.error} />
      ) : audit.isLoading ? (
        <Spinner className="text-sm" />
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('audit.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">{t('audit.columns.at')}</th>
                <th className="px-3 py-2 font-medium">{t('audit.columns.who')}</th>
                <th className="px-3 py-2 font-medium">{t('audit.columns.operation')}</th>
                <th className="px-3 py-2 font-medium">{t('audit.columns.params')}</th>
                <th className="px-3 py-2 font-medium">{t('audit.columns.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <td className="px-3 py-1.5 whitespace-nowrap" title={e.at}>
                    {formatAgo(e.at, i18n.language)}
                  </td>
                  <td className="px-3 py-1.5">
                    {e.actor}
                    <span className="text-muted-foreground block text-xs">
                      {t(`audit.via.${e.via}`)}
                      {e.address ? ` · ${e.address}` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {t(`operations.${e.operation}`, { defaultValue: e.operation })}
                    <code className="text-muted-foreground block text-xs">{e.operation}</code>
                  </td>
                  <td className="px-3 py-1.5">
                    <code className="text-xs break-all">{JSON.stringify(e.params)}</code>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {t(`audit.outcomes.${e.outcome}`)}
                    {e.code ? (
                      <span className="text-muted-foreground block text-xs">
                        {t(`refusals.${e.code}`, { defaultValue: e.code })}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
