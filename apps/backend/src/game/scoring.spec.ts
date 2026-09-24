import { OptionColor, OptionShape, PointsMode, QuestionType } from '@quiz-dock/contracts';
import type { SnapshotOption, SnapshotQuestion } from './game.types';
import {
  basePointsFor,
  creditFor,
  editDistance,
  gradeAnswer,
  isDeferred,
  lenientMatch,
  rankClosest,
  scoreAnswer,
  streakBonus,
  timePoints,
} from './scoring';

// ─── Fabriques de snapshot ──────────────────────────────────────────────────

let optSeq = 0;
const opt = (over: Partial<SnapshotOption> = {}): SnapshotOption => ({
  id: `opt_${optSeq++}`,
  text: 'x',
  color: OptionColor.Red,
  shape: OptionShape.Triangle,
  media: null,
  isCorrect: false,
  correctOrderIndex: null,
  ...over,
});

const question = (over: Partial<SnapshotQuestion> = {}): SnapshotQuestion => ({
  id: 'q1',
  orderIndex: 0,
  type: QuestionType.SingleChoice,
  prompt: 'Q ?',
  media: { visual: null, audio: null },
  answerExplanation: null,
  background: null,
  textTone: 'light',
  textOutline: false,
  timeLimitS: 20,
  revealDelayS: null,
  basePoints: 1000,
  numericValue: null,
  numericTolerance: null,
  acceptedAnswersNormalized: [],
  options: [],
  ...over,
});

// ─── basePointsFor (§5) ───────────────────────────────────────────────────────

describe('basePointsFor', () => {
  it.each([
    [PointsMode.Standard, 1000],
    [PointsMode.Double, 2000],
    [PointsMode.None, 0],
  ])('%s → %i', (mode, expected) => {
    expect(basePointsFor(mode)).toBe(expected);
  });
});

// ─── timePoints (§5) ──────────────────────────────────────────────────────────

describe('timePoints', () => {
  it('réponse instantanée → P_max', () => {
    expect(timePoints(1000, 0, 20)).toBe(1000);
  });
  it('au temps limite → P_max / 2', () => {
    expect(timePoints(1000, 20, 20)).toBe(500);
  });
  it('à mi-temps → P_max * 0.75', () => {
    expect(timePoints(1000, 10, 20)).toBe(750);
  });
  it('clamp au-delà du temps limite → P_max / 2', () => {
    expect(timePoints(1000, 50, 20)).toBe(500);
  });
  it('clamp temps négatif → P_max', () => {
    expect(timePoints(1000, -5, 20)).toBe(1000);
  });
  it('arrondit', () => {
    expect(timePoints(1000, 7, 20)).toBe(Math.round(1000 * (1 - 0.35 / 2)));
  });
  it('timeLimit nul → P_max (pas de division par zéro)', () => {
    expect(timePoints(1000, 5, 0)).toBe(1000);
  });
});

// ─── streakBonus (§5) ─────────────────────────────────────────────────────────

describe('streakBonus', () => {
  it.each([
    [0, 0],
    [1, 0], // 1re bonne réponse : pas de bonus
    [2, 100],
    [3, 200],
    [6, 500], // cap atteint
    [7, 500], // cap maintenu
    [20, 500],
  ])('série %i → +%i', (streak, expected) => {
    expect(streakBonus(streak)).toBe(expected);
  });
});

// ─── gradeAnswer par type (§4) ───────────────────────────────────────────────

describe('gradeAnswer', () => {
  it('single_choice : option correcte vs autre', () => {
    const good = opt({ isCorrect: true });
    const bad = opt();
    const q = question({ type: QuestionType.SingleChoice, options: [good, bad] });
    expect(gradeAnswer(q, good.id)).toBe(true);
    expect(gradeAnswer(q, bad.id)).toBe(false);
    expect(gradeAnswer(q, 'inconnu')).toBe(false);
    expect(gradeAnswer(q, ['x'])).toBe(false); // mauvais type
  });

  it('true_false : 1 parmi 2', () => {
    const vrai = opt({ isCorrect: true });
    const faux = opt();
    const q = question({ type: QuestionType.TrueFalse, options: [vrai, faux] });
    expect(gradeAnswer(q, vrai.id)).toBe(true);
    expect(gradeAnswer(q, faux.id)).toBe(false);
  });

  it('multiple_choice : tout-ou-rien (ensemble exact)', () => {
    const a = opt({ isCorrect: true });
    const b = opt({ isCorrect: true });
    const c = opt();
    const q = question({ type: QuestionType.MultipleChoice, options: [a, b, c] });
    expect(gradeAnswer(q, [a.id, b.id])).toBe(true);
    expect(gradeAnswer(q, [b.id, a.id])).toBe(true); // ordre indifférent
    expect(gradeAnswer(q, [a.id])).toBe(false); // incomplet
    expect(gradeAnswer(q, [a.id, b.id, c.id])).toBe(false); // une mauvaise
    expect(gradeAnswer(q, [a.id, a.id])).toBe(false); // doublon
    expect(gradeAnswer(q, 'x')).toBe(false); // mauvais type
  });

  it('ordering : séquence exacte', () => {
    const o0 = opt({ correctOrderIndex: 0 });
    const o1 = opt({ correctOrderIndex: 1 });
    const o2 = opt({ correctOrderIndex: 2 });
    const q = question({ type: QuestionType.Ordering, options: [o0, o1, o2] });
    expect(gradeAnswer(q, [o0.id, o1.id, o2.id])).toBe(true);
    expect(gradeAnswer(q, [o1.id, o0.id, o2.id])).toBe(false); // mal ordonné
    expect(gradeAnswer(q, [o0.id, o1.id])).toBe(false); // incomplet
    expect(gradeAnswer(q, [o0.id, o1.id, o0.id])).toBe(false); // doublon
    expect(gradeAnswer(q, o0.id)).toBe(false); // mauvais type (non-tableau)
  });

  it('text_input : réponse normalisée acceptée', () => {
    const q = question({
      type: QuestionType.TextInput,
      acceptedAnswersNormalized: ['paris', 'ville lumiere'],
    });
    expect(gradeAnswer(q, 'Paris')).toBe(true);
    expect(gradeAnswer(q, '  PÀRIS ')).toBe(true); // casse/accents/espaces
    expect(gradeAnswer(q, 'Ville Lumière')).toBe(true);
    expect(gradeAnswer(q, 'Lyon')).toBe(false);
    expect(gradeAnswer(q, 42)).toBe(false); // mauvais type
  });

  it('numeric : cible ± tolérance', () => {
    const q = question({ type: QuestionType.Numeric, numericValue: 100, numericTolerance: 5 });
    expect(gradeAnswer(q, 100)).toBe(true);
    expect(gradeAnswer(q, 95)).toBe(true);
    expect(gradeAnswer(q, 105)).toBe(true);
    expect(gradeAnswer(q, 94)).toBe(false);
    expect(gradeAnswer(q, 'cent')).toBe(false); // mauvais type
    expect(gradeAnswer(q, Number.NaN)).toBe(false);
  });

  it('numeric : tolérance nulle par défaut', () => {
    const q = question({ type: QuestionType.Numeric, numericValue: 7 });
    expect(gradeAnswer(q, 7)).toBe(true);
    expect(gradeAnswer(q, 7.0001)).toBe(false);
  });

  it('numeric : sans cible définie → faux', () => {
    const q = question({ type: QuestionType.Numeric, numericValue: null });
    expect(gradeAnswer(q, 0)).toBe(false);
  });

  it('poll : jamais correct (0 point)', () => {
    const q = question({ type: QuestionType.Poll, options: [opt(), opt()] });
    expect(gradeAnswer(q, q.options[0].id)).toBe(false);
  });
});

// ─── scoreAnswer : intégration formule (§5/§6) ────────────────────────────────

describe('scoreAnswer', () => {
  const single = () => {
    const good = opt({ isCorrect: true });
    return { good, q: question({ type: QuestionType.SingleChoice, options: [good, opt()] }) };
  };

  it('bonne réponse instantanée → P_max, série = 1, pas de bonus', () => {
    const { good, q } = single();
    expect(scoreAnswer({ question: q, answer: good.id, tMs: 0, prevStreak: 0 })).toMatchObject({
      correct: true,
      points: 1000,
      newStreak: 1,
    });
  });

  it('bonne réponse au temps limite → P_max / 2', () => {
    const { good, q } = single();
    const r = scoreAnswer({ question: q, answer: good.id, tMs: 20_000, prevStreak: 0 });
    expect(r.points).toBe(500);
  });

  it('mauvaise réponse → 0, série remise à 0', () => {
    const { q } = single();
    expect(scoreAnswer({ question: q, answer: 'inconnu', tMs: 0, prevStreak: 4 })).toMatchObject({
      correct: false,
      points: 0,
      newStreak: 0,
    });
  });

  it('hors délai → 0 même si exacte, série remise à 0', () => {
    const { good, q } = single();
    expect(
      scoreAnswer({ question: q, answer: good.id, tMs: 1000, prevStreak: 3, isLate: true }),
    ).toMatchObject({ correct: false, points: 0, newStreak: 0 });
  });

  it('bonus de série cumulé : 2e bonne réponse consécutive → +100', () => {
    const { good, q } = single();
    const r = scoreAnswer({ question: q, answer: good.id, tMs: 0, prevStreak: 1 });
    expect(r).toMatchObject({ correct: true, points: 1100, newStreak: 2 });
  });

  it('mode double : P_max = 2000', () => {
    const good = opt({ isCorrect: true });
    const q = question({
      type: QuestionType.SingleChoice,
      basePoints: 2000,
      options: [good, opt()],
    });
    expect(scoreAnswer({ question: q, answer: good.id, tMs: 0, prevStreak: 0 }).points).toBe(2000);
  });

  it('mode none : 0 point et série NEUTRE (inchangée), même correct', () => {
    const good = opt({ isCorrect: true });
    const q = question({
      type: QuestionType.SingleChoice,
      basePoints: 0,
      options: [good, opt()],
    });
    // Question sans enjeu : ni points, ni bonus, série conservée telle quelle.
    expect(scoreAnswer({ question: q, answer: good.id, tMs: 0, prevStreak: 3 })).toMatchObject({
      correct: true,
      points: 0,
      newStreak: 3,
    });
  });

  it('mode none incorrect : série NEUTRE (ne casse pas la série)', () => {
    const q = question({ type: QuestionType.SingleChoice, basePoints: 0, options: [opt(), opt()] });
    expect(scoreAnswer({ question: q, answer: 'inconnu', tMs: 0, prevStreak: 4 })).toMatchObject({
      correct: false,
      points: 0,
      newStreak: 4,
    });
  });

  it('sondage (poll) : 0 point et série NEUTRE', () => {
    const q = question({ type: QuestionType.Poll, basePoints: 1000, options: [opt(), opt()] });
    expect(
      scoreAnswer({ question: q, answer: q.options[0].id, tMs: 0, prevStreak: 2 }),
    ).toMatchObject({
      correct: false,
      points: 0,
      newStreak: 2,
    });
  });
});

// ─── Scoring variants (per-type `scoring`, `fixed` points mode) ──────────────
describe('scoring variants', () => {
  it('multiple_choice partial: credit per right tick, a wrong tick cancels one', () => {
    const a = opt({ isCorrect: true });
    const b = opt({ isCorrect: true });
    const c = opt();
    const d = opt();
    const q = question({
      type: QuestionType.MultipleChoice,
      scoring: 'partial',
      options: [a, b, c, d],
    });
    expect(creditFor(q, [a.id])).toBe(0.5);
    expect(creditFor(q, [a.id, b.id])).toBe(1);
    expect(creditFor(q, [a.id, b.id, c.id])).toBe(0.5);
    expect(creditFor(q, [a.id, c.id, d.id])).toBe(0);
    // Half credit = half of the timed points, streak neutral.
    const r = scoreAnswer({ question: q, answer: [a.id], tMs: 0, prevStreak: 3 });
    expect(r).toMatchObject({ correct: false, points: 500, newStreak: 3, credit: 0.5 });
    // Full credit behaves like a right answer.
    expect(scoreAnswer({ question: q, answer: [a.id, b.id], tMs: 0, prevStreak: 0 })).toMatchObject(
      {
        correct: true,
        points: 1000,
        newStreak: 1,
      },
    );
  });

  it('ordering partial: share of elements at the right position', () => {
    const o = [0, 1, 2, 3].map((i) => opt({ correctOrderIndex: i }));
    const q = question({ type: QuestionType.Ordering, scoring: 'partial', options: o });
    expect(creditFor(q, [o[0].id, o[1].id, o[3].id, o[2].id])).toBe(0.5);
    expect(
      creditFor(
        q,
        o.map((x) => x.id),
      ),
    ).toBe(1);
    // Standard stays all or nothing.
    const strict = question({ type: QuestionType.Ordering, options: o });
    expect(creditFor(strict, [o[0].id, o[1].id, o[3].id, o[2].id])).toBe(0);
  });

  it('text_input lenient: one typo up to 5 letters, two beyond; standard stays exact', () => {
    expect(editDistance('paris', 'pariss')).toBe(1);
    expect(lenientMatch('pari', 'paris')).toBe(true);
    expect(lenientMatch('pris', 'paris')).toBe(true);
    expect(lenientMatch('lyon', 'paris')).toBe(false);
    expect(lenientMatch('marseile', 'marseille')).toBe(true);
    expect(lenientMatch('marsaile', 'marseille')).toBe(true);
    expect(lenientMatch('marsal', 'marseille')).toBe(false);
    const lenient = question({
      type: QuestionType.TextInput,
      scoring: 'lenient',
      acceptedAnswersNormalized: ['paris'],
    });
    const strict = question({ type: QuestionType.TextInput, acceptedAnswersNormalized: ['paris'] });
    expect(creditFor(lenient, 'Pariss')).toBe(1);
    expect(creditFor(strict, 'Pariss')).toBe(0);
  });

  it('fixed points mode: full base points whatever the speed', () => {
    const a = opt({ isCorrect: true });
    const q = question({ pointsMode: PointsMode.Fixed, options: [a, opt()], timeLimitS: 20 });
    expect(scoreAnswer({ question: q, answer: a.id, tMs: 20_000, prevStreak: 0 }).points).toBe(
      1000,
    );
    expect(basePointsFor(PointsMode.Fixed)).toBe(1000);
  });

  it('numeric closest: settled at submit as deferred, ranked at reveal', () => {
    const q = question({
      type: QuestionType.Numeric,
      scoring: 'closest',
      numericValue: 100,
      numericTolerance: 1,
    });
    expect(isDeferred(q)).toBe(true);
    expect(scoreAnswer({ question: q, answer: 130, tMs: 0, prevStreak: 2 })).toMatchObject({
      deferred: true,
      points: 0,
      newStreak: 2,
    });
    const rows = rankClosest(q, [
      { key: 'far', answer: 300 },
      { key: 'exact', answer: 100.5 },
      { key: 'near', answer: 110 },
      { key: 'near2', answer: 90 },
      { key: 'text', answer: 'abc' },
      { key: 'tail1', answer: 150 },
      { key: 'tail2', answer: 160 },
    ]);
    expect(rows.map((r) => [r.key, r.rank, r.points, r.exact])).toEqual([
      ['exact', 1, 1000, true],
      ['near', 2, 750, false],
      ['near2', 2, 750, false], // tie on distance 10 shares the rank
      ['tail1', 4, 300, false],
      ['tail2', 5, 100, false],
      ['far', 6, 100, false],
    ]);
  });
});
