import { useParams } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { joinSession } from '../game/game-client';

/**
 * Entrée joueur : saisie du PIN (pré-rempli si arrivé par QR `/join/:pin`) et du
 * pseudo, puis salle d'attente. Route publique (aucune authentification).
 */
export function JoinPage() {
  const params = useParams({ strict: false }) as { pin?: string };
  const [pin, setPin] = useState(params.pin ?? '');
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState<'idle' | 'joining' | 'joined'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus('joining');
    try {
      await joinSession(pin.trim(), nickname.trim());
      setStatus('joined');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de rejoindre la partie.');
      setStatus('idle');
    }
  };

  if (status === 'joined') {
    return (
      <section className="flex flex-col items-center gap-6 py-8 text-center">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Bienvenue {nickname} !</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">En attente du démarrage de la partie…</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="flex flex-col items-center gap-6 py-8 text-center">
      <h1 className="text-3xl font-bold">Rejoindre une session</h1>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Votre PIN et votre pseudo</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 text-left" onSubmit={(e) => void onSubmit(e)}>
            <Label>
              Code PIN
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                className="text-center text-lg tracking-[0.3em]"
                required
              />
            </Label>
            <Label>
              Pseudo
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Votre pseudo"
                required
              />
            </Label>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <Button type="submit" disabled={status === 'joining' || !pin || !nickname}>
              <LogIn className="size-4" />
              {status === 'joining' ? 'Connexion…' : 'Rejoindre'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
