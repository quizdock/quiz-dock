import { Armchair, EllipsisVertical, Search, ShieldCheck, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { apiErrorText } from '../../api/http';
import {
  type Answer,
  useCatalogue,
  useReadOperation,
  useRefreshAdmin,
  useRunOperation,
} from './admin-api';

type Role = 'host' | 'admin';

interface Account {
  id: string;
  name: string;
  subject: string;
  email: string | null;
  roles: string[];
  granted: string[];
  quizzes: number;
  games: number;
  createdAt: string;
}

interface AccountsData {
  total: number;
  items: Account[];
  seat: { holder: string; subject: string; since: string; expiresAt: string | null } | null;
  localMode: boolean;
}

const PAGE = 25;

/**
 * The accounts of the instance (§0.1, Instance domain): searched, filtered by
 * role, each with its roles, its quizzes, its games; granting or revoking a
 * role from its row. In local mode, who holds the host seat, above them.
 */
export function AccountsPage() {
  const { t } = useTranslation('admin');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const read = useReadOperation<AccountsData>('users.search', {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(role ? { role } : {}),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const data = read.data?.data;

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

      {read.isError ? (
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
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('accounts.columns.account')}</th>
                  <th className="px-3 py-2 font-medium">{t('accounts.columns.roles')}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('accounts.columns.quizzes')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('accounts.columns.games')}
                  </th>
                  <th className="px-3 py-2 font-medium">{t('accounts.columns.created')}</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">{t('accounts.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((account) => (
                  <AccountRow key={account.id} account={account} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pages={Math.max(1, Math.ceil(data.total / PAGE))}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: Account }) {
  const { t, i18n } = useTranslation('admin');
  const roles = (['admin', 'host'] as const).filter((r) => account.roles.includes(r));
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{account.name}</div>
        <div className="text-muted-foreground text-xs">
          {account.email ?? account.subject}
          {account.email ? <span className="block">{account.subject}</span> : null}
        </div>
      </td>
      <td className="px-3 py-2">
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
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{account.quizzes}</td>
      <td className="px-3 py-2 text-right tabular-nums">{account.games}</td>
      <td className="px-3 py-2 whitespace-nowrap" title={account.createdAt}>
        {formatAgo(account.createdAt, i18n.language)}
      </td>
      <td className="px-3 py-2 text-right">
        <AccountActions account={account} />
      </td>
    </tr>
  );
}

/** Runs an operation from the page: asks its confirmation when it wants one. */
function useAct() {
  const run = useRunOperation();
  const refresh = useRefreshAdmin();
  const [confirm, setConfirm] = useState<{
    answer: Extract<Answer, { kind: 'confirm' }>;
    id: string;
    params: Record<string, unknown>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (id: string, params: Record<string, unknown>, confirmation?: string) => {
    setError(null);
    try {
      const answer = await run(id, params, { confirmation });
      if (answer.kind === 'confirm') setConfirm({ answer, id, params });
      else await refresh();
      return answer.kind === 'result';
    } catch (err) {
      setError(apiErrorText(err));
      return false;
    }
  };
  return { act, confirm, setConfirm, error };
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
  const { act, confirm, setConfirm, error } = useAct();
  return (
    <div className="flex flex-col items-end gap-1">
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
            <MenuItem disabled={!setRole.reachable} onClick={() => (close(), setEditing(true))}>
              <ShieldCheck aria-hidden className="size-4" />
              {t('accounts.editRoles')}
            </MenuItem>
            {setRole.why ? (
              <p className="text-muted-foreground px-2 pb-1.5 text-xs">{setRole.why}</p>
            ) : null}
          </>
        )}
      </Popover>
      {error ? (
        <p role="alert" className="text-destructive max-w-56 text-left text-xs">
          {error}
        </p>
      ) : null}
      {editing ? (
        <RolesDialog
          account={account}
          onClose={() => setEditing(false)}
          onSave={async (roles) => {
            if (await act('users.set-role', { user: account.subject, roles })) setEditing(false);
          }}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open
          title={account.name}
          description={confirm.answer.summary}
          confirmLabel={t('accounts.save')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            void act(pending.id, pending.params, pending.answer.token).then(
              (ok) => ok && setEditing(false),
            );
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The roles an administrator grants an account. The identity provider's own
 * roles stay whatever is ticked here: this changes only the grant.
 */
function RolesDialog({
  account,
  onClose,
  onSave,
}: {
  account: Account;
  onClose: () => void;
  onSave: (roles: string) => Promise<void>;
}) {
  const { t } = useTranslation('admin');
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
    <Modal onClose={onClose} className="w-full max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4 p-6 text-left">
        <h2 className="text-lg font-semibold">
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('accounts.cancel')}
          </Button>
          <Button type="submit">{t('accounts.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Local mode: who holds the single host seat, and freeing it. */
function SeatCard({ seat }: { seat: AccountsData['seat'] }) {
  const { t, i18n } = useTranslation('admin');
  const release = useReachable('seat.release');
  const { act, confirm, setConfirm, error } = useAct();
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
            disabled={!release.reachable}
            title={release.why}
            onClick={() => void act('seat.release', {})}
          >
            {t('accounts.seat.release')}
          </Button>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open
          destructive
          title={t('accounts.seat.release')}
          description={confirm.answer.summary}
          confirmLabel={t('accounts.seat.release')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            void act(pending.id, pending.params, pending.answer.token);
          }}
        />
      ) : null}
    </div>
  );
}
