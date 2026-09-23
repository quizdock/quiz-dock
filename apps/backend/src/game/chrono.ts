/**
 * Timings d'une question gelée puis reprise (§6, §7.3). Pur : le moteur s'en sert
 * pour le dégel (avec persistance) comme pour l'affichage d'un chrono figé.
 */
export interface QuestionWindow {
  /** Bornes serveur de la question telles qu'elles ont été posées à l'ouverture. */
  questionStartedAt: number;
  questionEndsAt: number;
  /** Restant figé au gel (`questionEndsAt - instant du gel`). */
  pausedRemainingMs?: number;
}

/**
 * Recalcule les bornes d'une question reprise à `now`, en préservant **ce que le
 * participant n'a pas encore consommé** :
 *
 * - gel pendant la **réponse** : le temps déjà écoulé est conservé (`startedAt`
 *   dans le passé), la fenêtre garde sa durée ;
 * - gel pendant le **délai de lecture** (l'état est déjà ANSWERING mais
 *   `questionStartedAt` est dans le futur) : le restant figé dépasse la fenêtre,
 *   et ce dépassement est exactement le temps de lecture qu'il restait. On le
 *   rend, au lieu de le transformer en temps de réponse supplémentaire — sinon
 *   une question de 5 s en offrait 8 quand l'hôte perdait sa fenêtre pendant la
 *   lecture.
 *
 * Dans les deux cas la durée de la fenêtre reste celle de la question.
 */
export function resumeQuestionWindow(
  meta: QuestionWindow,
  now: number,
): { startedAt: number; endsAt: number } {
  const remaining = meta.pausedRemainingMs ?? 0;
  const windowLen = Math.max(0, meta.questionEndsAt - meta.questionStartedAt);
  const readingLeft = Math.max(0, remaining - windowLen);
  const answeringSpent = Math.max(0, windowLen - remaining);
  return { startedAt: now + readingLeft - answeringSpent, endsAt: now + remaining };
}
