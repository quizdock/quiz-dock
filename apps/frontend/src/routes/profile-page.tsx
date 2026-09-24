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
import { APP_NAME, allowsAnonymousParticipants, getDemo } from '../config';

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
  const { data, isPending } = useMeControllerMe({ query: { retry: false } });
  const me = data?.data;

  return (
    <section className="content-md flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{s('profile.title')}</h1>

      {isPending ? <p className="text-muted-foreground">{t('common:loading')}</p> : null}

      {me ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{s('profile.identity')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Field label={s('profile.displayName')} value={me.displayName} />
              <Field label={s('profile.email')} value={me.email ?? s('profile.noEmail')} />
              {/* Le sujet est ce qu'un opérateur tape dans `user:set-role`. */}
              <Field label={s('profile.subject')} value={me.subject} mono />
              <p className="text-muted-foreground text-xs">
                {mode === 'oidc' ? t('profile.fromProvider') : t('profile.fromLocalName')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{s('profile.role')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {/* Un ensemble vide est un participant ; `[admin, host]` porte les deux. */}
              <span className="flex flex-wrap gap-2">
                {(me.roles.length ? me.roles : ['player']).map((role) => (
                  <Badge key={role} variant={role === 'player' ? 'muted' : 'success'}>
                    {s(`profile.roles.${role}`)}
                  </Badge>
                ))}
              </span>
              {(me.roles.length ? me.roles : ['player']).map((role) => (
                <p key={role} className="text-muted-foreground">
                  {s(`profile.roleHelp.${role}`)}
                </p>
              ))}
              <p className="text-muted-foreground text-xs">
                {s('profile.roleGranted', { app: APP_NAME })}
              </p>
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
 * launch uses without asking (#57), or asking each time.
 */
function PreferencesCard() {
  const { t } = useTranslation('auth');
  const queryClient = useQueryClient();
  const { data } = useMeControllerGetPreferences();
  const update = useMeControllerUpdatePreferences();
  const current = data?.data.participantAccess ?? ASK;

  const onChange = async (value: string) => {
    const participantAccess = value === ASK ? null : (value as ParticipantAccess);
    await update.mutateAsync({ data: { participantAccess } });
    await queryClient.invalidateQueries({ queryKey: getMeControllerGetPreferencesQueryKey() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.preferences')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
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
