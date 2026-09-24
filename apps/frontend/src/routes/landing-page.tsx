import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_NAME, APP_VERSION, appConfig, getDemo, isStandalone } from '../config';
import { feedbackLinks } from '@/lib/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function LandingPage() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const [pin, setPin] = useState('');

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    const code = pin.trim();
    if (code) void navigate({ to: '/join/$pin', params: { pin: code } });
  };

  return (
    <section className="flex flex-col items-center gap-6 py-8 text-center">
      <h1 className="text-3xl font-bold">{t('landing.title')}</h1>
      <Card className="content-sm">
        <CardHeader>
          <CardTitle>{t('landing.joinTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2" onSubmit={onJoin}>
            <Input
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              inputMode="numeric"
              placeholder={t('landing.pinPlaceholder')}
              maxLength={6}
              className="text-center text-lg tracking-[0.3em]"
            />
            <Button type="submit" disabled={!pin.trim()}>
              {t('landing.join')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <DemoLimits />

      <small className="text-muted-foreground">
        {t('landing.version', { name: APP_NAME, version: APP_VERSION })}
      </small>
      <Feedback />
    </section>
  );
}

/**
 * An invitation to report a bug, suggest a feature, fix a translation or ask
 * a question — as GitHub forms filled in with the version, browser and
 * language. The operator points it elsewhere, or hides it, with `APP_FEEDBACK_URL`.
 */
function Feedback() {
  const { t, i18n } = useTranslation('auth');
  const links = feedbackLinks(appConfig.feedbackUrl, {
    version: APP_VERSION,
    lang: i18n.language,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  });
  if (links.length === 0) return null;
  const single = links.length === 1;
  return (
    <nav
      aria-label={t('landing.feedback.label')}
      className="text-muted-foreground flex flex-col items-center gap-1 text-xs"
    >
      <span>{t('landing.feedback.intro')}</span>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {links.map((link) => (
          <li key={link.kind}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline underline-offset-2"
            >
              {single ? t('landing.feedback.other') : t(`landing.feedback.${link.kind}`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The project's own site. Hard-coded on purpose and shown **only** on a demo
 * instance: a white-labelled self-hosted instance (`APP_NAME`, `APP_LOGO_URL`)
 * never displays this block, so it never displays this link either.
 */
const PROJECT_URL = 'https://quizdock.github.io';

/**
 * What a public demo instance (`DEMO_MODE`) does **not** do. Someone trying the
 * product has to be able to tell a guard of this instance from a limit of the
 * product — hence the closing line. The banner in the header says it in one
 * sentence; this says it in full, once, where people land.
 */
function DemoLimits() {
  const { t } = useTranslation(['auth', 'common']);
  const demo = getDemo();
  if (!demo) return null;
  const limits = [
    t('landing.demoShared', { user: demo.user }),
    t('landing.demoMedia'),
    t('landing.demoReset'),
    t('landing.demoSamples'),
    // Only when the app knows it is the all-in-one image (QUIZDOCK_FLAVOR).
    ...(isStandalone() ? [t('landing.demoStandalone')] : []),
  ];
  return (
    <Card className="content-sm text-left">
      <CardHeader>
        <CardTitle>{t('landing.demoTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{t('landing.demoIntro')}</p>
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5">
          {limits.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="border-t pt-3">
          {t('landing.demoSelfHost')}{' '}
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            {t('landing.demoSelfHostLink')} →
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
