import { CircleCheck, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsList } from '@quiz-dock/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiErrorText } from '../../api/http';
import { useRunOperation } from './admin-api';

/** How long the server keeps a phone test (PHONE_TEST_TTL_S). */
const PHONE_TEST_MS = 10 * 60_000;

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
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!test || reached) return;
    const started = Date.now();
    const timer = setInterval(() => {
      // As long as the test lives on the server, and while the page is looked at.
      if (Date.now() - started > PHONE_TEST_MS) {
        clearInterval(timer);
        setExpired(true);
        return;
      }
      if (document.hidden) return;
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
    setExpired(false);
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
        ) : expired ? (
          <p className="text-muted-foreground text-sm">{t('setup.phone.expired')}</p>
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
