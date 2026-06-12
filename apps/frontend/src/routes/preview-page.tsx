import { useState } from 'react';
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

  if (isLoading) return <p>Chargement…</p>;
  if (error || !data) return <p className="error">Quiz introuvable.</p>;
  return <QuizPreview quiz={data.data} />;
}

function QuizPreview({ quiz }: { quiz: QuizDetailDto }) {
  const [index, setIndex] = useState(0);
  const total = quiz.questions.length;

  return (
    <section className="preview">
      <header className="preview-head">
        <span>Aperçu (vue apprenant)</span>
        <strong>{quiz.title}</strong>
      </header>

      {total === 0 ? (
        <p className="empty">Ce quiz n’a pas encore de question.</p>
      ) : (
        <>
          <QuestionPreview question={quiz.questions[index]} />
          <nav className="preview-nav">
            <button type="button" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              ← Précédent
            </button>
            <span>
              Question {index + 1} / {total}
            </span>
            <button
              type="button"
              disabled={index >= total - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              Suivant →
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

function QuestionPreview({ question }: { question: QuizDetailDtoQuestionsItem }) {
  return (
    <article className="preview-card">
      <div className="preview-type">{TYPE_LABEL[question.type] ?? question.type}</div>
      {question.mediaId && (
        <img className="preview-media" src={`/api/v1/media/${question.mediaId}`} alt="" />
      )}
      <h2 className="preview-prompt">{question.prompt}</h2>
      <div className="preview-time">⏱ {question.timeLimitS} s</div>

      {question.options.length > 0 && (
        <ul className="preview-options">
          {question.options.map((opt) => (
            <li
              key={opt.id}
              className={`preview-option color-${opt.color}${opt.isCorrect ? ' is-correct' : ''}`}
            >
              <span className="glyph" aria-hidden="true">
                {SHAPE_GLYPH[opt.shape] ?? '◆'}
              </span>
              <span className="opt-text">{opt.text ?? `Option ${opt.orderIndex + 1}`}</span>
              {question.type === 'ordering' && opt.correctOrderIndex != null && (
                <span className="opt-rank">#{opt.correctOrderIndex + 1}</span>
              )}
              {opt.isCorrect && (
                <span className="opt-correct" aria-label="bonne réponse">
                  ✓
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {question.acceptedAnswers.length > 0 && (
        <div className="preview-answers">
          Réponses acceptées : {question.acceptedAnswers.map((a) => a.text).join(', ')}
        </div>
      )}

      {question.type === 'numeric' && question.numericValue != null && (
        <div className="preview-answers">
          Cible : {question.numericValue} (± {question.numericTolerance ?? 0})
        </div>
      )}
    </article>
  );
}
