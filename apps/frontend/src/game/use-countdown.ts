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
