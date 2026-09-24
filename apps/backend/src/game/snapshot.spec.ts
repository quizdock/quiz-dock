import {
  buildQuestionStart,
  buildSnapshot,
  gameAudioTarget,
  refreshSnapshotForm,
  type QuizWithContent,
} from './snapshot';

/** Construit un quiz Prisma minimal (champs utiles au snapshot uniquement). */
const quiz = (over: Partial<QuizWithContent> = {}): QuizWithContent =>
  ({
    id: 'quiz1',
    title: 'Mon quiz',
    language: 'fr',
    questions: [],
    slides: [],
    ...over,
  }) as QuizWithContent;

const baseQuestion = {
  id: 'q1',
  orderIndex: 0,
  prompt: 'Q ?',
  visualMedia: null,
  audioMedia: null,
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
            visualMedia: { url: '/media/x', kind: 'image' },
            numericValue: { toString: () => '42' } as never, // simulate Prisma.Decimal
            numericTolerance: { toString: () => '0.5' } as never,
          },
        ] as never,
      }),
    );
    const q = snap.questions[0];
    expect(q.media).toEqual({
      visual: { kind: 'image', url: '/media/x', alt: null },
      audio: null,
    });
    expect(q.numericValue).toBe(42);
    expect(q.numericTolerance).toBe(0.5);
  });

  it('embarque le texte alternatif du média, que les écrans lisent (#43)', () => {
    const snap = buildSnapshot(
      quiz({
        questions: [
          {
            ...baseQuestion,
            type: 'single_choice',
            pointsMode: 'standard',
            visualMedia: { url: '/media/x', kind: 'image', alt: 'Le port de Rotterdam' },
            options: [
              {
                id: 'o1',
                text: 'Oui',
                color: 'red',
                shape: 'triangle',
                media: null,
                isCorrect: true,
                correctOrderIndex: null,
              },
            ],
          },
        ] as never,
      }),
    );
    expect(snap.questions[0].media.visual).toEqual({
      kind: 'image',
      url: '/media/x',
      alt: 'Le port de Rotterdam',
    });
  });

  it('carries an audio track with its waveform and the gain it plays at', () => {
    const peaks = new Array(200).fill(0.4);
    const audio = { url: '/media/a', kind: 'audio', durationMs: 8000, peaks };
    const snap = buildSnapshot(
      quiz({
        questions: [
          {
            ...baseQuestion,
            type: 'poll',
            pointsMode: 'none',
            visualMedia: { url: '/media/x', kind: 'image', alt: null },
            audioMedia: { ...audio, loudnessLufs: -23, peakDbfs: -12 },
            waveformSize: 'L',
          },
        ] as never,
      }),
    );
    expect(snap.questions[0].media.audio).toEqual({
      url: '/media/a',
      durationMs: 8000,
      peaks,
      gainDb: 7,
      size: 'L',
    });
  });

  it('stretches a question whose sound outlasts its timer, keeping the quiz’s pause after it', () => {
    const peaks = new Array(200).fill(0.4);
    const snap = buildSnapshot(
      quiz({
        mediaTailS: 3,
        questions: [
          {
            ...baseQuestion,
            type: 'poll',
            pointsMode: 'none',
            timeLimitS: 20,
            audioMedia: { url: '/media/a', kind: 'audio', durationMs: 42_000, peaks },
          },
          { ...baseQuestion, id: 'q2', type: 'poll', pointsMode: 'none', timeLimitS: 20 },
        ],
      } as never),
    );
    // Starts 3 s before the answers open (read delay), 42 s long, +3 s → 42 s of answering.
    expect(snap.questions[0].timeLimitS).toBe(42);
    expect(snap.questions[1].timeLimitS).toBe(20);
  });

  it('brings sounds to the quiz’s level', () => {
    const peaks = new Array(200).fill(0.4);
    const snap = buildSnapshot(
      quiz({
        loudnessTargetLufs: -23,
        questions: [
          {
            ...baseQuestion,
            type: 'poll',
            pointsMode: 'none',
            audioMedia: {
              url: '/a',
              kind: 'audio',
              durationMs: 1000,
              peaks,
              loudnessLufs: -18,
              peakDbfs: -6,
            },
          },
        ],
      } as never),
    );
    expect(snap.questions[0].media.audio?.gainDb).toBe(-5);
  });

  it('tells who hears a question: its own target, else the host’s lobby choice, else the quiz’s', () => {
    const peaks = new Array(200).fill(0.4);
    const sound = { url: '/a', kind: 'audio', durationMs: 1000, peaks };
    const snap = buildSnapshot(
      quiz({
        audioTarget: 'projection',
        questions: [
          { ...baseQuestion, type: 'poll', pointsMode: 'none', audioMedia: sound },
          {
            ...baseQuestion,
            id: 'q2',
            type: 'poll',
            pointsMode: 'none',
            audioMedia: sound,
            audioTarget: 'everyone',
          },
          { ...baseQuestion, id: 'q3', type: 'poll', pointsMode: 'none' },
        ],
      } as never),
    );
    const start = (i: number, lobby: 'projection_remote' | '') =>
      buildQuestionStart(snap.questions[i], i, 0, 0, gameAudioTarget(snap, lobby));
    expect(start(0, '').audioTarget).toBe('projection');
    expect(start(0, 'projection_remote').audioTarget).toBe('projection_remote');
    // A question's own choice wins over the host's.
    expect(start(1, 'projection_remote').audioTarget).toBe('everyone');
    // Nothing to hear, nothing said.
    expect(start(2, '')).not.toHaveProperty('audioTarget');
    // Older snapshots, without the field: the default.
    expect(gameAudioTarget({ ...snap, audioTarget: undefined }, '')).toBe('projection_remote');
  });

  it('follows the editor’s audio targets in a running game', () => {
    const sound = { url: '/a', kind: 'audio', durationMs: 1000, peaks: new Array(200).fill(0) };
    const q = { ...baseQuestion, type: 'poll', pointsMode: 'none', audioMedia: sound };
    const frozen = buildSnapshot(quiz({ questions: [q] } as never));
    const edited = quiz({
      audioTarget: 'everyone',
      questions: [{ ...q, audioTarget: 'projection' }],
    } as never);
    const fresh = refreshSnapshotForm(frozen, edited);
    expect(fresh.audioTarget).toBe('everyone');
    expect(fresh.questions[0].audioTarget).toBe('projection');
  });

  it('plays a video with its own gain', () => {
    const snap = buildSnapshot(
      quiz({
        questions: [
          {
            ...baseQuestion,
            type: 'poll',
            pointsMode: 'none',
            visualMedia: { url: '/media/v', kind: 'video', loudnessLufs: -10, peakDbfs: -1 },
          },
        ] as never,
      }),
    );
    expect(snap.questions[0].media).toEqual({
      visual: { kind: 'video', source: 'upload', url: '/media/v', gainDb: -6 },
      audio: null,
    });
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

  it('slides (#7): anchored on question indexes, end when unanchored, sorted by anchor then order', () => {
    const q = (id: string, orderIndex: number) => ({
      ...baseQuestion,
      id,
      orderIndex,
      type: 'single_choice',
      pointsMode: 'standard',
    });
    const slide = (id: string, beforeQuestionId: string | null, orderIndex: number) => ({
      id,
      beforeQuestionId,
      orderIndex,
      blocks: [{ type: 'heading', id: 'h', text: id, level: 1 }],
      media: null,
      displayDelayS: null,
      textTone: 'light',
      textOutline: false,
    });
    const snap = buildSnapshot(
      quiz({
        questions: [q('qa', 0), q('qb', 1)] as never,
        slides: [
          slide('end-1', null, 1),
          slide('before-b', 'qb', 0),
          slide('end-0', null, 0),
          slide('before-a', 'qa', 0),
          slide('orphan', 'gone', 0), // deleted anchor → end
        ] as never,
      }),
    );
    expect(snap.slides.map((s) => [s.id, s.beforeQuestionIndex])).toEqual([
      ['before-a', 0],
      ['before-b', 1],
      ['end-0', 2],
      ['orphan', 2],
      ['end-1', 2],
    ]);
  });

  it('slides (#7): image blocks get their served URL, columns included; the background keeps its url', () => {
    const snap = buildSnapshot(
      quiz({
        questions: [] as never,
        slides: [
          {
            id: 's',
            beforeQuestionId: null,
            orderIndex: 0,
            blocks: [
              { type: 'image', id: 'i1', mediaId: 'M1', size: 'large', align: 'center' },
              {
                type: 'columns',
                id: 'c',
                columns: [
                  [{ type: 'image', id: 'i2', mediaId: 'M2', size: 'full', align: 'left' }],
                  [{ type: 'text', id: 't', md: 'hi' }],
                ],
              },
            ],
            media: { url: '/api/v1/media/BG', kind: 'image' },
            displayDelayS: null,
            textTone: 'dark',
            textOutline: true,
          },
        ] as never,
      }),
    );
    const [img, cols] = snap.slides[0].blocks;
    expect(img).toMatchObject({ type: 'image', url: '/api/v1/media/M1' });
    expect(cols.type === 'columns' && cols.columns[0][0]).toMatchObject({
      url: '/api/v1/media/M2',
    });
    expect(snap.slides[0].background).toEqual({ url: '/api/v1/media/BG' });
    expect(snap.slides[0]).toMatchObject({ textTone: 'dark', textOutline: true });
  });
});
