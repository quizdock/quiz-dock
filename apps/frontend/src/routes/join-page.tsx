import { useParams } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
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
      <section className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold">Bienvenue {nickname} !</h1>
        <p className="text-muted-foreground">En attente du démarrage de la partie…</p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <h1 className="text-center text-2xl font-bold">Rejoindre une partie</h1>
      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Label>
          Code PIN
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            placeholder="123456"
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
    </section>
  );
}
