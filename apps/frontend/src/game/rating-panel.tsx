import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { GameSocket } from './game-client';

/**
 * Avis de fin de partie (§2.11) : note Likert 5 étoiles + commentaire facultatif.
 * Émis sur le socket live (`player:rate`) tant que le joueur est connecté. Dédoublonné
 * localement par PIN **et par quiz** (`localStorage`) : un salon joue plusieurs quiz
 * sous un même PIN (#89), chacun se note à part ; le serveur fait un upsert par
 * joueur et par quiz. `hideWhenDone` : une fois noté, rien (dans le lobby suivant).
 */
export function RatingPanel({
  pin,
  quizId,
  socket,
  hideWhenDone = false,
}: {
  pin: string;
  /** The quiz rated; null before the server named it (older servers): keyed by PIN only. */
  quizId?: string | null;
  socket: GameSocket | null;
  hideWhenDone?: boolean;
}) {
  const { t } = useTranslation('live');
  const key = quizId ? `${pin}.${quizId}` : pin;
  const storageKey = `live.rated.${key}`;
  const draftKey = `rating:${key}`;
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  // The comment survives a reload until it is sent.
  const [comment, setComment] = useState(() => loadDraft<string>(draftKey) ?? '');
  useEffect(() => {
    if (comment) saveDraft(draftKey, comment);
    else clearDraft(draftKey);
  }, [comment, draftKey]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1',
  );

  if (done) {
    return hideWhenDone ? null : (
      <p className="text-muted-foreground text-sm">{t('rating.thanks')}</p>
    );
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
        clearDraft(draftKey);
        setDone(true);
      } else {
        setError(message ?? t('rating.sendFailed'));
      }
    };
    const timer = setTimeout(() => finish(false), 8000);
    socket.emit(
      'player:rate',
      { pin, rating, comment: comment.trim() || undefined },
      (res: { ok: boolean }) => {
        clearTimeout(timer);
        finish(res?.ok === true, t('rating.rejected'));
      },
    );
  };

  const shown = hover || rating;
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t('rating.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={t('rating.starLabel', { count: n })}
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
          placeholder={t('rating.commentPlaceholder')}
          rows={3}
        />
        <Button type="button" disabled={!rating || submitting} onClick={submit}>
          {submitting ? t('rating.sending') : t('rating.send')}
        </Button>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
