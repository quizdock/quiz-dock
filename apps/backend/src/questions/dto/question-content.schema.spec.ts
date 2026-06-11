import { normalizeAnswer, questionContentSchema } from './question-content.schema';

type OptIn = {
  color?: string;
  shape?: string;
  isCorrect?: boolean;
  correctOrderIndex?: number;
  text?: string;
};

const opt = (o: OptIn = {}) => ({
  color: 'red',
  shape: 'triangle',
  text: 'x',
  ...o,
});

const base = { prompt: 'Q ?', timeLimitS: 20 };

const ok = (input: unknown) => questionContentSchema.safeParse(input).success;

describe('normalizeAnswer (RG-06)', () => {
  it('minuscule, sans accent, espaces compactés', () => {
    expect(normalizeAnswer('  Élÿsée   Palais ')).toBe('elysee palais');
  });
});

describe('questionContentSchema — validation par type (§4)', () => {
  it('single_choice : 2–6 options, exactement 1 correcte', () => {
    expect(
      ok({
        ...base,
        type: 'single_choice',
        options: [opt({ isCorrect: true }), opt()],
      }),
    ).toBe(true);
    expect(ok({ ...base, type: 'single_choice', options: [opt({ isCorrect: true })] })).toBe(false); // 1 option
    expect(ok({ ...base, type: 'single_choice', options: [opt(), opt()] })).toBe(false); // 0 correcte
    expect(
      ok({
        ...base,
        type: 'single_choice',
        options: [opt({ isCorrect: true }), opt({ isCorrect: true })],
      }),
    ).toBe(false); // 2 correctes
  });

  it('multiple_choice : ≥ 1 correcte', () => {
    expect(
      ok({
        ...base,
        type: 'multiple_choice',
        options: [opt({ isCorrect: true }), opt({ isCorrect: true }), opt()],
      }),
    ).toBe(true);
    expect(ok({ ...base, type: 'multiple_choice', options: [opt(), opt()] })).toBe(false);
  });

  it('true_false : exactement 2 options', () => {
    expect(
      ok({
        ...base,
        type: 'true_false',
        options: [opt({ isCorrect: true }), opt()],
      }),
    ).toBe(true);
    expect(
      ok({
        ...base,
        type: 'true_false',
        options: [opt({ isCorrect: true }), opt(), opt()],
      }),
    ).toBe(false);
  });

  it('ordering : correctOrderIndex doit former une permutation 0..n-1', () => {
    expect(
      ok({
        ...base,
        type: 'ordering',
        options: [
          opt({ correctOrderIndex: 0 }),
          opt({ correctOrderIndex: 1 }),
          opt({ correctOrderIndex: 2 }),
        ],
      }),
    ).toBe(true);
    expect(
      ok({
        ...base,
        type: 'ordering',
        options: [opt({ correctOrderIndex: 0 }), opt({ correctOrderIndex: 2 })],
      }),
    ).toBe(false); // trou
    expect(
      ok({
        ...base,
        type: 'ordering',
        options: [opt({ correctOrderIndex: 0 }), opt()],
      }),
    ).toBe(false); // index manquant
  });

  it('text_input : ≥ 1 réponse acceptée, pas d’options', () => {
    expect(
      ok({
        ...base,
        type: 'text_input',
        acceptedAnswers: [{ text: 'Paris' }],
      }),
    ).toBe(true);
    expect(ok({ ...base, type: 'text_input', acceptedAnswers: [] })).toBe(false);
    expect(
      ok({
        ...base,
        type: 'text_input',
        acceptedAnswers: [{ text: 'x' }],
        options: [opt(), opt()],
      }),
    ).toBe(false); // options interdites
  });

  it('numeric : value + tolerance ≥ 0, pas d’options', () => {
    expect(ok({ ...base, type: 'numeric', numericValue: 42, numericTolerance: 1 })).toBe(true);
    expect(ok({ ...base, type: 'numeric', numericValue: 42 })).toBe(false); // tolérance manquante
    expect(
      ok({
        ...base,
        type: 'numeric',
        numericValue: 42,
        numericTolerance: -1,
      }),
    ).toBe(false); // tolérance négative
  });

  it('poll : options sans bonne réponse', () => {
    expect(ok({ ...base, type: 'poll', options: [opt(), opt()] })).toBe(true);
    expect(
      ok({
        ...base,
        type: 'poll',
        options: [opt({ isCorrect: true }), opt()],
      }),
    ).toBe(false);
  });

  it('timeLimitS borné 5–120', () => {
    const q = (t: number) => ({
      ...base,
      timeLimitS: t,
      type: 'single_choice',
      options: [opt({ isCorrect: true }), opt()],
    });
    expect(ok(q(5))).toBe(true);
    expect(ok(q(120))).toBe(true);
    expect(ok(q(4))).toBe(false);
    expect(ok(q(121))).toBe(false);
  });
});
