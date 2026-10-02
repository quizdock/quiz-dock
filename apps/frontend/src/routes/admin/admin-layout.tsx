import { Link, Outlet } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { PageTitle } from '@/components/ui/page-title';
import { cn } from '@/lib/utils';
import { useRole } from '../../auth/use-role';
import { setAdminToken, useAdminToken, useReadOperation } from './admin-api';
import type { SettingsList } from './settings-model';

/** The administration's sections, by domain (§0.1). */
const SECTIONS = [
  {
    domain: 'instance',
    links: [
      { to: '/admin/settings', key: 'settings' },
      { to: '/admin/health', key: 'health' },
      { to: '/admin/accounts', key: 'accounts' },
      { to: '/admin/audit', key: 'audit' },
    ],
  },
  { domain: 'quizzes', links: [{ to: '/admin/quizzes', key: 'quizzes' }] },
  { domain: 'media', links: [{ to: '/admin/media', key: 'media' }] },
] as const;

/** The administration: its sections, by domain, around the page shown. */
export function AdminLayout() {
  const { t } = useTranslation('admin');
  const { isManager, roles } = useRole();
  if (roles.length > 0 && !isManager) {
    return <p className="text-muted-foreground">{t('adminOnly')}</p>;
  }
  return (
    <div className="content-lg flex flex-col gap-6">
      <PageTitle>{t('title')}</PageTitle>
      <nav aria-label={t('title')} className="flex flex-wrap gap-x-6 gap-y-2 border-b pb-2">
        {SECTIONS.map((section) => (
          <div key={section.domain} className="flex items-center gap-1">
            <span className="text-muted-foreground mr-1 text-xs font-medium uppercase">
              {t(`domains.${section.domain}`)}
            </span>
            {section.links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn('hover:bg-accent rounded-md px-2.5 py-1 text-sm')}
                activeProps={{ className: 'bg-accent font-medium', 'aria-current': 'page' }}
              >
                {t(`sections.${link.key}`)}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <TokenPrompt />
      <Outlet />
    </div>
  );
}

/**
 * Local mode: no accounts, so the web changes nothing without the
 * administration token (§3.10). Asked once, kept for this tab.
 */
function TokenPrompt() {
  const { t } = useTranslation('admin');
  const token = useAdminToken();
  const list = useReadOperation<SettingsList>('settings.list');
  const [value, setValue] = useState('');
  const access = list.data?.data?.access;
  if (!access?.tokenRequired) return null;
  if (!access.tokenSet) return <Notice>{t('token.unset')}</Notice>;
  if (token) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <KeyRound aria-hidden className="size-4" />
        {t('token.given')}
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdminToken('')}>
          {t('token.forget')}
        </Button>
      </p>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAdminToken(value.trim());
    setValue('');
  };
  return (
    <Notice
      tone="info"
      icon={<KeyRound aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />}
    >
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="admin-token">{t('token.ask')}</label>
        <div className="flex gap-2">
          <Input
            id="admin-token"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" size="sm" disabled={!value.trim()}>
            {t('token.use')}
          </Button>
        </div>
      </form>
    </Notice>
  );
}
