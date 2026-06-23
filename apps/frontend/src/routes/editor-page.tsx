import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Eye,
  History,
  MonitorPlay,
  Pencil,
  Play,
  Plus,
  Radio,
  Save,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  useQuizzesControllerFeedback,
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Capture intégrale (§2.10) : conserve le détail des réponses par participant.
  // Décidée avant le lancement de la partie (fige le snapshot côté serveur).
  const [fullCapture, setFullCapture] = useState(false);

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
      form.reset(value); // valeurs enregistrées = nouvelle base « propre » → bouton inactif
    },
  });

  // Le bouton « Enregistrer » n'est actif que si une modification est en cours.
  const isDirty = useStore(form.store, (s) => s.isDirty);

  const changeStatus = async (status: 'draft' | 'ready' | 'archived') => {
    await transition.mutateAsync({ id: quiz.id, data: { status } });
    await invalidate();
  };

  const onPresent = async () => {
    setPresentError(null);
    setPresenting(true);
    try {
      const { pin } = await createSession(quiz.id, fullCapture);
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
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* En-tête */}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Éditeur de quiz</h1>
        <Badge variant={statusVariant}>{STATUS_LABEL[quiz.status] ?? quiz.status}</Badge>
        <Link
          to="/quizzes/$quizId/sessions"
          params={{ quizId: quiz.id }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}
        >
          <History className="size-4" />
          Historique
        </Link>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" />
          Supprimer le quiz
        </Button>
        <a
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          href={`/quizzes/${quiz.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="size-4" />
          Aperçu
        </a>
      </header>

      {/* Mise en page responsive (grille unique, `order-*` pour le placement mobile) :
          • mobile (1 col)   : Réglages → Questions → Diffusion → Avis
          • tablette (2 col) : Réglages pleine largeur, Questions pleine largeur,
                               puis Diffusion + Avis côte à côte
          • desktop (3 col)  : colonne latérale Réglages/Diffusion/Avis + Questions à droite
          `min-w-0` sur chaque cellule : un contenu large ne déborde plus horizontalement. */}
      <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Réglages du quiz — `lg:col-span-1` annule le `sm:col-span-2` (sinon il
            déborderait sur la colonne des Questions au desktop). */}
        <Card className="order-1 min-w-0 sm:col-span-2 lg:col-span-1 lg:col-start-1 lg:row-start-1">
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
                      rows={4}
                      className="lg:min-h-48"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </Label>
                )}
              </form.Field>
              <Button type="submit" disabled={!isDirty || update.isPending} className="self-start">
                <Save className="size-4" />
                Enregistrer
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Diffusion */}
        <Card className="order-3 min-w-0 lg:col-start-1 lg:row-start-2">
          <CardHeader>
            <CardTitle>Diffusion</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {quiz.status === 'ready' && !livePin ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={fullCapture}
                  onChange={(e) => setFullCapture(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Capture intégrale des réponses</span>
                  <span className="text-muted-foreground block">
                    Conserve le détail des réponses de chaque participant (suivi de formation). À
                    activer avant de présenter.
                  </span>
                </span>
              </label>
            ) : null}
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
                    <Button
                      type="button"
                      variant="main-action"
                      disabled={presenting}
                      onClick={() => void onPresent()}
                    >
                      <Play className="size-4" />
                      {presenting ? 'Lancement…' : 'Présenter'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void changeStatus('draft')}
                  >
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

        {/* Avis des joueurs (§2.11) — visible du seul propriétaire. */}
        <FeedbackCard quizId={quiz.id} className="order-4 min-w-0 lg:col-start-1 lg:row-start-3" />

        {/* Questions (zone de travail principale) — remontée au-dessus de
            Diffusion/Avis sur mobile et tablette via `order-2`. */}
        <Card className="order-2 min-w-0 sm:col-span-2 lg:col-span-2 lg:col-start-2 lg:row-span-3 lg:row-start-1">
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
            {editing === 'new' && (
              <QuestionForm quizId={quiz.id} onClose={() => setEditing(null)} />
            )}

            <ul className="flex flex-col gap-2">
              {quiz.questions.map((q, i) =>
                editing === q.id ? (
                  <li key={q.id}>
                    <QuestionForm quizId={quiz.id} question={q} onClose={() => setEditing(null)} />
                  </li>
                ) : (
                  <li
                    key={q.id}
                    className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent/40 sm:flex-nowrap sm:gap-3"
                  >
                    <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{q.prompt}</p>
                      <p className="text-muted-foreground text-xs">
                        {TYPE_LABEL[q.type] ?? q.type}
                      </p>
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
                      aria-label="Supprimer la question"
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
      </div>

      <ConfirmDialog
        open={confirmDelete}
        destructive
        title="Supprimer ce quiz ?"
        description={`« ${quiz.title} » et ses questions seront définitivement supprimés. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void onDeleteQuiz();
        }}
      />
    </section>
  );
}

/** Étoiles pleines/vides pour une note `value` sur 5. */
function StarRow({ value, size = 'size-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} sur 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={cn(
            size,
            i < value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}

/**
 * Avis des joueurs sur le quiz (§2.11) — réservé au propriétaire (l'endpoint refuse
 * les autres). Moyenne, nombre et liste des commentaires (récents d'abord).
 */
function FeedbackCard({ quizId, className }: { quizId: string; className?: string }) {
  const { data, isLoading } = useQuizzesControllerFeedback(quizId);
  const summary = data?.data;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Avis des joueurs</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? <p className="text-muted-foreground text-sm">Chargement…</p> : null}
        {summary && summary.count === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucun avis pour l’instant. Les joueurs peuvent noter le quiz en fin de partie.
          </p>
        ) : null}
        {summary && summary.count > 0 ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums">{summary.average.toFixed(1)}</span>
              <StarRow value={Math.round(summary.average)} size="size-5" />
              <span className="text-muted-foreground text-sm">{summary.count} avis</span>
            </div>
            <ul className="flex max-h-60 flex-col gap-2 overflow-auto">
              {summary.items.map((f) => (
                <li key={f.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{f.nickname}</span>
                    <StarRow value={f.rating} size="size-3.5" />
                  </div>
                  {f.comment ? <p className="text-muted-foreground mt-1">{f.comment}</p> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </CardContent>
    </Card>
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
