import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SeatCountdown, SeatMenuRow } from '@/components/seat-status';
import { useMeControllerMe } from '../api/generated/me/me';
import { useAuth } from '../auth/auth-context';
import { APP_NAME, getDemo } from '../config';

/**
 * Le compte, vu par la personne à qui il appartient : qui elle est pour cette
 * instance, ce que son rôle l'autorise à faire, et — en mode local — l'état du
 * siège d'animateur. Rien n'est modifiable ici : le nom et le courriel viennent
 * du fournisseur d'identité ou du nom saisi, et le rôle est un octroi
 * d'opérateur (RG-14). La page dit d'où vient chaque chose plutôt que de
 * laisser croire qu'elle se change.
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

/** `t()` d'une clé à enfants est typé `string | objet` : on accepte un nœud. */
function Field({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs break-all' : 'font-medium'}>{value}</span>
    </p>
  );
}
