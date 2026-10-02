import { Link } from '@tanstack/react-router';
import { Check, ChevronLeft, ChevronRight, CircleCheck, KeyRound, RefreshCw } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneTests } from '../admin/phone-tests';
import { DoctorChecks, groupChecks, isBlocking } from '../admin/admin-health-page';
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
import { OperationPanel } from '../admin/operation-panel';
import { UsageStep } from './usage-step';
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
    scope: `setup:${session}`,
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

const STEPS = [
  'usage',
  'health',
  'identity',
  'address',
  'access',
  'limits',
  'content',
  'summary',
] as const;
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

  if (status.isError && !data) return <LoadFailed error={status.error} />;
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
  const [step, setStep] = useState<Step>('usage');
  const [finished, setFinished] = useState(false);
  const list = useReadOperation('settings.list');
  const doctor = useReadOperation('health.doctor');
  const groups = doctor.data?.data ? groupChecks(doctor.data.data.output) : null;
  // A blocking problem stops the wizard at its health step (§3.8).
  const blocked = isBlocking(groups);
  const healthAt = STEPS.indexOf('health');
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
  if (list.isError && !list.data) return <LoadFailed error={list.error} />;
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
              disabled={blocked && i > healthAt}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1',
                s === step
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent',
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
      {/* The step's own heading: a step change is announced, not only seen. */}
      <h2 className="text-lg font-semibold">{t(`setup.step.${step}.title`)}</h2>
      <p className="text-muted-foreground text-sm">{t(`setup.step.${step}.help`)}</p>
      {step === 'usage' ? (
        <UsageStep />
      ) : step === 'health' ? (
        <HealthStep groups={groups} blocked={blocked} onAgain={() => void doctor.refetch()} />
      ) : step === 'identity' ? (
        <Settings data={data} keys={['APP_NAME', 'APP_LANG', 'APP_LOGO_URL', 'APP_FEEDBACK_URL']} />
      ) : step === 'address' ? (
        <AddressStep data={data} />
      ) : step === 'access' ? (
        <AccessStep data={data} authMode={authMode} />
      ) : step === 'limits' ? (
        <div className="flex flex-col gap-4">
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
          <Button
            type="button"
            disabled={blocked && at >= healthAt}
            onClick={() => setStep(STEPS[at + 1])}
          >
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
            editor={(r, access) => <SettingEditor key={r.key} row={r} access={access} />}
          />
        </Card>
      ))}
    </div>
  );
}

function HealthStep({
  groups,
  blocked,
  onAgain,
}: {
  groups: ReturnType<typeof groupChecks> | null;
  blocked: boolean;
  onAgain: () => void;
}) {
  const { t } = useTranslation('admin');
  if (!groups) return <Spinner label={t('loading')} showLabel className="text-sm" />;
  return (
    <div className="flex flex-col gap-3">
      {blocked ? <Notice>{t('setup.blocked')}</Notice> : null}
      <DoctorChecks groups={groups} />
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onAgain}>
        <RefreshCw aria-hidden className="size-4" />
        {t('health.again')}
      </Button>
    </div>
  );
}

function AddressStep({ data }: { data: SettingsList }) {
  return (
    <div className="flex flex-col gap-4">
      <Settings data={data} keys={['APP_PUBLIC_URL', 'HOST_LAN_IPS']} />
      <PhoneTests data={data} />
    </div>
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
