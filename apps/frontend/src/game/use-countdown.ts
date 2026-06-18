import { useEffect, useState } from 'react';

/**
 * Chrono visuel dérivé des **timestamps serveur** (P3-FRONT-4). On ne compte pas
 * un délai local : on calcule le restant depuis `endsAt` (ms epoch serveur) à
 * chaque tick, ce qui reste juste après un re-render, un late join ou une reprise.
 * `endsAt = null` (hors question) → `null`. Compensation de latence = P4 (`latencyMs=0`).
 */
export function useCountdown(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/**
 * Restant **affiché** de la question courante, cohérent sur les trois surfaces
 * (contrôle / projection / joueur) : décompte live sur `endsAt`, ou valeur **figée**
 * quand le serveur a gelé le chrono (pause §8). Sans cela, la pause ne figerait que
 * la console hôte pendant que la projection continuerait à défiler jusqu'à zéro.
 */
export function useGameRemaining(view: {
  state: string | null;
  paused: boolean;
  pausedRemainingMs: number | null;
  question: { endsAt: number } | null;
}): number | null {
  const live = useCountdown(
    view.state === 'ANSWERING' && !view.paused ? (view.question?.endsAt ?? null) : null,
  );
  return view.paused && view.pausedRemainingMs != null
    ? Math.ceil(view.pausedRemainingMs / 1000)
    : live;
}
