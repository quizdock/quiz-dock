import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'muted'> = {
  draft: 'default',
  ready: 'success',
  archived: 'muted',
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
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mes quiz</h1>
        <Button type="button" onClick={onCreate} disabled={create.isPending}>
          <Plus className="size-4" />
          Nouveau quiz
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Chargement…</p>}
      {error ? <p className="text-destructive">Impossible de charger les quiz.</p> : null}

      {!isLoading && !error && quizzes.length === 0 && (
        <p className="text-muted-foreground">Aucun quiz pour l’instant. Créez-en un !</p>
      )}

      <ul className="flex flex-col gap-2">
        {quizzes.map((quiz) => (
          <li key={quiz.id}>
            <Link
              to="/quizzes/$quizId"
              params={{ quizId: quiz.id }}
              className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-accent"
            >
              <span className="flex-1 font-semibold">{quiz.title}</span>
              <Badge variant={STATUS_VARIANT[quiz.status] ?? 'default'}>
                {STATUS_LABEL[quiz.status] ?? quiz.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {quiz.questionCount} question(s)
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
