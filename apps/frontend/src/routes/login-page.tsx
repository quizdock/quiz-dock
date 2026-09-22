import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { hostSeatControllerState, useHostSeatControllerState } from '../api/generated/auth/auth';
import { ApiError } from '../api/http';
import { peekAfterLogin, useAuth } from '../auth/auth-context';

import { SEAT_DEFAULT_EXPIRY, SEAT_EXPIRY_OPTIONS } from '../auth/seat-options';
import { getDemo } from '../config';

/** Connexion animateur : mode local (nom) ou redirection OIDC selon `AUTH_MODE`. */
export function LoginPage() {
  const { t, i18n } = useTranslation(['auth', 'common']);
  const { mode, loginLocal, claimHostSeat, dropLocal, loginOidc } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [seatTaken, setSeatTaken] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [expiry, setExpiry] = useState<number>(SEAT_DEFAULT_EXPIRY);
  const demo = getDemo();
  // A participant sent here by the join guard (RG-15): the page is the host area,
  // the reason they are looking at it is not.
  const joining = mode === 'oidc' && (peekAfterLogin()?.startsWith('/join') ?? false);
  // Mode local : qui tient le siège d'hôte (et jusqu'à quand). Affiché avant même
  // de saisir un nom, pour expliquer le verrou.
  const seatQuery = useHostSeatControllerState({ query: { enabled: mode === 'none' } });
  const holder = seatQuery.data?.data.holder ?? null;
  const expiresAt = seatQuery.data?.data.expiresAt ?? null;

  const formatUntil = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  const refuse = () => {
    dropLocal();
    setSeatTaken(true);
    void seatQuery.refetch();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSeatTaken(false);
    const role = await loginLocal(name);
    if (role === 'host' || role === 'admin' || role === null) {
      // Titulaire du siège (ou backend injoignable : on laisse l'API trancher).
      void navigate({ to: '/quizzes' });
      return;
    }
    // Pas titulaire : le siège est libre (→ prise intentionnelle, après
    // explication et confirmation) ou occupé (→ participant seulement).
    const state = await hostSeatControllerState().catch(() => null);
    if (state?.data.holder) {
      refuse();
      return;
    }
    setConfirming(true);
  };

  const confirmClaim = async () => {
    setClaiming(true);
    try {
      await claimHostSeat(expiry === 0 ? null : expiry);
      setConfirming(false);
      void navigate({ to: '/quizzes' });
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError && err.status === 409) refuse();
      else throw err;
    } finally {
      setClaiming(false);
    }
  };

  const cancelClaim = () => {
    setConfirming(false);
    dropLocal();
  };

  return (
    <Card className="content-sm">
      <CardHeader>
        <CardTitle>{joining ? t('login.joinTitle') : t('login.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {mode === 'oidc' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {joining ? t('login.joinHint') : t('login.oidcHint')}
            </p>
            <Button type="button" onClick={() => void loginOidc()}>
              {t('login.oidcSubmit')}
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <p className="rounded-md bg-muted p-3 text-sm" role="status">
              {holder
                ? expiresAt
                  ? t('login.seatHeldByUntil', { name: holder, until: formatUntil(expiresAt) })
                  : t('login.seatHeldBy', { name: holder })
                : t('login.seatFree')}
            </p>
            <Label htmlFor="name">
              {t('login.nameLabel')}
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('login.namePlaceholder')}
                autoFocus
              />
            </Label>
            <Button type="submit" disabled={!name.trim()}>
              {t('login.submit')}
            </Button>
            {seatTaken ? (
              <p className="text-sm text-destructive" role="alert">
                {t('login.seatTaken')}{' '}
                <Link to="/" className="underline">
                  {t('login.joinInstead')}
                </Link>
              </p>
            ) : null}
            <small className="text-muted-foreground">{t('login.localHint')}</small>
          </form>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirming}
        title={t('claim.title')}
        description={t('claim.explain')}
        confirmLabel={claiming ? t('common:loading') : t('claim.confirm')}
        onConfirm={() => {
          if (!claiming) void confirmClaim();
        }}
        onCancel={cancelClaim}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('claim.ruleOthers')}</li>
          <li>{t('claim.ruleRelease')}</li>
          <li>{t('claim.ruleName')}</li>
        </ul>
        {demo ? (
          // The server fixes the seat length on a demo; the choice would be a lie.
          <p className="text-sm">{t('claim.demoExpiry', { count: demo.seatMinutes })}</p>
        ) : (
          <Label htmlFor="seat-expiry">
            {t('claim.expiryLabel')}
            <Select
              id="seat-expiry"
              value={expiry}
              onChange={(e) => setExpiry(Number(e.target.value))}
            >
              {SEAT_EXPIRY_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0
                    ? t('claim.expiryNever')
                    : t('claim.expiryHours', { count: minutes / 60 })}
                </option>
              ))}
            </Select>
          </Label>
        )}
      </ConfirmDialog>
    </Card>
  );
}
