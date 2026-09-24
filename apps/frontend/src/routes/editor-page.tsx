import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  GripVertical,
  History,
  LayoutTemplate,
  MonitorPlay,
  MousePointerClick,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Radio,
  Save,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  AUDIO_TARGETS,
  type AudioTarget,
  LOUDNESS_TARGETS,
  type LoudnessTarget,
  MEDIA_TAIL_MAX_S,
} from '@quiz-dock/contracts';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { createSession } from '../game/game-client';
import { downloadFile } from '../api/download';
import { apiErrorText } from '../api/http';
import type { QuizDetailDto } from '../api/generated/model';
import { quizItems, moveItem, slideLabel, type QuizItem } from '@/lib/quiz-items';
import { useMediaQuery } from '@/lib/use-media-query';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store';
import { ChromiumNotice } from '@/components/chromium-notice';
import { DraftNotice } from '@/components/draft-notice';
import { Disclosure } from '@/components/ui/disclosure';
import { Drawer } from '@/components/ui/drawer';
import { QuestionForm } from './question-form';
import { SlideForm } from './slide-form';
import { StarRow } from './feedback-page';
import {
  useSlidesControllerRemove,
  useSlidesControllerReorderItems,
} from '../api/generated/slides/slides';
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
  getStoreControllerListQueryKey,
  useStoreControllerShare,
} from '../api/generated/store/store';
import { useGameControllerMine } from '../api/generated/games/games';
import { useQuestionsControllerRemove } from '../api/generated/questions/questions';
import { editorRoute } from '../router';

/**
 * The page has two columns, and they are the same from top to bottom: the
 * sequence (or the description above it) on the left, what is open on the
 * right. One definition, so nothing drifts by a few rem between the header
 * and the editing pane.
 */
const PAGE_COLUMNS = 'lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)]';

export function EditorPage() {
  const { t } = useTranslation(['editor', 'common']);
  const { quizId } = editorRoute.useParams();
  const { data, isLoading, error } = useQuizzesControllerGet(quizId);

  if (isLoading) return <p className="text-muted-foreground">{t('common:loading')}</p>;
  if (error || !data) return <p className="text-destructive">{t('notFound')}</p>;
  return <QuizEditor quiz={data.data} />;
}

function QuizEditor({ quiz }: { quiz: QuizDetailDto }) {
  const { t } = useTranslation(['editor', 'common']);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useQuizzesControllerUpdate();
  const transition = useQuizzesControllerTransition();
  const removeQuiz = useQuizzesControllerRemove();
  const removeQuestion = useQuestionsControllerRemove();
  const removeSlide = useSlidesControllerRemove();
  const reorder = useSlidesControllerReorderItems();
  type Editing = string | 'new' | 'new-slide' | null;
  const [editing, setEditing] = useState<Editing>(
    () => quiz.questions[0]?.id ?? quiz.slides[0]?.id ?? 'new',
  );
  // Unsaved edits in the open item form: switching item or closing asks first.
  const [formDirty, setFormDirty] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<Editing | undefined>(undefined);
  const onFormDirty = useCallback((d: boolean) => setFormDirty(d), []);
  const closeForm = useCallback(() => {
    setFormDirty(false);
    setEditing(null);
  }, []);
  // From `lg` the open item sits next to the list; below, in a bottom sheet.
  const wide = useMediaQuery('(min-width: 1024px)');
  // The sequence can shrink to a rail of numbers/icons; remembered per browser.
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem('editor.sidebar') === 'rail';
    } catch {
      return false;
    }
  });
  const toggleRail = () => {
    const next = !rail;
    setRail(next);
    try {
      localStorage.setItem('editor.sidebar', next ? 'rail' : 'full');
    } catch {
      /* storage unavailable: the choice just does not persist */
    }
  };
  const requestEditing = (next: Editing) => {
    if (editing !== null && formDirty && next !== editing) setPendingEdit(next);
    else {
      setFormDirty(false);
      setEditing(next);
    }
  };
  const [presenting, setPresenting] = useState(false);
  const [presentError, setPresentError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Deleting an item of the sequence asks first (a question takes its stats history with it).
  const [pendingDelete, setPendingDelete] = useState<QuizItem | null>(null);
  // Portable bundle (zip: quiz.json + media/) — the same file the Quiz Store shares.
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    try {
      await downloadFile(`/api/v1/quizzes/${quiz.id}/export`, 'quiz.quizdock.zip');
    } catch (e) {
      setPresentError(apiErrorText(e, t('header.exportError')));
    } finally {
      setExporting(false);
    }
  };
  // The description reads as text until clicked (the title is always an inline input).
  const [editingDescription, setEditingDescription] = useState(false);
  // Capture intégrale (§2.10) : conserve le détail des réponses par participant.
  // Décidée avant le lancement de la partie (fige le snapshot côté serveur).
  const [fullCapture, setFullCapture] = useState(false);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getQuizzesControllerGetQueryKey(quiz.id) }),
      queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() }),
    ]);

  // Title/description draft kept in localStorage until saved or discarded.
  const quizDraftKey = `quiz:${quiz.id}:settings`;
  type QuizForm = { title: string; description: string; language: string };
  const [quizDraft, setQuizDraft] = useState(() => loadDraft<QuizForm>(quizDraftKey));
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
      clearDraft(quizDraftKey);
      setQuizDraft(null);
      form.reset(value); // valeurs enregistrées = nouvelle base « propre » → bouton inactif
      setEditingDescription(false);
    },
  });
  // A restored draft is applied once, on mount; changes are then written back on every edit.
  useEffect(() => {
    if (quizDraft) form.reset(quizDraft, { keepDefaultValues: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const quizValues = useStore(form.store, (s) => s.values);

  // Le bouton « Enregistrer » n'est actif que si une modification est en cours.
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useEffect(() => {
    if (isDirty) saveDraft(quizDraftKey, quizValues);
    else clearDraft(quizDraftKey);
  }, [isDirty, quizValues, quizDraftKey]);
  useUnsavedGuard(isDirty);

  const setFeedbackEnabled = async (feedbackEnabled: boolean) => {
    await update.mutateAsync({ id: quiz.id, data: { feedbackEnabled } });
    await invalidate();
  };

  const setLoudness = async (loudnessTargetLufs: LoudnessTarget) => {
    await update.mutateAsync({ id: quiz.id, data: { loudnessTargetLufs } });
    await invalidate();
  };

  const setAudioTarget = async (audioTarget: AudioTarget) => {
    await update.mutateAsync({ id: quiz.id, data: { audioTarget } });
    await invalidate();
  };

  const setMediaTailS = async (mediaTailS: number) => {
    await update.mutateAsync({ id: quiz.id, data: { mediaTailS } });
    await invalidate();
  };

  const changeStatus = async (status: 'draft' | 'ready' | 'archived') => {
    await transition.mutateAsync({ id: quiz.id, data: { status } });
    await invalidate();
  };

  const onPresent = async () => {
    setPresentError(null);
    setPresenting(true);
    try {
      const { pin } = await createSession(quiz.id, { fullCapture });
      // The session lives in its console; the editor stays about the content.
      await navigate({ to: '/session/$pin/console', params: { pin } });
    } catch (e) {
      setPresentError(e instanceof Error ? e.message : t('broadcast.presentError'));
    } finally {
      setPresenting(false);
    }
  };

  const onDeleteQuiz = async () => {
    await removeQuiz.mutateAsync({ id: quiz.id });
    await queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });
    void navigate({ to: '/quizzes' });
  };

  const onDeleteQuestion = async (qid: string) => {
    await removeQuestion.mutateAsync({ qid });
    await invalidate();
  };

  const onDeleteSlide = async (sid: string) => {
    await removeSlide.mutateAsync({ sid });
    await invalidate();
  };

  // Questions and slides share one sequence (#7): the server re-anchors slides from it.
  const items = quizItems(quiz);
  const persistOrder = async (next: QuizItem[]) => {
    await reorder.mutateAsync({
      id: quiz.id,
      data: { items: next.map((it) => ({ kind: it.kind, id: it.id })) },
    });
    await invalidate();
  };
  const move = (index: number, direction: -1 | 1) => {
    const next = moveItem(items, index, direction);
    if (next !== items) void persistOrder(next);
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((it) => it.id === active.id);
    const to = items.findIndex((it) => it.id === over.id);
    if (from >= 0 && to >= 0) void persistOrder(arrayMove(items, from, to));
  };

  const editingItem = items.find((it) => it.id === editing);
  const openForm: ReactNode =
    editing === 'new' ? (
      <QuestionForm
        key="new"
        quizId={quiz.id}
        mediaTailS={quiz.mediaTailS}
        onClose={closeForm}
        onDirtyChange={onFormDirty}
      />
    ) : editing === 'new-slide' ? (
      <SlideForm key="new-slide" quizId={quiz.id} onClose={closeForm} onDirtyChange={onFormDirty} />
    ) : editingItem?.kind === 'question' ? (
      // Keyed by item: switching items must remount the form (fresh defaults, fresh dirty state).
      <QuestionForm
        key={editingItem.id}
        quizId={quiz.id}
        question={editingItem.question}
        mediaTailS={quiz.mediaTailS}
        onClose={closeForm}
        onDirtyChange={onFormDirty}
      />
    ) : editingItem?.kind === 'slide' ? (
      <SlideForm
        key={editingItem.id}
        quizId={quiz.id}
        slide={editingItem.slide}
        onClose={closeForm}
        onDirtyChange={onFormDirty}
      />
    ) : null;
  const formTitle =
    editing === 'new' || editingItem?.kind === 'question'
      ? t('questions.formTitle')
      : t('slides.formTitle');

  const statusVariant =
    quiz.status === 'ready' ? 'success' : quiz.status === 'archived' ? 'muted' : 'default';

  return (
    <div className="flex w-full flex-col gap-6">
      <ChromiumNotice />
      {/* Header: the quiz is the page title; the main action (publish / present) lives here. */}
      {/* L'en-tête occupe toute la largeur : les actions ne prennent plus la moitié
          de la ligne au formulaire, la description et ce qui l'accompagne ont enfin
          la page entière. */}
      <header className="w-full">
        <form
          className="flex w-full min-w-0 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {/* Enregistrer suit l'édition : la barre colle en haut de la zone, calée
              à droite, et « Enregistrer » occupe l'angle — on ne descend pas
              chercher le bouton après avoir tapé. */}
          {isDirty ? (
            <div className="bg-background/95 sticky top-0 z-20 -mx-2 flex items-center justify-end gap-2 px-2 py-2 backdrop-blur">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearDraft(quizDraftKey);
                  setQuizDraft(null);
                  form.reset();
                  setEditingDescription(false);
                }}
              >
                {t('common:cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={update.isPending}>
                <Save className="size-4" />
                {t('settings.save')}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <form.Field name="title">
              {(field) => (
                <Input
                  aria-label={t('settings.titleLabel')}
                  className="hover:bg-accent/60 focus-visible:bg-accent/60 -mx-2 h-auto min-w-64 flex-1 rounded-md border-0 bg-transparent px-2 text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </form.Field>
            <div className="flex flex-wrap items-center gap-1">
              {/* L'état du quiz se lit sur la même ligne que ce qu'on peut en faire. */}
              <Badge variant={statusVariant} className="mr-2">
                {t(`common:quizStatus.${quiz.status}`, { defaultValue: quiz.status })}
              </Badge>
              <div className="flex flex-wrap items-center gap-1">
                <a
                  className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                  href={`/quizzes/${quiz.id}/preview`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-4" />
                  {t('header.preview')}
                </a>
                <Link
                  to="/quizzes/$quizId/history"
                  params={{ quizId: quiz.id }}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                >
                  <History className="size-4" />
                  {t('header.history')}
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={exporting}
                  onClick={() => void onExport()}
                >
                  <Download className="size-4" />
                  {t('header.export')}
                </Button>
                {quiz.status === 'ready' ? <ShareAsTemplate quizId={quiz.id} /> : null}
                {/* Archiver et supprimer sont des actions du quiz, pas des réglages :
                elles sont avec les autres, en dernier et dans le ton qui convient. */}
                {quiz.status !== 'archived' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title={t('broadcast.archiveHelp')}
                    disabled={transition.isPending}
                    onClick={() => void changeStatus('archived')}
                  >
                    <Archive className="size-4" />
                    {t('broadcast.archive')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-4" />
                  {t('header.deleteQuiz')}
                </Button>
              </div>
            </div>
          </div>
          <div className={cn('grid items-start gap-x-8 gap-y-4', PAGE_COLUMNS)}>
            <form.Field name="description">
              {(field) => (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    {t('settings.descriptionLabel')}
                  </span>
                  {/* Du texte, rien d'autre : une description qui accepte du format
                      accepte un média, donc un identifiant local dans l'export et dans
                      le store. Elle se lit en paragraphe et s'ouvre au clic. */}
                  {editingDescription || isDirty ? (
                    <Textarea
                      aria-label={t('settings.descriptionLabel')}
                      rows={3}
                      className="max-w-(--container-content-sm)"
                      placeholder={t('settings.descriptionPlaceholder')}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-muted-foreground hover:bg-accent/60 -mx-2 min-h-20 max-w-(--container-content-sm) rounded-md px-2 py-1 text-left text-sm whitespace-pre-line"
                      onClick={() => setEditingDescription(true)}
                    >
                      {field.state.value || (
                        <span className="italic">{t('settings.descriptionPlaceholder')}</span>
                      )}
                    </button>
                  )}
                </div>
              )}
            </form.Field>
            {/* À droite de la description, les réglages du quiz dans une carte : les avis
                en clair sur une rangée, le son replié sur la suivante. */}
            <Section className="bg-muted/30 min-w-0 rounded-lg border px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm" title={t('feedback.enableHelp')}>
                  <Switch
                    checked={quiz.feedbackEnabled}
                    disabled={update.isPending}
                    onCheckedChange={(checked) => void setFeedbackEnabled(checked)}
                    aria-label={t('feedback.enableLabel')}
                  />
                  <span className="font-medium">{t('feedback.enableLabel')}</span>
                </label>
                <FeedbackSection quizId={quiz.id} />
              </div>
              <Disclosure
                flush
                className="-mx-3 border-t px-3 pt-1"
                title={t('settings.soundLegend')}
                value={t('settings.soundSummary', {
                  lufs: String(quiz.loudnessTargetLufs).replace('-', '−'),
                  target: t(`settings.audioTarget.${quiz.audioTarget}`),
                  tail: quiz.mediaTailS,
                })}
              >
                {/* Ouvert, les trois réglages se lisent sur une ligne. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <MediaTailField
                    value={quiz.mediaTailS}
                    disabled={update.isPending}
                    onSave={(mediaTailS) => void setMediaTailS(mediaTailS)}
                  />
                  <label
                    className="flex items-center gap-2 text-sm"
                    title={t('settings.loudnessHelp')}
                  >
                    <span className="font-medium">{t('settings.loudnessLabel')}</span>
                    <Select
                      className="h-8 w-auto"
                      value={String(quiz.loudnessTargetLufs)}
                      disabled={update.isPending}
                      onChange={(e) => void setLoudness(Number(e.target.value) as LoudnessTarget)}
                    >
                      {LOUDNESS_TARGETS.map((lufs) => (
                        <option key={lufs} value={lufs}>
                          {t(`settings.loudness.${-lufs}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label
                    className="flex flex-wrap items-center gap-2 text-sm"
                    title={t('settings.audioTargetHelp')}
                  >
                    <span className="font-medium">{t('settings.audioTargetLabel')}</span>
                    <Select
                      className="h-8 w-auto"
                      value={quiz.audioTarget}
                      disabled={update.isPending}
                      onChange={(e) => void setAudioTarget(e.target.value as AudioTarget)}
                    >
                      {AUDIO_TARGETS.map((target) => (
                        <option key={target} value={target}>
                          {t(`settings.audioTarget.${target}`)}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
              </Disclosure>
            </Section>
          </div>
          {/* Où en est le quiz, et l'action qui suit : toute la largeur, sous la
              description et les réglages — l'accès live s'affiche ici pendant une session. */}
          <StatusBar
            quiz={quiz}
            presenting={presenting}
            presentError={presentError}
            fullCapture={fullCapture}
            onFullCapture={setFullCapture}
            onPublish={() => void changeStatus('ready')}
            onPresent={() => void onPresent()}
            onBackToDraft={() => void changeStatus('draft')}
            onRestore={() => void changeStatus('draft')}
            busy={transition.isPending}
          />
          {quizDraft && isDirty ? (
            <DraftNotice
              onDiscard={() => {
                clearDraft(quizDraftKey);
                setQuizDraft(null);
                form.reset();
                setEditingDescription(false);
              }}
            />
          ) : null}
        </form>
      </header>
      {/* Master / detail: the sequence on the left, the open item on the right (a bottom
          sheet below `lg`). */}
      <div
        className={cn(
          'grid grid-cols-1 items-start gap-8',
          rail && wide ? 'lg:grid-cols-[3.5rem_minmax(0,1fr)]' : PAGE_COLUMNS,
        )}
      >
        {rail && wide ? (
          <aside className="flex flex-col items-center gap-1 lg:sticky lg:top-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('questions.expandList')}
              onClick={toggleRail}
            >
              <PanelLeftOpen className="size-4" />
            </Button>
            <ul className="flex flex-col items-center gap-1">
              {items.map((item, i) => {
                const n = questionNumber(items, i);
                const label = item.kind === 'slide' ? slideLabel(item.slide) : item.question.prompt;
                const active = editing === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => requestEditing(item.id)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {item.kind === 'slide' ? <LayoutTemplate className="size-4" /> : n}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-1 size-8"
              aria-label={t('questions.add')}
              title={t('questions.add')}
              onClick={() => requestEditing('new')}
              disabled={editing === 'new'}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              aria-label={t('slides.add')}
              title={t('slides.add')}
              onClick={() => requestEditing('new-slide')}
              disabled={editing === 'new-slide'}
            >
              <LayoutTemplate className="size-4" />
            </Button>
          </aside>
        ) : (
          <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-semibold">
                  {t('questions.title', { count: quiz.questionCount })}
                </h2>
                <span className="text-muted-foreground text-xs">
                  {t('questions.itemsCount', { count: items.length })}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden size-7 lg:inline-flex"
                aria-label={t('questions.collapseList')}
                onClick={toggleRail}
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={items.map((it) => it.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-0.5">
                  {items.map((item, i) => (
                    <SortableRow key={item.id} id={item.id}>
                      {(handle) => (
                        <ItemRow
                          item={item}
                          active={editing === item.id}
                          number={questionNumber(items, i)}
                          handle={handle}
                          canMoveUp={i > 0 && !reorder.isPending}
                          canMoveDown={i < items.length - 1 && !reorder.isPending}
                          onMove={(d) => move(i, d)}
                          onEdit={() => requestEditing(item.id)}
                          onDelete={() => setPendingDelete(item)}
                        />
                      )}
                    </SortableRow>
                  ))}
                  {items.length === 0 && editing === null && (
                    <li className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
                      {t('questions.empty')}
                    </li>
                  )}
                </ul>
              </SortableContext>
            </DndContext>
            <div className="mt-1 flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => requestEditing('new')}
                disabled={editing === 'new'}
              >
                <Plus className="size-4" />
                {t('questions.add')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => requestEditing('new-slide')}
                disabled={editing === 'new-slide'}
              >
                <LayoutTemplate className="size-4" />
                {t('slides.add')}
              </Button>
            </div>
          </aside>
        )}

        {wide ? (
          <section className="min-h-[24rem] min-w-0">
            {openForm ? (
              <div className="bg-muted/40 rounded-2xl p-6">{openForm}</div>
            ) : (
              <EmptyPane
                variant={items.length === 0 ? 'empty' : 'select'}
                onAddQuestion={() => requestEditing('new')}
                onAddSlide={() => requestEditing('new-slide')}
              />
            )}
          </section>
        ) : (
          <Drawer open={editing !== null} title={formTitle} onClose={() => requestEditing(null)}>
            {openForm}
          </Drawer>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={
          pendingDelete?.kind === 'slide'
            ? t('deleteItemConfirm.slideTitle')
            : t('deleteItemConfirm.questionTitle')
        }
        description={t('deleteItemConfirm.description', {
          label: pendingDelete
            ? pendingDelete.kind === 'slide'
              ? slideLabel(pendingDelete.slide)
              : pendingDelete.question.prompt
            : '',
        })}
        confirmLabel={t('deleteItemConfirm.confirmLabel')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const it = pendingDelete;
          setPendingDelete(null);
          if (!it) return;
          if (editing === it.id) closeForm();
          void (it.kind === 'question' ? onDeleteQuestion(it.id) : onDeleteSlide(it.id));
        }}
      />
      <ConfirmDialog
        open={pendingEdit !== undefined}
        destructive
        title={t('discardConfirm.title')}
        description={t('discardConfirm.description')}
        confirmLabel={t('discardConfirm.confirmLabel')}
        onCancel={() => setPendingEdit(undefined)}
        onConfirm={() => {
          const next = pendingEdit ?? null;
          setPendingEdit(undefined);
          setFormDirty(false);
          setEditing(next);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        destructive
        title={t('deleteConfirm.title')}
        description={t('deleteConfirm.description', { title: quiz.title })}
        confirmLabel={t('deleteConfirm.confirmLabel')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void onDeleteQuiz();
        }}
      />
    </div>
  );
}

/** Sidebar block: a small caps label, then content — no card chrome. */
function Section({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title ? (
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Player feedback at a glance (§2.11): the average, and a way in. The
 * distribution and the reviews themselves live on their own page.
 */
function FeedbackSection({ quizId }: { quizId: string }) {
  const { t } = useTranslation(['editor', 'common']);
  const { data, isLoading } = useQuizzesControllerFeedback(quizId, { page: 1, pageSize: 1 });
  const summary = data?.data;
  // Sans `count`, la réponse n'est pas (encore) un résumé : on se tait plutôt que
  // d'afficher une moyenne inventée.
  if (isLoading || typeof summary?.count !== 'number') return null;
  if (summary.count === 0)
    return <p className="text-muted-foreground text-xs">{t('feedback.empty')}</p>;
  return (
    <Link
      to="/quizzes/$quizId/reviews"
      params={{ quizId }}
      className="hover:bg-accent/60 -mx-2 flex items-center gap-2 rounded-md px-2 py-0.5 text-sm"
    >
      <span className="font-semibold tabular-nums">{summary.average.toFixed(1)}</span>
      <StarRow value={Math.round(summary.average)} size="size-4" />
      <span className="text-muted-foreground text-xs">
        {t('feedback.seeAll', { count: summary.count })}
      </span>
    </Link>
  );
}

/** Engine default for a slide's auto-mode display time (GAME_AUTO_ADVANCE_MS). */
const DEFAULT_SLIDE_SECONDS = 5;

/** 1-based number of a question among questions only (slides are not numbered). */
function questionNumber(items: QuizItem[], index: number): number | null {
  if (items[index].kind !== 'question') return null;
  return items.slice(0, index + 1).filter((it) => it.kind === 'question').length;
}

/** Sortable `<li>`: hands its drag handle props to the row (arrows stay for keyboard/a11y). */
function SortableRow({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { t } = useTranslation('editor');
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={t('questions.dragHandle')}
      className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'bg-background relative z-10 shadow-md')}
    >
      {children(handle)}
    </li>
  );
}

/**
 * One item of the sequence (#7): the whole row selects it for editing; the drag
 * handle, the arrows and delete show on hover / focus so the title keeps the room.
 */
function ItemRow({
  item,
  number,
  handle,
  active,
  canMoveUp,
  canMoveDown,
  onMove,
  onEdit,
  onDelete,
}: {
  item: QuizItem;
  number: number | null;
  handle?: ReactNode;
  /** Currently open in the editing pane. */
  active?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('editor');
  const isSlide = item.kind === 'slide';
  const label = isSlide ? slideLabel(item.slide) : item.question.prompt;
  // Same shape for both kinds: "<kind> · <effective duration>".
  const meta = isSlide
    ? `${t('slides.kind')} · ${
        item.slide.displayDelayS === 0
          ? t('slides.durationManual')
          : `${item.slide.displayDelayS ?? DEFAULT_SLIDE_SECONDS} s`
      }`
    : `${t(`questionType.${item.question.type}`, { defaultValue: item.question.type })} · ${item.question.timeLimitS} s`;
  const hover =
    'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
  return (
    <div
      className={cn(
        'group relative flex items-stretch gap-1 rounded-xl border border-transparent transition-colors',
        active ? 'bg-primary/5 border-primary/30' : 'hover:bg-accent/60',
      )}
    >
      <div className={cn('flex items-center pl-1', hover)}>{handle}</div>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-2 text-left"
      >
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums',
            isSlide ? 'text-muted-foreground' : 'bg-muted text-muted-foreground',
            active && !isSlide && 'bg-primary text-primary-foreground',
          )}
          aria-label={isSlide ? t('slides.kind') : undefined}
        >
          {isSlide ? <LayoutTemplate className="size-4" /> : number}
        </span>
        <span className="min-w-0 flex-1">
          <Markdown profile="inline" className="line-clamp-2 block text-sm font-medium">
            {label}
          </Markdown>
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">{meta}</span>
        </span>
      </button>
      <div className={cn('flex items-center gap-0.5 pr-1', hover)}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('questions.moveUp')}
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('questions.moveDown')}
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hover:text-destructive size-7"
          aria-label={isSlide ? t('slides.deleteSlide') : t('questions.deleteQuestion')}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Right pane when nothing is open: an "empty quiz" state that invites the first
 * item, or a "nothing selected" state that points at the list.
 */
function EmptyPane({
  variant,
  onAddQuestion,
  onAddSlide,
}: {
  variant: 'empty' | 'select';
  onAddQuestion: () => void;
  onAddSlide: () => void;
}) {
  const { t } = useTranslation('editor');
  const Icon = variant === 'empty' ? Sparkles : MousePointerClick;
  return (
    <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 text-center">
      <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full">
        <Icon className="size-8" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          {variant === 'empty' ? t('emptyPane.emptyTitle') : t('emptyPane.selectTitle')}
        </p>
        <p className="text-muted-foreground max-w-sm text-sm">
          {variant === 'empty' ? t('emptyPane.emptyHint') : t('emptyPane.selectHint')}
        </p>
      </div>
      {variant === 'empty' ? (
        <div className="flex gap-2">
          <Button type="button" onClick={onAddQuestion}>
            <Plus className="size-4" />
            {t('questions.add')}
          </Button>
          <Button type="button" variant="outline" onClick={onAddSlide}>
            <LayoutTemplate className="size-4" />
            {t('slides.add')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Status bar: the quiz's state with the one action that follows it, and — while
 * a session runs — the PIN and the three access screens (§4.1). A band between
 * two rules, not a card: its text lines up with the title and the description.
 */
function StatusBar({
  quiz,
  presenting,
  presentError,
  fullCapture,
  onFullCapture,
  onPublish,
  onPresent,
  onBackToDraft,
  onRestore,
  busy,
}: {
  quiz: QuizDetailDto;
  presenting: boolean;
  presentError: string | null;
  fullCapture: boolean;
  onFullCapture: (v: boolean) => void;
  onPublish: () => void;
  onPresent: () => void;
  onBackToDraft: () => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation(['editor', 'common']);
  // Full capture keeps every answer per participant: personal data (GDPR) and a
  // heavier archive — it is switched on knowingly, through an explanation.
  const [confirmCapture, setConfirmCapture] = useState(false);
  // Sessions of this quiz running right now (same source as the dashboard).
  const { data: games } = useGameControllerMine({ query: { refetchInterval: 15_000 } });
  const running = (games?.data ?? []).filter((g) => g.quizId === quiz.id);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y py-3">
      <p className="text-muted-foreground min-w-0 flex-1 text-sm">{t(`status.${quiz.status}`)}</p>
      {quiz.status === 'draft' ? (
        <Button
          type="button"
          size="sm"
          disabled={quiz.questionCount === 0 || busy}
          onClick={onPublish}
        >
          {t('broadcast.publish')}
        </Button>
      ) : null}
      {quiz.status === 'ready' ? (
        <>
          <label className="flex items-center gap-2 text-sm" title={t('broadcast.fullCaptureHelp')}>
            <Switch
              checked={fullCapture}
              onCheckedChange={(checked) =>
                checked ? setConfirmCapture(true) : onFullCapture(false)
              }
              aria-label={t('broadcast.fullCaptureNext')}
            />
            {t('broadcast.fullCaptureNext')}
          </label>
          <ConfirmDialog
            open={confirmCapture}
            title={t('common:captureConfirm.title')}
            description={t('common:captureConfirm.description')}
            confirmLabel={t('common:captureConfirm.confirmLabel')}
            onCancel={() => setConfirmCapture(false)}
            onConfirm={() => {
              setConfirmCapture(false);
              onFullCapture(true);
            }}
          />
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onBackToDraft}>
            {t('broadcast.backToDraft')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="main-action"
            disabled={presenting}
            onClick={onPresent}
          >
            <Play className="size-4" />
            {presenting ? t('broadcast.presenting') : t('broadcast.present')}
          </Button>
        </>
      ) : null}
      {quiz.status === 'archived' ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRestore}>
          {t('broadcast.restore')}
        </Button>
      ) : null}
      {presentError ? <p className="text-destructive w-full text-sm">{presentError}</p> : null}
      {running.length > 0 ? (
        // A quiz may be played in several sessions at once: list them, each with its console.
        <div className="border-border/60 flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
          <span className="flex items-center gap-1.5">
            <Radio className="text-primary size-4" />
            {t('sessions.running', { count: running.length })}
          </span>
          {running.map((g) => (
            <Link
              key={g.pin}
              to="/session/$pin/console"
              params={{ pin: g.pin }}
              className="hover:bg-accent flex items-center gap-2 rounded-md border px-2 py-1"
            >
              <span className="font-mono tracking-widest">{g.pin}</span>
              <span className="text-muted-foreground">
                {t('sessions.players', { count: g.playerCount })}
              </span>
              <MonitorPlay className="size-3.5" />
            </Link>
          ))}
          <span className="text-muted-foreground w-full text-xs">
            {t('sessions.liveEditsHint')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shares a `ready` quiz as a template in this instance's catalogue (#39): a
 * copy leaves, the original is never touched by what others do with theirs.
 * The confirmation says exactly that, because "share" is the word people read
 * as "give access to mine".
 */
function ShareAsTemplate({ quizId }: { quizId: string }) {
  const { t } = useTranslation(['store', 'common']);
  const queryClient = useQueryClient();
  const share = useStoreControllerShare();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onShare = async () => {
    setConfirming(false);
    setError(null);
    try {
      const { data } = await share.mutateAsync({ data: { quizId } });
      await queryClient.invalidateQueries({ queryKey: getStoreControllerListQueryKey() });
      setNote(t('shared', { n: data.revision }));
    } catch (e) {
      setError(apiErrorText(e, t('shareFailed')));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={share.isPending}
        onClick={() => setConfirming(true)}
      >
        <Share2 className="size-4" />
        {t('share')}
      </Button>
      {note ? <span className="text-muted-foreground text-sm">{note}</span> : null}
      {error ? (
        <span className="text-destructive text-sm" role="alert">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={t('shareConfirm.title')}
        description={t('shareConfirm.description')}
        confirmLabel={t('share')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onShare()}
      />
    </>
  );
}

/**
 * The quiz-wide pause kept after a question's sound or video: a media longer
 * than its question stretches the question to its end plus this pause, so no
 * sound is cut mid-play. Saved when the field is left.
 */
function MediaTailField({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (seconds: number) => void;
}) {
  const { t } = useTranslation('editor');
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    const clamped = Number.isFinite(n) ? Math.min(MEDIA_TAIL_MAX_S, Math.max(0, n)) : value;
    setDraft(String(clamped));
    if (clamped !== value) onSave(clamped);
  };
  return (
    <label className="flex items-center gap-2 text-sm" title={t('settings.mediaTailHelp')}>
      <span className="font-medium">{t('settings.mediaTailLabel')}</span>
      <Input
        type="number"
        min={0}
        max={MEDIA_TAIL_MAX_S}
        className="h-8 w-16"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="text-muted-foreground">{t('settings.seconds')}</span>
    </label>
  );
}
