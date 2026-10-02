import type { AccountItem, AccountsPage } from '@quiz-dock/contracts';
import { Armchair, EllipsisVertical, Search, ShieldCheck, Users } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StaleNotice } from '@/components/ui/stale-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterField } from '@/components/ui/filter-field';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { MenuItem } from '@/components/ui/menu-item';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { Popover } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { formatAgo } from '@/lib/format';
import { useDebounced } from '@/lib/use-debounced';
import { useCatalogue, useReadOperation } from './admin-api';
import { useOperationAction } from './use-operation-action';

type Role = 'host' | 'admin';

type Account = AccountItem;
type AccountsData = AccountsPage;

const PAGE = 25;

/**
 * The accounts of the instance (§0.1, Instance domain): searched, filtered by
 * role, each with its roles, its quizzes, its games; granting or revoking a
 * role from its row. In local mode, who holds the host seat, above them.
 */
export function AccountsPage() {
  const { t, i18n } = useTranslation('admin');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const sought = useDebounced(q.trim());
  const read = useReadOperation('users.search', {
    ...(sought ? { q: sought } : {}),
    ...(role ? { role } : {}),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const data = read.data?.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));
  useEffect(() => {
    if (data && page > pages) setPage(pages);
  }, [data, page, pages]);

  return (
    <div className="flex flex-col gap-4">
      {data?.localMode ? <SeatCard seat={data.seat} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">{t('accounts.search')}</span>
          <Search
            aria-hidden
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={q}
            placeholder={t('accounts.search')}
            onChange={(e) => (setQ(e.target.value), setPage(1))}
            className="pl-8"
          />
        </label>
        <FilterField label={t('accounts.role')}>
          <Select value={role} onChange={(e) => (setRole(e.target.value), setPage(1))}>
            <option value="">{t('accounts.anyRole')}</option>
            {(['admin', 'host', 'player'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`accounts.roles.${r}`)}
              </option>
            ))}
          </Select>
        </FilterField>
      </div>

      {read.isError && data ? <StaleNotice onRetry={() => void read.refetch()} /> : null}
      {read.isError && !data ? (
        <LoadFailed error={read.error} />
      ) : !data ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : data.items.length === 0 ? (
        <EmptyState icon={Users}>{t('accounts.none')}</EmptyState>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t('accounts.count', { count: data.total })}
          </p>
          <DataTable columns={accountColumns(t, i18n.language)} data={data.items} />
        </>
      )}
      <Pagination page={page} pages={pages} onChange={setPage} />
    </div>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;

/** The accounts' columns: a page of a server-side search, so none sorts. */
function accountColumns(t: T, locale: string): DataColumn<Account>[] {
  return [
    {
      id: 'account',
      header: t('accounts.columns.account'),
      enableSorting: false,
      cell: ({ row: { original: account } }) => (
        <>
          <div className="font-medium">{account.name}</div>
          <div className="text-muted-foreground text-xs">
            {account.email ?? account.subject}
            {account.email ? <span className="block">{account.subject}</span> : null}
          </div>
        </>
      ),
    },
    {
      id: 'roles',
      header: t('accounts.columns.roles'),
      enableSorting: false,
      cell: ({ row: { original: account } }) => {
        const roles = (['admin', 'host'] as const).filter((r) => account.roles.includes(r));
        return (
          <div className="flex flex-wrap gap-1">
            {roles.length === 0 ? (
              <Badge variant="muted">{t('accounts.roles.player')}</Badge>
            ) : (
              roles.map((r) => (
                <Badge
                  key={r}
                  variant={r === 'admin' ? 'warning' : 'default'}
                  title={account.granted.includes(r) ? t('accounts.grantedHere') : undefined}
                >
                  {t(`accounts.roles.${r}`)}
                </Badge>
              ))
            )}
          </div>
        );
      },
    },
    {
      id: 'quizzes',
      header: t('accounts.columns.quizzes'),
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => row.original.quizzes.toLocaleString(locale),
    },
    {
      id: 'games',
      header: t('accounts.columns.games'),
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => row.original.games.toLocaleString(locale),
    },
    {
      id: 'created',
      header: t('accounts.columns.created'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap" title={row.original.createdAt}>
          {formatAgo(row.original.createdAt, locale)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{t('accounts.columns.actions')}</span>,
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => <AccountActions account={row.original} />,
    },
  ];
}

/** Whether the web may run an operation here, and if not, why. */
function useReachable(id: string): { reachable: boolean; why?: string } {
  const { t } = useTranslation('admin');
  const descriptor = useCatalogue().data?.find((d) => d.id === id);
  if (!descriptor) return { reachable: false };
  return descriptor.reachable
    ? { reachable: true }
    : { reachable: false, why: t(`refusals.${descriptor.refusal ?? 'forbidden'}`) };
}

function AccountActions({ account }: { account: Account }) {
  const { t } = useTranslation('admin');
  const [editing, setEditing] = useState(false);
  const setRole = useReachable('users.set-role');
  const action = useOperationAction();
  return (
    <>
      <Popover
        align="end"
        className="w-64 p-1"
        trigger={({ open, toggle }) => (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('accounts.actionsFor', { name: account.name })}
            aria-expanded={open}
            onClick={toggle}
          >
            <EllipsisVertical aria-hidden className="size-4" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              disabled={!setRole.reachable}
              onClick={() => (close(), action.clearError(), setEditing(true))}
            >
              <ShieldCheck aria-hidden className="size-4" />
              {t('accounts.editRoles')}
            </MenuItem>
            {setRole.why ? (
              <p className="text-muted-foreground px-2 pb-1.5 text-xs">{setRole.why}</p>
            ) : null}
          </>
        )}
      </Popover>
      {editing ? (
        <RolesDialog
          account={account}
          busy={action.busy}
          error={action.error}
          onClose={() => setEditing(false)}
          onSave={async (roles) => {
            const done = await action.act(
              'users.set-role',
              { user: account.subject, roles },
              { title: account.name, confirmLabel: t('accounts.save') },
            );
            if (done) setEditing(false);
          }}
        />
      ) : null}
      {action.confirmDialog}
    </>
  );
}

/**
 * The roles an administrator grants an account. The identity provider's own
 * roles stay whatever is ticked here: this changes only the grant. A refusal
 * is said here, where the person looks; the dialog closes once it is saved.
 */
function RolesDialog({
  account,
  busy,
  error,
  onClose,
  onSave,
}: {
  account: Account;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (roles: string) => Promise<void>;
}) {
  const { t } = useTranslation('admin');
  const titleId = useId();
  const [granted, setGranted] = useState<Set<Role>>(
    new Set(account.granted.filter((r): r is Role => r === 'host' || r === 'admin')),
  );
  const toggle = (role: Role, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (on) next.add(role);
      else next.delete(role);
      return next;
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const roles = (['host', 'admin'] as const).filter((r) => granted.has(r)).join(',');
    void onSave(roles || 'player');
  };
  return (
    <Modal onClose={onClose} className="w-full max-w-md" aria-labelledby={titleId}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-6 text-left">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('accounts.rolesTitle', { name: account.name })}
        </h2>
        <p className="text-muted-foreground text-sm">{t('accounts.rolesHelp')}</p>
        <div className="flex flex-col gap-2">
          {(['host', 'admin'] as const).map((r) => (
            <CheckboxField
              key={r}
              checked={granted.has(r)}
              onChange={(on) => toggle(r, on)}
              label={t(`accounts.roles.${r}`)}
              hint={t(`accounts.rolesHint.${r}`)}
            />
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('accounts.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('accounts.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Local mode: who holds the single host seat, and freeing it. */
function SeatCard({ seat }: { seat: AccountsData['seat'] }) {
  const { t, i18n } = useTranslation('admin');
  const release = useReachable('seat.release');
  const action = useOperationAction();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <span className="bg-muted flex size-10 items-center justify-center rounded-full">
          <Armchair aria-hidden className="text-muted-foreground size-5" />
        </span>
        <div className="flex flex-col">
          <span className="font-medium">{t('accounts.seat.title')}</span>
          <span className="text-muted-foreground text-sm">
            {seat
              ? t('accounts.seat.held', {
                  name: seat.holder,
                  since: formatAgo(seat.since, i18n.language),
                })
              : t('accounts.seat.free')}
          </span>
        </div>
      </div>
      {seat ? (
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!release.reachable || action.busy}
            onClick={() =>
              void action.act(
                'seat.release',
                {},
                {
                  title: t('accounts.seat.release'),
                  confirmLabel: t('accounts.seat.release'),
                  destructive: true,
                },
              )
            }
          >
            {t('accounts.seat.release')}
          </Button>
          {/* The reason in words, not only in a tooltip. */}
          {release.why ? <p className="text-muted-foreground text-xs">{release.why}</p> : null}
          {action.error ? (
            <p role="alert" className="text-destructive text-xs">
              {action.error}
            </p>
          ) : null}
        </div>
      ) : null}
      {action.confirmDialog}
    </div>
  );
}
