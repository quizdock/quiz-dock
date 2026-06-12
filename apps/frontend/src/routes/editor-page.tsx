import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { QuizDetailDto } from '../api/generated/model';
import { QuestionForm } from './question-form';
import {
  getQuizzesControllerGetQueryKey,
  getQuizzesControllerListQueryKey,
  useQuizzesControllerGet,
  useQuizzesControllerRemove,
  useQuizzesControllerTransition,
  useQuizzesControllerUpdate,
} from '../api/generated/quizzes/quizzes';
import { useQuestionsControllerRemove } from '../api/generated/questions/questions';
import { editorRoute } from '../router';

const TYPE_LABEL: Record<string, string> = {
  single_choice: 'QCM (réponse unique)',
  multiple_choice: 'QCM (multi-réponses)',
  true_false: 'Vrai / Faux',
  text_input: 'Saisie texte',
  numeric: 'Numérique',
  ordering: 'Remise en ordre',
  poll: 'Sondage',
};

export function EditorPage() {
  const { quizId } = editorRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerGet(quizId);

  if (isLoading) return <p>Chargement…</p>;
  if (error || !data) return <p className="error">Quiz introuvable.</p>;
  return <QuizEditor quiz={data.data} />;
}

function QuizEditor({ quiz }: { quiz: QuizDetailDto }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useQuizzesControllerUpdate();
  const transition = useQuizzesControllerTransition();
  const removeQuiz = useQuizzesControllerRemove();
  const removeQuestion = useQuestionsControllerRemove();
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: getQuizzesControllerGetQueryKey(quiz.id),
      }),
      queryClient.invalidateQueries({
        queryKey: getQuizzesControllerListQueryKey(),
      }),
    ]);

  const form = useForm({
    defaultValues: {
      title: quiz.title,
      description: quiz.description ?? '',
      language: quiz.language,
    },
    onSubmit: async ({ value }) => {
      await update.mutateAsync({
        id: quiz.id,
        data: {
          title: value.title,
          description: value.description || null,
          language: value.language,
        },
      });
      await invalidate();
    },
  });

  const changeStatus = async (status: 'draft' | 'ready' | 'archived') => {
    await transition.mutateAsync({ id: quiz.id, data: { status } });
    await invalidate();
  };

  const onDeleteQuiz = async () => {
    await removeQuiz.mutateAsync({ id: quiz.id });
    await queryClient.invalidateQueries({
      queryKey: getQuizzesControllerListQueryKey(),
    });
    void navigate({ to: '/dashboard' });
  };

  const onDeleteQuestion = async (qid: string) => {
    await removeQuestion.mutateAsync({ qid });
    await invalidate();
  };

  return (
    <section className="editor">
      <div className="editor-head">
        <h1>Éditeur de quiz</h1>
        <span className={`badge badge-${quiz.status}`}>{quiz.status}</span>
        <a
          className="preview-link"
          href={`/quizzes/${quiz.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Aperçu ↗
        </a>
      </div>

      <form
        className="quiz-meta"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="title">
          {(field) => (
            <label>
              Titre
              <input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <label>
              Description
              <textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        </form.Field>
        <button type="submit" disabled={update.isPending}>
          Enregistrer
        </button>
      </form>

      <div className="lifecycle">
        {quiz.status === 'draft' && (
          <button
            type="button"
            disabled={quiz.questionCount === 0 || transition.isPending}
            onClick={() => void changeStatus('ready')}
          >
            Publier (prêt)
          </button>
        )}
        {quiz.status === 'ready' && (
          <>
            <button type="button" onClick={() => void changeStatus('draft')}>
              Repasser en brouillon
            </button>
            <button type="button" onClick={() => void changeStatus('archived')}>
              Archiver
            </button>
          </>
        )}
        {quiz.status === 'archived' && (
          <button type="button" onClick={() => void changeStatus('draft')}>
            Restaurer
          </button>
        )}
        <button type="button" className="danger" onClick={() => void onDeleteQuiz()}>
          Supprimer le quiz
        </button>
      </div>

      <div className="questions-head">
        <h2>Questions ({quiz.questionCount})</h2>
        <button type="button" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          Ajouter une question
        </button>
      </div>

      {editing === 'new' && <QuestionForm quizId={quiz.id} onClose={() => setEditing(null)} />}

      <ul className="question-list">
        {quiz.questions.map((q, i) =>
          editing === q.id ? (
            <li key={q.id}>
              <QuestionForm quizId={quiz.id} question={q} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <li key={q.id} className="question-row">
              <span className="q-index">{i + 1}</span>
              <span className="q-type">{TYPE_LABEL[q.type] ?? q.type}</span>
              <span className="q-prompt">{q.prompt}</span>
              <button type="button" onClick={() => setEditing(q.id)}>
                Éditer
              </button>
              <button type="button" onClick={() => void onDeleteQuestion(q.id)}>
                Supprimer
              </button>
            </li>
          ),
        )}
        {quiz.questions.length === 0 && editing !== 'new' && (
          <li className="empty">Aucune question. Ajoutez-en une !</li>
        )}
      </ul>
    </section>
  );
}
