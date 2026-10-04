import type { ParticipantAccess } from '@quiz-dock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { SeatCountdown, SeatMenuRow } from '@/components/seat-status';
import {
  getMeControllerGetPreferencesQueryKey,
  useMeControllerGetPreferences,
  useMeControllerMe,
  useMeControllerUpdatePreferences,
} from '../api/generated/me/me';
import { useAuth } from '../auth/auth-context';
import { languageName, resolveLang, supportedLngs } from '../i18n/languages';
import { APP_NAME, allowsAnonymousParticipants, getDemo } from '../config';
import { LoadFailed, PageLoading } from '@/components/ui/loading';
import { UserRound } from 'lucide-react';
import { PageTitle } from '@/components/ui/page-title';

/**
 * Le compte, vu par la personne à qui il appartient : qui elle est pour cette
 * instance, ce que son rôle l'autorise à faire, et — en mode local — l'état du
 * siège d'animateur. Le nom et le courriel viennent du fournisseur d'identité ou
 * du nom saisi, et le rôle est un octroi d'opérateur (RG-14) : la page dit d'où
 * vient chaque chose plutôt que de laisser croire qu'elle se change. Seules les
 * préférences du compte s'y règlent.
 */
export function ProfilePage() {
  const { t } = useTranslation(['auth', 'common']);
  /** Lecture d'une feuille : `t()` d'une clé à enfants est typé `string | objet`. */
  const s = (key: string, vars?: Record<string, string>) => String(t(key, vars ?? {}));
  const { mode, user } = useAuth();
  const { data, isPending, error, refetch } = useMeControllerMe({ query: { retry: false } });
  const me = data?.data;
  const roles = me ? (me.roles.length ? me.roles : ['player']) : [];

  return (
    <section className="content-md flex flex-col gap-6">
      <PageTitle>{s('profile.title')}</PageTitle>

      {isPending ? <PageLoading /> : null}
      {error ? <LoadFailed error={error} onRetry={() => void refetch()} /> : null}

      {me ? (
        <>
          {/* Who I am here and what I may do, in plain words; the identifiers fold. */}
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
                  <UserRound className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{me.displayName}</p>
                  <p className="text-muted-foreground text-xs">
                    {mode === 'oidc' ? t('profile.signedInProvider') : t('profile.signedInLocal')}
                  </p>
                </div>
                <span className="flex flex-wrap gap-2">
                  {roles.map((role) => (
                    <Badge key={role} variant={role === 'player' ? 'muted' : 'success'}>
                      {s(`profile.roles.${role}`)}
                    </Badge>
                  ))}
                </span>
              </div>
              {roles.map((role) => (
                <p key={role}>{s(`profile.roleHelp.${role}`)}</p>
              ))}
              <p className="text-muted-foreground text-xs">
                {mode === 'oidc' ? t('profile.fromProvider') : t('profile.fromLocalName')}{' '}
                {s('profile.roleGranted', { app: APP_NAME })}
              </p>
              <details className="text-xs">
                <summary className="text-muted-foreground cursor-pointer">
                  {s('profile.technical')}
                </summary>
                <div className="mt-2 flex flex-col gap-1">
                  <Field label={s('profile.email')} value={me.email ?? s('profile.noEmail')} />
                  {/* Le sujet est ce qu'un opérateur tape dans `user:set-role`. */}
                  <Field label={s('profile.subject')} value={me.subject} mono />
                </div>
              </details>
            </CardContent>
          </Card>

          {/* The only preference so far only exists when a host may open a game to all. */}
          {mode === 'oidc' && allowsAnonymousParticipants() && me.roles.includes('host') ? (
            <PreferencesCard />
          ) : null}

          {/* Le siège n'existe qu'en mode local, et seul son titulaire le voit ; sur
              une démo, il appartient pour de bon au compte partagé. */}
          {mode === 'none' && user && !getDemo() ? (
            <Card>
              <CardHeader>
                <CardTitle>{s('profile.seat')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3 text-sm">
                <SeatCountdown user={user} />
                <SeatMenuRow user={user} />
                <p className="text-muted-foreground text-xs">{s('profile.seatHelp')}</p>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const ASK = 'ask';

/**
 * What the account remembers wherever it signs in (#69): the participant access a
 * launch uses without asking (#57), or asking each time; the language of the host's own
 * screens (#209), or the instance's.
 */
function PreferencesCard() {
  const { t, i18n } = useTranslation('auth');
  const queryClient = useQueryClient();
  const { data } = useMeControllerGetPreferences();
  const update = useMeControllerUpdatePreferences();
  const current = data?.data.participantAccess ?? ASK;

  const save = async (change: {
    participantAccess?: ParticipantAccess | null;
    language?: string | null;
  }) => {
    await update.mutateAsync({ data: change });
    await queryClient.invalidateQueries({ queryKey: getMeControllerGetPreferencesQueryKey() });
  };
  const onChange = (value: string) =>
    save({ participantAccess: value === ASK ? null : (value as ParticipantAccess) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.preferences')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-[1em]">
        <label className="flex flex-col gap-1">
          <span className="font-medium">{t('profile.participantAccess')}</span>
          <Select
            value={current}
            disabled={!data || update.isPending}
            onChange={(e) => void onChange(e.target.value)}
            className="max-w-xs"
          >
            <option value={ASK}>{t('profile.participantAccessAsk')}</option>
            <option value="account">{t('profile.participantAccessAccount')}</option>
            <option value="open">{t('profile.participantAccessOpen')}</option>
          </Select>
        </label>
        <p className="text-muted-foreground text-xs">{t('profile.participantAccessHelp')}</p>
        <label className="mt-2 flex flex-col gap-1">
          <span className="font-medium">{t('profile.language')}</span>
          <Select
            value={data?.data.language ?? ''}
            disabled={!data || update.isPending}
            onChange={(e) => void save({ language: e.target.value || null })}
            className="max-w-xs"
          >
            <option value="">
              {t('profile.languageInstance', { name: languageName(resolveLang(), i18n.language) })}
            </option>
            {supportedLngs.map((lang) => (
              <option key={lang} value={lang}>
                {languageName(lang, i18n.language)}
              </option>
            ))}
          </Select>
        </label>
        <p className="text-muted-foreground text-xs">{t('profile.languageHelp')}</p>
      </CardContent>
    </Card>
  );
}

/** `t()` d'une clé à enfants est typé `string | objet` : on accepte un nœud. */
function Field({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs break-all' : 'font-medium'}>{value}</span>
    </p>
  );
}
