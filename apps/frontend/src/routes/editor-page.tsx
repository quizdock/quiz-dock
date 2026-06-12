import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
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
import {
  useQuestionsControllerRemove,
  useQuestionsControllerReorder,
} from '../api/generated/questions/questions';
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

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">Quiz introuvable.</p>;
  return <QuizEditor quiz={data.data} />;
}

function QuizEditor({ quiz }: { quiz: QuizDetailDto }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useQuizzesControllerUpdate();
  const transition = useQuizzesControllerTransition();
  const removeQuiz = useQuizzesControllerRemove();
  const removeQuestion = useQuestionsControllerRemove();
  const reorder = useQuestionsControllerReorder();
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

  const moveQuestion = async (index: number, direction: -1 | 1) => {
    const next = [...quiz.questions];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await reorder.mutateAsync({
      id: quiz.id,
      data: {
        items: next.map((q, idx) => ({ questionId: q.id, orderIndex: idx })),
      },
    });
    await invalidate();
  };

  const statusVariant =
    quiz.status === 'ready' ? 'success' : quiz.status === 'archived' ? 'muted' : 'default';

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Éditeur de quiz</h1>
        <Badge variant={statusVariant}>{quiz.status}</Badge>
        <a
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
          href={`/quizzes/${quiz.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="size-4" />
          Aperçu
        </a>
      </div>

      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="title">
          {(field) => (
            <Label>
              Titre
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Label>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Label>
              Description
              <Textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Label>
          )}
        </form.Field>
        <Button type="submit" disabled={update.isPending} className="self-start">
          <Save className="size-4" />
          Enregistrer
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-y py-3">
        {quiz.status === 'draft' && (
          <Button
            type="button"
            disabled={quiz.questionCount === 0 || transition.isPending}
            onClick={() => void changeStatus('ready')}
          >
            Publier (prêt)
          </Button>
        )}
        {quiz.status === 'ready' && (
          <>
            <Button type="button" variant="outline" onClick={() => void changeStatus('draft')}>
              Repasser en brouillon
            </Button>
            <Button type="button" variant="outline" onClick={() => void changeStatus('archived')}>
              Archiver
            </Button>
          </>
        )}
        {quiz.status === 'archived' && (
          <Button type="button" variant="outline" onClick={() => void changeStatus('draft')}>
            Restaurer
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          className="ml-auto"
          onClick={() => void onDeleteQuiz()}
        >
          <Trash2 className="size-4" />
          Supprimer le quiz
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Questions ({quiz.questionCount})</h2>
        <Button type="button" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          <Plus className="size-4" />
          Ajouter une question
        </Button>
      </div>

      {editing === 'new' && <QuestionForm quizId={quiz.id} onClose={() => setEditing(null)} />}

      <ul className="flex flex-col gap-2">
        {quiz.questions.map((q, i) =>
          editing === q.id ? (
            <li key={q.id}>
              <QuestionForm quizId={quiz.id} question={q} onClose={() => setEditing(null)} />
            </li>
          ) : (
            <li key={q.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="font-bold text-muted-foreground">{i + 1}</span>
              <span className="text-sm text-muted-foreground">{TYPE_LABEL[q.type] ?? q.type}</span>
              <span className="flex-1">{q.prompt}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Monter"
                disabled={i === 0 || reorder.isPending}
                onClick={() => void moveQuestion(i, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Descendre"
                disabled={i === quiz.questions.length - 1 || reorder.isPending}
                onClick={() => void moveQuestion(i, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(q.id)}>
                <Pencil className="size-4" />
                Éditer
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void onDeleteQuestion(q.id)}
              >
                <Trash2 className="size-4" />
                Supprimer
              </Button>
            </li>
          ),
        )}
        {quiz.questions.length === 0 && editing !== 'new' && (
          <li className="text-muted-foreground">Aucune question. Ajoutez-en une !</li>
        )}
      </ul>
    </section>
  );
}
