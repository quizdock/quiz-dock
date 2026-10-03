import { type QuizWithContent, buildSnapshot, refreshSnapshotForm } from './snapshot';

/** A quiz as Prisma returns it, minimal but complete for the builder. */
function quiz(over: Partial<QuizWithContent> = {}): QuizWithContent {
  const now = new Date();
  const question = (id: string, orderIndex: number, prompt: string) => ({
    id,
    quizId: 'quiz',
    orderIndex,
    type: 'single_choice',
    prompt,
    mediaId: null,
    media: null,
    answerExplanation: null,
    backgroundMediaId: null,
    backgroundMedia: null,
    backgroundGradient: null,
    textTone: 'light',
    textOutline: true,
    timeLimitS: 20,
    revealDelayS: null,
    pointsMode: 'standard',
    numericValue: null,
    numericTolerance: null,
    createdAt: now,
    updatedAt: now,
    options: [
      {
        id: `${id}-a`,
        questionId: id,
        orderIndex: 0,
        text: 'A',
        mediaId: null,
        media: null,
        color: 'red',
        shape: 'triangle',
        isCorrect: true,
        correctOrderIndex: null,
      },
      {
        id: `${id}-b`,
        questionId: id,
        orderIndex: 1,
        text: 'B',
        mediaId: null,
        media: null,
        color: 'blue',
        shape: 'diamond',
        isCorrect: false,
        correctOrderIndex: null,
      },
    ],
    acceptedAnswers: [],
  });
  return {
    id: 'quiz',
    ownerId: 'o',
    title: 'T',
    description: null,
    coverMediaId: null,
    status: 'ready',
    language: 'en',
    questionCount: 2,
    feedbackEnabled: true,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    questions: [question('q1', 0, 'One?'), question('q2', 1, 'Two?')],
    slides: [],
    ...over,
  } as unknown as QuizWithContent;
}

describe('refreshSnapshotForm', () => {
  it('keeps the substance frozen and takes the form from the editor', () => {
    const frozen = buildSnapshot(quiz());
    const edited = quiz();
    // Substance edits (must not leak): prompt, right answer, timing, points, a new question, reordering.
    edited.questions[0].prompt = 'One, edited?';
    edited.questions[0].options[0].isCorrect = false;
    edited.questions[0].options[1].isCorrect = true;
    edited.questions[0].timeLimitS = 5;
    edited.questions[0].pointsMode = 'double';
    edited.questions.reverse();
    edited.questions.push({ ...edited.questions[0], id: 'q3', prompt: 'Three?' });
    // Form edits (must apply): background, contrast, explanation, reveal delay, feedback.
    edited.questions.find((q) => q.id === 'q1')!.backgroundGradient = {
      angle: 90,
      colors: ['#000000', '#ffffff'],
    };
    edited.questions.find((q) => q.id === 'q1')!.textTone = 'dark';
    edited.questions.find((q) => q.id === 'q1')!.textOutline = false;
    edited.questions.find((q) => q.id === 'q1')!.answerExplanation = 'Because.';
    edited.questions.find((q) => q.id === 'q1')!.revealDelayS = 9;
    edited.feedbackEnabled = false;

    const refreshed = refreshSnapshotForm(frozen, edited);
    expect(refreshed.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    const q1 = refreshed.questions[0];
    expect(q1).toMatchObject({
      prompt: 'One?',
      timeLimitS: 20,
      basePoints: frozen.questions[0].basePoints,
      background: { gradient: { angle: 90, colors: ['#000000', '#ffffff'] } },
      textTone: 'dark',
      textOutline: false,
      answerExplanation: 'Because.',
      revealDelayS: 9,
    });
    expect(q1.options.map((o) => o.isCorrect)).toEqual([true, false]);
    expect(refreshed.feedbackEnabled).toBe(false);
  });

  it('rebuilds the slides from the editor, anchored on the frozen question order', () => {
    const frozen = buildSnapshot(quiz());
    const edited = quiz({
      slides: [
        {
          id: 's-end',
          quizId: 'quiz',
          beforeQuestionId: null,
          orderIndex: 0,
          blocks: [{ type: 'heading', id: 'h', text: 'Bye', level: 1 }],
          mediaId: null,
          media: null,
          gradient: null,
          displayDelayS: 0,
          textTone: 'light',
          textOutline: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 's-q2',
          quizId: 'quiz',
          beforeQuestionId: 'q2',
          orderIndex: 0,
          blocks: [{ type: 'heading', id: 'h', text: 'Before two', level: 1 }],
          mediaId: null,
          media: null,
          gradient: null,
          displayDelayS: null,
          textTone: 'light',
          textOutline: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as unknown as QuizWithContent['slides'],
    });
    // The editor reordered the questions; the live order is the frozen one, so the slide keeps anchoring on q2 = index 1.
    edited.questions.reverse();
    const refreshed = refreshSnapshotForm(frozen, edited);
    expect(refreshed.slides.map((s) => [s.id, s.beforeQuestionIndex])).toEqual([
      ['s-q2', 1],
      ['s-end', 2],
    ]);
  });

  it('keeps a question the editor deleted', () => {
    const frozen = buildSnapshot(quiz());
    const edited = quiz();
    edited.questions.splice(1, 1);
    const refreshed = refreshSnapshotForm(frozen, edited);
    expect(refreshed.questions).toHaveLength(2);
    expect(refreshed.questions[1]).toEqual(frozen.questions[1]);
  });
});
