import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { QuizDetailDto, QuizDetailDtoQuestionsItem } from '../api/generated/model';
import { useQuizzesControllerGet } from '../api/generated/quizzes/quizzes';
import { previewRoute } from '../router';

/** Glyphe par forme (accessibilité couleur + forme, technique §4). */
const SHAPE_GLYPH: Record<string, string> = {
  triangle: '▲',
  diamond: '◆',
  circle: '●',
  square: '■',
};

/** Couleur de fond par option (vue apprenant). */
const COLOR_BG: Record<string, string> = {
  red: 'bg-red-600',
  blue: 'bg-blue-600',
  yellow: 'bg-amber-500',
  green: 'bg-green-600',
};

const TYPE_LABEL: Record<string, string> = {
  single_choice: 'QCM (réponse unique)',
  multiple_choice: 'QCM (multi-réponses)',
  true_false: 'Vrai / Faux',
  text_input: 'Saisie texte',
  numeric: 'Numérique',
  ordering: 'Remise en ordre',
  poll: 'Sondage',
};

export function PreviewPage() {
  const { quizId } = previewRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerGet(quizId);

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">Quiz introuvable.</p>;
  return <QuizPreview quiz={data.data} />;
}

function QuizPreview({ quiz }: { quiz: QuizDetailDto }) {
  const [index, setIndex] = useState(0);
  const total = quiz.questions.length;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex items-center justify-between border-b pb-2 text-muted-foreground">
        <span>Aperçu (vue apprenant)</span>
        <strong className="text-foreground">{quiz.title}</strong>
      </header>

      {total === 0 ? (
        <p className="text-muted-foreground">Ce quiz n’a pas encore de question.</p>
      ) : (
        <>
          <QuestionPreview question={quiz.questions[index]} />
          <nav className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              ← Précédent
            </Button>
            <span className="text-sm text-muted-foreground">
              Question {index + 1} / {total}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={index >= total - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              Suivant →
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

function QuestionPreview({ question }: { question: QuizDetailDtoQuestionsItem }) {
  return (
    <article className="flex flex-col gap-4 rounded-xl border p-4 sm:p-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {TYPE_LABEL[question.type] ?? question.type}
      </div>
      {question.mediaId && (
        <img
          className="max-h-56 self-center object-contain"
          src={`/api/v1/media/${question.mediaId}`}
          alt=""
        />
      )}
      <h2 className="text-xl font-semibold sm:text-2xl">{question.prompt}</h2>
      <div className="text-muted-foreground">⏱ {question.timeLimitS} s</div>

      {question.options.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {question.options.map((opt) => (
            <li
              key={opt.id}
              className={cn(
                'flex items-center gap-3 rounded-lg px-4 py-3 font-semibold text-white',
                COLOR_BG[opt.color] ?? 'bg-slate-600',
                opt.isCorrect && 'outline outline-2 outline-offset-2 outline-success',
              )}
            >
              <span className="text-lg" aria-hidden="true">
                {SHAPE_GLYPH[opt.shape] ?? '◆'}
              </span>
              <span className="flex-1">{opt.text ?? `Option ${opt.orderIndex + 1}`}</span>
              {question.type === 'ordering' && opt.correctOrderIndex != null && (
                <span className="rounded-full bg-black/25 px-2">#{opt.correctOrderIndex + 1}</span>
              )}
              {opt.isCorrect && <span aria-label="bonne réponse">✓</span>}
            </li>
          ))}
        </ul>
      )}

      {question.acceptedAnswers.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Réponses acceptées : {question.acceptedAnswers.map((a) => a.text).join(', ')}
        </div>
      )}

      {question.type === 'numeric' && question.numericValue != null && (
        <div className="text-sm text-muted-foreground">
          Cible : {question.numericValue} (± {question.numericTolerance ?? 0})
        </div>
      )}
    </article>
  );
}
