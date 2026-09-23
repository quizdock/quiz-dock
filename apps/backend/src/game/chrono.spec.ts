import { resumeQuestionWindow } from './chrono';

/**
 * Le gel/dégel d'une question (§7.3). La règle tient en une phrase : la fenêtre
 * de réponse garde la durée de la question, et ce qui n'a pas été consommé est
 * rendu — y compris le délai de lecture.
 */
describe('resumeQuestionWindow', () => {
  const NOW = 1_000_000;
  // Question de 5 s, ouverte après 3 s de lecture.
  const meta = { questionStartedAt: NOW - 3_000, questionEndsAt: NOW + 2_000 };

  it('gel pendant la réponse : le temps écoulé est conservé', () => {
    // 2 s restantes sur 5 → 3 s déjà écoulées, à retrouver à la reprise.
    const { startedAt, endsAt } = resumeQuestionWindow({ ...meta, pausedRemainingMs: 2_000 }, NOW);
    expect(startedAt).toBe(NOW - 3_000);
    expect(endsAt).toBe(NOW + 2_000);
    expect(endsAt - startedAt).toBe(5_000);
  });

  it('gel pendant le délai de lecture : la lecture restante est rendue, pas convertie', () => {
    // L'état est ANSWERING dès l'ouverture, mais `questionStartedAt` est encore
    // dans le futur : le restant figé (5 s + 1,2 s de lecture) dépasse la fenêtre.
    const reading = { questionStartedAt: NOW + 1_200, questionEndsAt: NOW + 6_200 };
    const { startedAt, endsAt } = resumeQuestionWindow(
      { ...reading, pausedRemainingMs: 6_200 },
      NOW,
    );
    expect(startedAt).toBe(NOW + 1_200); // on lit encore 1,2 s
    expect(endsAt).toBe(NOW + 6_200);
    // Et surtout : 5 s pour répondre, pas 6,2 s.
    expect(endsAt - startedAt).toBe(5_000);
  });

  it('restant nul : la fenêtre se ferme immédiatement, sans durée négative', () => {
    const { startedAt, endsAt } = resumeQuestionWindow({ ...meta, pausedRemainingMs: 0 }, NOW);
    expect(endsAt).toBe(NOW);
    expect(endsAt - startedAt).toBe(5_000);
  });
});
