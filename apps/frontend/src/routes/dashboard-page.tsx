import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  getQuizzesControllerListQueryKey,
  useQuizzesControllerCreate,
  useQuizzesControllerList,
} from '../api/generated/quizzes/quizzes';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  ready: 'Prêt',
  archived: 'Archivé',
};

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuizzesControllerList();
  const create = useQuizzesControllerCreate();
  const quizzes = data?.data ?? [];

  const onCreate = () => {
    create.mutate(
      { data: { title: 'Nouveau quiz', language: 'fr' } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: getQuizzesControllerListQueryKey(),
          }),
      },
    );
  };

  return (
    <section className="dashboard">
      <div className="dashboard-head">
        <h1>Mes quiz</h1>
        <button type="button" onClick={onCreate} disabled={create.isPending}>
          Nouveau quiz
        </button>
      </div>

      {isLoading && <p>Chargement…</p>}
      {error ? <p className="error">Impossible de charger les quiz.</p> : null}

      {!isLoading && !error && quizzes.length === 0 && (
        <p className="empty">Aucun quiz pour l’instant. Créez-en un !</p>
      )}

      <ul className="quiz-list">
        {quizzes.map((quiz) => (
          <li key={quiz.id} className="quiz-card">
            <Link to="/quizzes/$quizId" params={{ quizId: quiz.id }} className="quiz-title">
              {quiz.title}
            </Link>
            <span className={`badge badge-${quiz.status}`}>
              {STATUS_LABEL[quiz.status] ?? quiz.status}
            </span>
            <span className="quiz-count">{quiz.questionCount} question(s)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
