import { buildSnapshot, type QuizWithContent } from './snapshot';

/** Construit un quiz Prisma minimal (champs utiles au snapshot uniquement). */
const quiz = (over: Partial<QuizWithContent> = {}): QuizWithContent =>
  ({
    id: 'quiz1',
    title: 'Mon quiz',
    language: 'fr',
    questions: [],
    ...over,
  }) as QuizWithContent;

const baseQuestion = {
  id: 'q1',
  orderIndex: 0,
  prompt: 'Q ?',
  media: null,
  timeLimitS: 20,
  numericValue: null,
  numericTolerance: null,
  acceptedAnswers: [],
  options: [],
};

describe('buildSnapshot', () => {
  it('résout basePoints depuis pointsMode (1000/2000/0)', () => {
    const q = (pointsMode: string) => ({ ...baseQuestion, type: 'single_choice', pointsMode });
    const snap = buildSnapshot(
      quiz({
        questions: [q('standard'), q('double'), q('none')] as never,
      }),
    );
    expect(snap.questions.map((x) => x.basePoints)).toEqual([1000, 2000, 0]);
  });

  it('embarque les flags secrets (isCorrect, correctOrderIndex) — secret serveur', () => {
    const snap = buildSnapshot(
      quiz({
        questions: [
          {
            ...baseQuestion,
            type: 'single_choice',
            pointsMode: 'standard',
            options: [
              {
                id: 'o1',
                text: 'Bon',
                color: 'red',
                shape: 'triangle',
                media: null,
                isCorrect: true,
                correctOrderIndex: null,
              },
              {
                id: 'o2',
                text: 'Mauvais',
                color: 'blue',
                shape: 'diamond',
                media: null,
                isCorrect: false,
                correctOrderIndex: null,
              },
            ],
          },
        ] as never,
      }),
    );
    const opts = snap.questions[0].options;
    expect(opts[0]).toMatchObject({ id: 'o1', isCorrect: true });
    expect(opts[1]).toMatchObject({ id: 'o2', isCorrect: false });
  });

  it('mappe média et convertit les Decimal numériques en number', () => {
    const snap = buildSnapshot(
      quiz({
        questions: [
          {
            ...baseQuestion,
            type: 'numeric',
            pointsMode: 'standard',
            media: { url: '/media/x', kind: 'image' },
            numericValue: { toString: () => '42' } as never, // simulate Prisma.Decimal
            numericTolerance: { toString: () => '0.5' } as never,
          },
        ] as never,
      }),
    );
    const q = snap.questions[0];
    expect(q.media).toEqual({ url: '/media/x', kind: 'image' });
    expect(q.numericValue).toBe(42);
    expect(q.numericTolerance).toBe(0.5);
  });

  it('reprend les réponses acceptées normalisées (text_input)', () => {
    const snap = buildSnapshot(
      quiz({
        questions: [
          {
            ...baseQuestion,
            type: 'text_input',
            pointsMode: 'standard',
            acceptedAnswers: [{ normalized: 'paris' }, { normalized: 'ville lumiere' }] as never,
          },
        ] as never,
      }),
    );
    expect(snap.questions[0].acceptedAnswersNormalized).toEqual(['paris', 'ville lumiere']);
  });
});
