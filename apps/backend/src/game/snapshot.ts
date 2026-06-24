import { Prisma } from '@prisma/client';
import type {
  OptionColor,
  OptionShape,
  PointsMode,
  PublicOption,
  QuestionStartPayload,
  QuestionType,
} from '@live-quizz/contracts';
import { basePointsFor } from './scoring';
import type { QuizSnapshot, SnapshotQuestion } from './game.types';

/** Forme Prisma attendue par le constructeur de snapshot (relations incluses). */
const quizWithContent = Prisma.validator<Prisma.QuizDefaultArgs>()({
  include: {
    questions: {
      orderBy: { orderIndex: 'asc' },
      include: {
        media: true,
        options: { orderBy: { orderIndex: 'asc' }, include: { media: true } },
        acceptedAnswers: true,
      },
    },
  },
});
export type QuizWithContent = Prisma.QuizGetPayload<typeof quizWithContent>;
export const QUIZ_SNAPSHOT_INCLUDE = quizWithContent.include;

const mediaOf = (m: { url: string; kind: string } | null) =>
  m ? { url: m.url, kind: m.kind as 'image' | 'audio' } : null;

/**
 * Construit le snapshot serveur figé d'un quiz (SPECIFICATIONS §8). Fonction pure :
 * résout les points de base depuis `pointsMode`, embarque les bonnes réponses
 * (secret serveur) et les réponses texte normalisées. La boucle live ne touche
 * plus la base après cet appel.
 */
export function buildSnapshot(quiz: QuizWithContent): QuizSnapshot {
  return {
    quizId: quiz.id,
    title: quiz.title,
    description: quiz.description,
    language: quiz.language,
    questions: quiz.questions.map(
      (q): SnapshotQuestion => ({
        id: q.id,
        orderIndex: q.orderIndex,
        type: q.type as QuestionType,
        prompt: q.prompt,
        media: mediaOf(q.media),
        timeLimitS: q.timeLimitS,
        basePoints: basePointsFor(q.pointsMode as PointsMode),
        numericValue: q.numericValue === null ? null : Number(q.numericValue),
        numericTolerance: q.numericTolerance === null ? null : Number(q.numericTolerance),
        acceptedAnswersNormalized: q.acceptedAnswers.map((a) => a.normalized),
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          color: o.color as OptionColor,
          shape: o.shape as OptionShape,
          media: mediaOf(o.media),
          isCorrect: o.isCorrect,
          correctOrderIndex: o.correctOrderIndex,
        })),
      }),
    ),
  };
}

/**
 * Construit le payload public `question:start` (contrat §9) par **allowlist stricte**
 * (anti-triche §7) : on ne recopie QUE `{id,text,color,shape,media}` des options —
 * jamais `isCorrect`/`correctOrderIndex`, ni la cible numérique/réponses texte.
 * Le secret ne fuit pas par oubli de suppression : il n'est jamais ajouté.
 */
export function buildQuestionStart(
  question: SnapshotQuestion,
  questionIndex: number,
  startedAt: number,
  endsAt: number,
): QuestionStartPayload {
  const hasOptions = question.options.length > 0;
  const options: PublicOption[] | undefined = hasOptions
    ? question.options.map((o) => ({
        id: o.id,
        text: o.text,
        color: o.color,
        shape: o.shape,
        media: o.media,
      }))
    : undefined;
  return {
    questionIndex,
    type: question.type,
    prompt: question.prompt,
    media: question.media,
    options,
    timeLimitS: question.timeLimitS,
    basePoints: question.basePoints,
    startedAt,
    endsAt,
  };
}
