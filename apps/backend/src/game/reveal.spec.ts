import { OptionColor, OptionShape, QuestionType } from '@roux-quizz/contracts';
import type { AnswerRecord, SnapshotOption, SnapshotQuestion } from './game.types';
import { buildRevealCommon } from './reveal';

let seq = 0;
const opt = (over: Partial<SnapshotOption> = {}): SnapshotOption => ({
  id: `o${seq++}`,
  text: 'x',
  color: OptionColor.Red,
  shape: OptionShape.Triangle,
  media: null,
  isCorrect: false,
  correctOrderIndex: null,
  ...over,
});

const question = (over: Partial<SnapshotQuestion> = {}): SnapshotQuestion => ({
  id: 'q',
  orderIndex: 0,
  type: QuestionType.SingleChoice,
  prompt: 'Q ?',
  media: null,
  timeLimitS: 20,
  basePoints: 1000,
  numericValue: null,
  numericTolerance: null,
  acceptedAnswersNormalized: [],
  options: [],
  ...over,
});

const rec = (answer: AnswerRecord['answer'], isCorrect = false): AnswerRecord => ({
  answer,
  isCorrect,
  pointsAwarded: 0,
  tMs: 0,
  receivedAt: 0,
});

describe('buildRevealCommon', () => {
  it('single_choice : bonnes options + répartition par option (0 par défaut)', () => {
    const good = opt({ isCorrect: true });
    const bad = opt();
    const q = question({ type: QuestionType.SingleChoice, options: [good, bad] });
    const r = buildRevealCommon(q, [rec(good.id, true), rec(good.id, true), rec(bad.id)]);
    expect(r.correctOptionIds).toEqual([good.id]);
    expect(r.distribution).toEqual({ [good.id]: 2, [bad.id]: 1 });
    expect(r.correctValue).toBeUndefined();
  });

  it('multiple_choice : compte chaque option cochée', () => {
    const a = opt({ isCorrect: true });
    const b = opt({ isCorrect: true });
    const c = opt();
    const q = question({ type: QuestionType.MultipleChoice, options: [a, b, c] });
    const r = buildRevealCommon(q, [rec([a.id, b.id], true), rec([a.id, c.id])]);
    expect(r.correctOptionIds).toEqual([a.id, b.id]);
    expect(r.distribution).toEqual({ [a.id]: 2, [b.id]: 1, [c.id]: 1 });
  });

  it('ordering : correctValue = séquence des ids ; répartition correct/incorrect', () => {
    const o0 = opt({ correctOrderIndex: 0 });
    const o1 = opt({ correctOrderIndex: 1 });
    const q = question({ type: QuestionType.Ordering, options: [o1, o0] }); // ordre stockage mélangé
    const r = buildRevealCommon(q, [rec([o0.id, o1.id], true), rec([o1.id, o0.id])]);
    expect(r.correctValue).toEqual([o0.id, o1.id]);
    expect(r.distribution).toEqual({ correct: 1, incorrect: 1 });
  });

  it('numeric : correctValue = cible ; répartition correct/incorrect', () => {
    const q = question({ type: QuestionType.Numeric, numericValue: 42 });
    const r = buildRevealCommon(q, [rec(42, true), rec(40)]);
    expect(r.correctValue).toBe(42);
    expect(r.distribution).toEqual({ correct: 1, incorrect: 1 });
  });

  it('text_input : correctValue = réponses normalisées', () => {
    const q = question({ type: QuestionType.TextInput, acceptedAnswersNormalized: ['paris'] });
    const r = buildRevealCommon(q, [rec('Paris', true)]);
    expect(r.correctValue).toEqual(['paris']);
    expect(r.distribution).toEqual({ correct: 1, incorrect: 0 });
  });

  it('poll : aucune bonne réponse, répartition par option', () => {
    const a = opt();
    const b = opt();
    const q = question({ type: QuestionType.Poll, options: [a, b] });
    const r = buildRevealCommon(q, [rec(a.id), rec(a.id), rec(b.id)]);
    expect(r.correctOptionIds).toBeUndefined();
    expect(r.correctValue).toBeUndefined();
    expect(r.distribution).toEqual({ [a.id]: 2, [b.id]: 1 });
  });
});
