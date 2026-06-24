import { useNavigate } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Saisie du PIN (§5.1, 1ʳᵉ étape). Le pseudo et la salle d'attente vivent sur
 * `/join/$pin` (atteignable aussi par QR), qui décide reprise vs nouveau join.
 */
export function JoinPage() {
  const { t } = useTranslation(['join', 'common']);
  const navigate = useNavigate();
  const [pin, setPin] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = pin.trim();
    if (clean) void navigate({ to: '/join/$pin', params: { pin: clean } });
  };

  return (
    <section className="flex flex-col items-center gap-6 py-8 text-center">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('pinCardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 text-left" onSubmit={onSubmit}>
            <Label>
              {t('pinLabel')}
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder={t('pinPlaceholder')}
                className="text-center text-lg tracking-[0.3em]"
                required
              />
            </Label>
            <Button type="submit" disabled={!pin.trim()}>
              <LogIn className="size-4" />
              {t('continue')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
