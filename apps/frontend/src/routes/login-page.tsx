import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '../auth/auth-context';

/** Connexion formateur : mode local (nom) ou redirection OIDC selon `AUTH_MODE`. */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { mode, loginLocal, loginOidc } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    loginLocal(name);
    void navigate({ to: '/dashboard' });
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('login.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {mode === 'oidc' ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('login.oidcHint')}</p>
            <Button type="button" onClick={() => void loginOidc()}>
              {t('login.oidcSubmit')}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
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
            <small className="text-muted-foreground">{t('login.localHint')}</small>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
