import { useEffect, useState } from 'react';
import { serverNow } from './clock';

/**
 * Chrono visuel dérivé des **timestamps serveur** (P3-FRONT-4). On ne compte pas
 * un délai local : on calcule le restant depuis `endsAt` (ms epoch serveur) à
 * chaque tick, ce qui reste juste après un re-render, un late join ou une reprise.
 * `endsAt = null` (hors question) → `null`. Compensation de latence = P4 (`latencyMs=0`).
 */
export function useCountdown(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (endsAt === null) return;
    setNow(serverNow());
    // Once the deadline is past the display stays at 0: stop, or the page would
    // re-render four times a second until the end of the game (reveal, podium…).
    const id = setInterval(() => {
      const t = serverNow();
      setNow(t);
      if (t >= endsAt) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** What a question's clock shows: the same on the screen, the phones and the console. */
export interface QuestionClock {
  /** Listen first, before the answers open: the count is to their opening. */
  listening: boolean;
  /**
   * The reading window, before the answers open (no listening): the clock stands at
   * the answers' whole time, which only starts once they open.
   */
  reading: boolean;
  /** Stood still by the server (the game paused). */
  paused: boolean;
  /** Seconds left, rounded up. */
  remaining: number;
  /** The whole of what is counted, for the bar: the answers' window, or the listening. */
  totalS: number;
}

/**
 * The clock of the question being answered, from the server's timestamps (so a
 * late join, a re-render or a resume shows the same as everyone): the answers'
 * window as it is now (lengthened by the host too), or, listen first, the
 * listening before it. Paused, what the server froze, which tells both apart.
 * Null out of a question being answered.
 */
export function useQuestionClock(view: {
  state: string | null;
  paused: boolean;
  pausedRemainingMs: number | null;
  /** Drawn with no game (a preview): the clock stands at its full time. */
  still?: boolean;
  question: {
    startedAt: number;
    endsAt: number;
    listenFirst?: boolean;
    mediaStartAt?: number | null;
  } | null;
}): QuestionClock | null {
  const q = view.question;
  const live = view.state === 'ANSWERING' && !view.paused && !view.still && q !== null;
  const toEnd = useCountdown(live ? q.endsAt : null);
  const toOpen = useCountdown(live ? q.startedAt : null);
  const frozen = view.paused && view.pausedRemainingMs != null;
  const still = !!view.still && (view.state === 'QUESTION_SHOW' || view.state === 'ANSWERING');
  if (!q || (!live && !frozen && !still)) return null;
  const windowS = (q.endsAt - q.startedAt) / 1000;
  // A preview: the whole time, standing, neither counting nor paused.
  if (still)
    return { listening: false, reading: false, paused: false, remaining: windowS, totalS: windowS };
  const listenS = (q.startedAt - (q.mediaStartAt ?? q.startedAt)) / 1000;
  if (frozen) {
    const leftS = (view.pausedRemainingMs ?? 0) / 1000;
    const before = leftS > windowS;
    const listening = !!q.listenFirst && before;
    const reading = !q.listenFirst && before;
    return {
      listening,
      reading,
      paused: true,
      remaining: Math.ceil(listening ? leftS - windowS : reading ? windowS : leftS),
      totalS: listening ? listenS : windowS,
    };
  }
  const before = (toOpen ?? 0) > 0;
  const listening = !!q.listenFirst && before;
  const reading = !q.listenFirst && before;
  return {
    listening,
    reading,
    paused: false,
    remaining: (listening ? toOpen : reading ? Math.ceil(windowS) : toEnd) ?? 0,
    totalS: listening ? listenS : windowS,
  };
}
