import { CONTRACTS_VERSION } from '@quiz-dock/contracts';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
      <Card className="w-full max-w-sm">
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
      <small className="text-muted-foreground">
        {t('landing.contractsVersion', { version: CONTRACTS_VERSION })}
      </small>
    </section>
  );
}
