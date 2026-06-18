import { Star } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { GameSocket } from './game-client';

/**
 * Avis de fin de partie (§2.11) : note Likert 5 étoiles + commentaire facultatif.
 * Émis sur le socket live (`player:rate`) tant que le joueur est connecté. Dédoublonné
 * localement par PIN (`localStorage`) pour ne pas re-solliciter à la reconnexion ;
 * le serveur fait par ailleurs un upsert par joueur/partie.
 */
export function RatingPanel({ pin, socket }: { pin: string; socket: GameSocket | null }) {
  const storageKey = `roux.rated.${pin}`;
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1',
  );

  if (done) {
    return <p className="text-muted-foreground text-sm">Merci pour ton avis 🙏</p>;
  }

  const submit = () => {
    if (!rating || !socket) return;
    setSubmitting(true);
    setError(null);
    // Garde-fou : si le serveur ne renvoie jamais l'accusé (handler absent, socket
    // coupé…), on ne reste pas bloqué sur « Envoi… » — on rend la main avec une erreur.
    let settled = false;
    const finish = (ok: boolean, message?: string) => {
      if (settled) return;
      settled = true;
      setSubmitting(false);
      if (ok) {
        localStorage.setItem(storageKey, '1');
        setDone(true);
      } else {
        setError(message ?? 'Envoi impossible. Vérifie ta connexion et réessaie.');
      }
    };
    const timer = setTimeout(() => finish(false), 8000);
    socket.emit(
      'player:rate',
      { pin, rating, comment: comment.trim() || undefined },
      (res: { ok: boolean }) => {
        clearTimeout(timer);
        finish(res?.ok === true, 'Avis refusé : la partie n’est peut-être pas terminée.');
      },
    );
  };

  const shown = hover || rating;
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Ton avis sur ce quiz</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
              aria-pressed={rating === n}
              onMouseEnter={() => setHover(n)}
              onClick={() => setRating(n)}
              className="rounded p-1 transition-transform hover:scale-110 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
            >
              <Star
                className={cn(
                  'size-8',
                  shown >= n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground',
                )}
              />
            </button>
          ))}
        </div>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Un commentaire ? (facultatif)"
          rows={3}
        />
        <Button type="button" disabled={!rating || submitting} onClick={submit}>
          {submitting ? 'Envoi…' : 'Envoyer mon avis'}
        </Button>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
