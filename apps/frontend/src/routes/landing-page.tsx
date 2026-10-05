import { BookOpen, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APP_NAME, APP_VERSION, appConfig, getDemo, isStandalone } from '../config';
import { docsLink, feedbackLinks, starLink } from '@/lib/feedback';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@tanstack/react-router';
import { JoinPin } from '@/components/join-pin';
import { useRole } from '../auth/use-role';
import { PageTitle } from '@/components/ui/page-title';
import { Notice } from '@/components/ui/notice';
import { useSetupControllerStatus } from '../api/generated/setup/setup';

export function LandingPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { isHost } = useRole();

  return (
    <section className="qd-home flex flex-col items-center gap-6 py-8 text-center">
      <PageTitle>{t('landing.title')}</PageTitle>
      <SetupInvite />
      <Card className="content-sm">
        <CardHeader>
          <CardTitle>{t('landing.joinTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <JoinPin />
        </CardContent>
      </Card>
      {/* A host lands here too: their way on, or the way in for one who is not signed in. */}
      {isHost ? (
        <Link to="/quizzes" className="text-primary text-sm font-medium">
          {t('landing.continueToQuizzes')} →
        </Link>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t('landing.hosting')}{' '}
          <Link to="/login" className="text-foreground underline">
            {t('landing.signIn')}
          </Link>
        </p>
      )}
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
 * language —, to star QuizDock on GitHub and to read its documentation. The
 * operator points it elsewhere,
 * or hides it, with `APP_FEEDBACK_URL`.
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
  const star = starLink(appConfig.feedbackUrl);
  const docs = docsLink(appConfig.feedbackUrl);
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
      {star ? (
        <p>
          {t('landing.feedback.star')}{' '}
          <a
            href={star}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
          >
            <Star aria-hidden className="size-3" />
            {t('landing.feedback.starLink')}
          </a>
        </p>
      ) : null}
      {docs ? (
        <a
          href={docs}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
        >
          <BookOpen aria-hidden className="size-3" />
          {t('landing.feedback.docs')}
        </a>
      ) : null}
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

/** A fresh instance: the way to its setup wizard (§3.8). */
function SetupInvite() {
  const { t } = useTranslation('admin');
  const { data } = useSetupControllerStatus({ query: { retry: false, staleTime: 60_000 } });
  if (!data?.data.open) return null;
  return (
    <Notice tone="info" className="content-sm text-left">
      {t('setup.invite')}{' '}
      <Link to="/setup" className="font-medium underline">
        {t('setup.inviteLink')}
      </Link>
    </Notice>
  );
}
