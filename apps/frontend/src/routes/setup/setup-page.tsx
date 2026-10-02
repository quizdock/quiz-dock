import { Link } from '@tanstack/react-router';
import { Check, ChevronLeft, ChevronRight, CircleCheck, KeyRound, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { Notice } from '@/components/ui/notice';
import { PageTitle } from '@/components/ui/page-title';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  setupControllerRun,
  setupControllerSession,
  useSetupControllerStatus,
} from '../../api/generated/setup/setup';
import { apiErrorText } from '../../api/http';
import { rememberAfterLogin } from '../../auth/auth-context';
import {
  type Answer,
  type OperationChannel,
  OperationChannelContext,
  type OperationDescriptor,
  useReadOperation,
  useRunOperation,
} from '../admin/admin-api';
import { OperationPanel, ReadPanel } from '../admin/operation-panel';
import { PresetsPanel } from '../admin/presets-panel';
import { SettingEditor } from '../admin/setting-editor';
import type { SettingsList } from '../admin/settings-model';
import { SettingDetail, Value } from '../admin/settings-page';

const SESSION_KEY = 'qd-setup-session';

function readSession(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The wizard's operations, through its session (§3.8). */
function setupChannel(session: string): OperationChannel {
  return {
    name: 'setup',
    run: async (id, params = {}, options = {}) => {
      const { data } = await setupControllerRun(
        id,
        { params, ...options },
        { headers: { 'X-Setup-Session': session } },
      );
      return data as Answer;
    },
  };
}

const STEPS = ['health', 'identity', 'address', 'access', 'limits', 'content', 'summary'] as const;
type Step = (typeof STEPS)[number];

/**
 * The first start of an instance (§3.8): the setup token, then each step over
 * the settings and operations — through the same runner as the
 * administration, validated and audited. What the container needs before it
 * starts (database, authentication mode, ports) is shown, never set here.
 */
export function SetupPage() {
  const { t } = useTranslation('admin');
  const status = useSetupControllerStatus({ query: { retry: false } });
  const [session, setSession] = useState(readSession);
  const channel = useMemo(() => setupChannel(session), [session]);
  const data = status.data?.data;

  if (status.isError) return <LoadFailed error={status.error} />;
  if (!data) return <Spinner label={t('loading')} showLabel className="text-sm" />;
  return (
    <div className="content-lg flex flex-col gap-6">
      <PageTitle>{t('setup.title')}</PageTitle>
      {!data.open ? (
        <Notice tone="info">
          {t('setup.closed')}{' '}
          <Link to="/" className="underline">
            {t('setup.home')}
          </Link>
        </Notice>
      ) : !data.signedIn ? (
        <Notice tone="info">
          {t('setup.signIn')}{' '}
          <Link to="/login" onClick={() => rememberAfterLogin('/setup')} className="underline">
            {t('setup.signInLink')}
          </Link>
        </Notice>
      ) : !session ? (
        <TokenStep
          onSession={(s) => {
            try {
              sessionStorage.setItem(SESSION_KEY, s);
            } catch {
              // storage blocked: the session lasts this page
            }
            setSession(s);
          }}
        />
      ) : (
        <OperationChannelContext.Provider value={channel}>
          <Wizard
            authMode={data.authMode}
            onLost={() => {
              try {
                sessionStorage.removeItem(SESSION_KEY);
              } catch {
                // nothing kept
              }
              setSession('');
            }}
          />
        </OperationChannelContext.Provider>
      )}
    </div>
  );
}

function TokenStep({ onSession }: { onSession: (session: string) => void }) {
  const { t } = useTranslation('admin');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await setupControllerSession({ token: token.trim() });
      onSession(data.session);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex max-w-xl flex-col gap-3 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound aria-hidden className="size-5" />
        {t('setup.token.title')}
      </h2>
      <p className="text-muted-foreground text-sm">{t('setup.token.help')}</p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
        <label htmlFor="setup-token" className="text-sm font-medium">
          {t('setup.token.label')}
        </label>
        <div className="flex gap-2">
          <Input
            id="setup-token"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button type="submit" disabled={busy || !token.trim()}>
            {t('setup.token.open')}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function Wizard({ authMode, onLost }: { authMode: 'none' | 'oidc'; onLost: () => void }) {
  const { t } = useTranslation('admin');
  const [step, setStep] = useState<Step>('health');
  const [finished, setFinished] = useState(false);
  const list = useReadOperation<SettingsList>('settings.list');
  const at = STEPS.indexOf(step);
  // A session that ended (expired, the setup completed elsewhere): back to the token.
  useEffect(() => {
    const code = (list.error as { data?: { code?: string } } | null)?.data?.code;
    if (code === 'setup.session_invalid') onLost();
  }, [list.error, onLost]);

  if (finished) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <p className="flex items-center gap-2 font-semibold">
          <CircleCheck aria-hidden className="text-success size-5" />
          {t('setup.finished')}
        </p>
        <p className="text-muted-foreground text-sm">{t('setup.finishedHelp')}</p>
        <Link to="/login" className="underline">
          {t('setup.signInLink')}
        </Link>
      </Card>
    );
  }
  if (list.isError) return <LoadFailed error={list.error} />;
  if (!list.data?.data) return <Spinner label={t('loading')} showLabel className="text-sm" />;
  const data = list.data.data;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label={t('setup.steps')}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(s)}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1',
                s === step
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'hover:bg-accent',
              )}
            >
              {i < at ? (
                <Check aria-hidden className="size-3.5" />
              ) : (
                <span className="tabular-nums">{i + 1}</span>
              )}
              {t(`setup.step.${s}.title`)}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground text-sm">{t(`setup.step.${step}.help`)}</p>
      {step === 'health' ? (
        <HealthStep />
      ) : step === 'identity' ? (
        <Settings data={data} keys={['APP_NAME', 'APP_LANG', 'APP_LOGO_URL', 'APP_FEEDBACK_URL']} />
      ) : step === 'address' ? (
        <AddressStep data={data} />
      ) : step === 'access' ? (
        <AccessStep data={data} authMode={authMode} />
      ) : step === 'limits' ? (
        <div className="flex flex-col gap-4">
          <PresetsPanel access={data.access} wizard />
          <Settings
            data={data}
            keys={data.rows
              .filter((r) => (r.category === 'limits' || r.category === 'pace') && r.overridable)
              .map((r) => r.key)}
          />
        </div>
      ) : step === 'content' ? (
        <ContentStep />
      ) : (
        <SummaryStep data={data} onFinished={() => setFinished(true)} />
      )}
      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={at === 0}
          onClick={() => setStep(STEPS[at - 1])}
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('setup.previous')}
        </Button>
        {at < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep(STEPS[at + 1])}>
            {t('setup.next')}
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Some settings, as cards (the administration's cards view), editable whatever the scope. */
function Settings({ data, keys }: { data: SettingsList; keys: string[] }) {
  const rows = data.rows.filter((r) => keys.includes(r.key));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <Card key={row.key} className="flex flex-col gap-3 p-4">
          <SettingDetail
            row={row}
            access={data.access}
            wizard
            editor={(r, access) => (
              <SettingEditor key={`${r.key}:${JSON.stringify(r.value)}`} row={r} access={access} />
            )}
          />
        </Card>
      ))}
    </div>
  );
}

function HealthStep() {
  const { t } = useTranslation('admin');
  return <ReadPanel id="health.doctor" title={t('operations.health.doctor')} />;
}

function AddressStep({ data }: { data: SettingsList }) {
  return (
    <div className="flex flex-col gap-4">
      <Settings data={data} keys={['APP_PUBLIC_URL', 'HOST_LAN_IPS']} />
      <PhoneTests data={data} />
    </div>
  );
}

/**
 * The phone test of every candidate invitation address (§3.8): in the wizard,
 * and again from the administration — a new network, a new venue.
 */
export function PhoneTests({ data }: { data: SettingsList }) {
  const { t } = useTranslation('admin');
  const publicUrl = data.rows.find((r) => r.key === 'APP_PUBLIC_URL')?.value;
  const lan =
    (data.rows.find((r) => r.key === 'HOST_LAN_IPS')?.value as string[] | undefined) ?? [];
  const port = window.location.port ? `:${window.location.port}` : '';
  const candidates = [
    ...new Set(
      [
        typeof publicUrl === 'string' && publicUrl ? publicUrl : null,
        ...lan.map((ip) => `${window.location.protocol}//${ip}${port}`),
        window.location.origin,
      ].filter((x): x is string => !!x),
    ),
  ];
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 font-semibold">
        <Smartphone aria-hidden className="size-5" />
        {t('setup.phone.title')}
      </h2>
      <p className="text-muted-foreground text-sm">{t('setup.phone.help')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {candidates.map((address) => (
          <PhoneTest key={address} address={address} />
        ))}
      </div>
      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">{t('setup.phone.why.title')}</summary>
        <ul className="text-muted-foreground mt-2 flex list-disc flex-col gap-1 pl-5">
          {(['network', 'isolation', 'firewall', 'public', 'docker'] as const).map((k) => (
            <li key={k}>{t(`setup.phone.why.${k}`)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** One candidate address: a QR code to a page only a phone reaching it can open (§3.8). */
function PhoneTest({ address }: { address: string }) {
  const { t } = useTranslation('admin');
  const run = useRunOperation();
  const [test, setTest] = useState<{ id: string; url: string } | null>(null);
  const [reached, setReached] = useState<{ agent: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!test || reached) return;
    const timer = setInterval(() => {
      void run('invite.test-status', { id: test.id })
        .then((a) => {
          const r =
            a.kind === 'result'
              ? (a.result.data as { reached: { agent: string } | null }).reached
              : null;
          if (r) setReached(r);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [test, reached, run]);
  const start = async () => {
    setError(null);
    setReached(null);
    try {
      const a = await run('invite.test', { address });
      if (a.kind === 'result') setTest(a.result.data as { id: string; url: string });
    } catch (err) {
      setError(apiErrorText(err));
    }
  };
  return (
    <Card className="flex flex-col items-start gap-2 p-4">
      <code className="text-sm break-all">{address}</code>
      {test ? (
        reached ? (
          <p role="status" className="text-success flex items-center gap-2 text-sm font-medium">
            <CircleCheck aria-hidden className="size-4" />
            {t('setup.phone.reached', { agent: reached.agent })}
          </p>
        ) : (
          <>
            <QRCodeSVG value={test.url} size={160} marginSize={2} className="bg-white" />
            <p className="text-muted-foreground text-xs">{t('setup.phone.scan')}</p>
          </>
        )
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={() => void start()}>
        {t(test ? 'setup.phone.again' : 'setup.phone.start')}
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </Card>
  );
}

function AccessStep({ data, authMode }: { data: SettingsList; authMode: 'none' | 'oidc' }) {
  const { t } = useTranslation('admin');
  const auth = data.rows.find((r) => r.key === 'AUTH_MODE');
  return (
    <div className="flex flex-col gap-4">
      {auth ? (
        <Card className="flex flex-col gap-3 p-4">
          <SettingDetail row={auth} access={data.access} />
        </Card>
      ) : null}
      {authMode === 'oidc' ? (
        <>
          <Settings data={data} keys={['ALLOW_ANONYMOUS_PARTICIPANTS']} />
          <Notice tone="info">{t('setup.access.oidcAdmin')}</Notice>
        </>
      ) : (
        <FirstAdmin />
      )}
    </div>
  );
}

const FIRST_ADMIN: OperationDescriptor = {
  id: 'setup.first-admin',
  domain: 'instance',
  category: 'setup',
  effect: 'write',
  summary: '',
  params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  dryRun: false,
  reachable: true,
};

function FirstAdmin() {
  const { t } = useTranslation('admin');
  return <OperationPanel descriptor={FIRST_ADMIN} intro={t('setup.access.firstAdmin')} />;
}

const SAMPLES: OperationDescriptor = {
  id: 'samples.load',
  domain: 'quizzes',
  category: 'quizzes',
  effect: 'write',
  summary: '',
  params: { type: 'object', properties: { user: { type: 'string' } }, required: ['user'] },
  dryRun: false,
  reachable: true,
};

function ContentStep() {
  const { t } = useTranslation('admin');
  return <OperationPanel descriptor={SAMPLES} intro={t('setup.content.samples')} />;
}

function SummaryStep({ data, onFinished }: { data: SettingsList; onFinished: () => void }) {
  const { t } = useTranslation('admin');
  const run = useRunOperation();
  const [env, setEnv] = useState('');
  const [error, setError] = useState<string | null>(null);
  const changed = data.rows.filter((r) => r.source !== 'default');
  useEffect(() => {
    void run('settings.export')
      .then((a) => a.kind === 'result' && setEnv((a.result.data as { env: string }).env))
      .catch(() => undefined);
  }, [run]);
  const finish = async () => {
    setError(null);
    try {
      await run('setup.complete');
      onFinished();
    } catch (err) {
      setError(apiErrorText(err));
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <SummaryTable title={t('setup.summary.set')} rows={changed} />
      {env ? (
        <label className="flex flex-col gap-1 text-sm">
          {t('setup.summary.env')}
          <Textarea
            readOnly
            value={env}
            rows={Math.min(12, env.split('\n').length + 1)}
            className="font-mono text-xs"
          />
        </label>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" variant="main-action" onClick={() => void finish()}>
          {t('setup.finish')}
        </Button>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>
    </div>
  );
}

function SummaryTable({ title, rows }: { title: ReactNode; rows: SettingsList['rows'] }) {
  const { t } = useTranslation('admin');
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t first:border-t-0">
                <td className="px-3 py-1.5">{t(`labels.${r.key}`, { defaultValue: r.key })}</td>
                <td className="px-3 py-1.5">
                  <Value row={r} value={r.value} />
                </td>
                <td className="text-muted-foreground px-3 py-1.5">{t(`source.${r.source}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
