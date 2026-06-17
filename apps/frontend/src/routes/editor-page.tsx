import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  MonitorPlay,
  Pencil,
  Play,
  Plus,
  Radio,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { createSession } from '../game/game-client';
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

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  ready: 'Prêt',
  archived: 'Archivé',
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
  const [livePin, setLivePin] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [presentError, setPresentError] = useState<string | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getQuizzesControllerGetQueryKey(quiz.id) }),
      queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() }),
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

  const onPresent = async () => {
    setPresentError(null);
    setPresenting(true);
    try {
      const { pin } = await createSession(quiz.id);
      setLivePin(pin);
    } catch (e) {
      setPresentError(e instanceof Error ? e.message : 'Échec du lancement de la partie.');
    } finally {
      setPresenting(false);
    }
  };

  const onDeleteQuiz = async () => {
    await removeQuiz.mutateAsync({ id: quiz.id });
    await queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });
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
      data: { items: next.map((q, idx) => ({ questionId: q.id, orderIndex: idx })) },
    });
    await invalidate();
  };

  const statusVariant =
    quiz.status === 'ready' ? 'success' : quiz.status === 'archived' ? 'muted' : 'default';

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* En-tête */}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Éditeur de quiz</h1>
        <Badge variant={statusVariant}>{STATUS_LABEL[quiz.status] ?? quiz.status}</Badge>
        <a
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
          href={`/quizzes/${quiz.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="size-4" />
          Aperçu
        </a>
      </header>

      {/* Réglages du quiz */}
      <Card>
        <CardHeader>
          <CardTitle>Réglages</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
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
        </CardContent>
      </Card>

      {/* Diffusion */}
      <Card>
        <CardHeader>
          <CardTitle>Diffusion</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
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
                {!livePin && (
                  <Button type="button" disabled={presenting} onClick={() => void onPresent()}>
                    <Play className="size-4" />
                    {presenting ? 'Lancement…' : 'Présenter'}
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => void changeStatus('draft')}>
                  Repasser en brouillon
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void changeStatus('archived')}
                >
                  Archiver
                </Button>
              </>
            )}
            {quiz.status === 'archived' && (
              <Button type="button" variant="outline" onClick={() => void changeStatus('draft')}>
                Restaurer
              </Button>
            )}
          </div>
          {presentError ? <p className="text-destructive text-sm">{presentError}</p> : null}
          {livePin ? <GameAccessPanel pin={livePin} /> : null}
        </CardContent>
      </Card>

      {/* Questions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Questions ({quiz.questionCount})</CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing('new')}
            disabled={editing === 'new'}
          >
            <Plus className="size-4" />
            Ajouter
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing === 'new' && <QuestionForm quizId={quiz.id} onClose={() => setEditing(null)} />}

          <ul className="flex flex-col gap-2">
            {quiz.questions.map((q, i) =>
              editing === q.id ? (
                <li key={q.id}>
                  <QuestionForm quizId={quiz.id} question={q} onClose={() => setEditing(null)} />
                </li>
              ) : (
                <li
                  key={q.id}
                  className="bg-card flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                >
                  <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{q.prompt}</p>
                    <p className="text-muted-foreground text-xs">{TYPE_LABEL[q.type] ?? q.type}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Monter"
                    disabled={i === 0 || reorder.isPending}
                    onClick={() => void moveQuestion(i, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Descendre"
                    disabled={i === quiz.questions.length - 1 || reorder.isPending}
                    onClick={() => void moveQuestion(i, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(q.id)}
                  >
                    <Pencil className="size-4" />
                    Éditer
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Supprimer"
                    onClick={() => void onDeleteQuestion(q.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ),
            )}
            {quiz.questions.length === 0 && editing !== 'new' && (
              <li className="text-muted-foreground py-4 text-center text-sm">
                Aucune question. Ajoutez-en une !
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Zone dangereuse */}
      <div className="flex justify-end border-t pt-4">
        <Button type="button" variant="destructive" onClick={() => void onDeleteQuiz()}>
          <Trash2 className="size-4" />
          Supprimer le quiz
        </Button>
      </div>
    </section>
  );
}

/**
 * Panneau de partie en cours (§4.1) : trois accès indépendants, ouvrables sur des
 * postes différents. Contrôle = même onglet (pilotage) ; projection & invitation =
 * nouvelles fenêtres (grand écran / lien participants).
 */
function GameAccessPanel({ pin }: { pin: string }) {
  const open = (path: string) => window.open(path, '_blank', 'noopener,noreferrer');
  return (
    <div className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Radio className="text-primary size-4" />
        <span>
          Partie en cours — PIN <strong className="font-mono tracking-widest">{pin}</strong>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/present/$pin/control"
          params={{ pin }}
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          <MonitorPlay className="size-4" />
          Écran de contrôle
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => open(`/present/${pin}/screen`)}
        >
          <Eye className="size-4" />
          Écran de projection
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => open(`/join/${pin}`)}>
          <Users className="size-4" />
          Écran d’invitation
        </Button>
      </div>
    </div>
  );
}
