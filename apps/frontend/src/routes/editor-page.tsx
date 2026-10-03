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
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  EllipsisVertical,
  ExternalLink,
  GripVertical,
  History,
  LayoutTemplate,
  ListOrdered,
  MonitorPlay,
  MousePointerClick,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Radio,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AUDIO_TARGETS,
  type AudioTarget,
  LOUDNESS_TARGETS,
  type LoudnessTarget,
  MEDIA_TAIL_MAX_S,
  QUIZ_LANGUAGES,
  QUIZ_LICENSES,
  QUIZ_MAX_TAGS,
  isQuizLicense,
  toTag,
} from '@quiz-dock/contracts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { QuizStatusBadge } from '@/components/quiz-status-badge';
import { MenuItem, MenuSeparator } from '@/components/ui/menu-item';
import { Popover } from '@/components/ui/popover';
import { Modal } from '@/components/ui/modal';
import { savedQuestionIssues } from '@/lib/question-issues';
import { slideIssues, TIME_LIMIT_S } from '@quiz-dock/contracts';
import { validationText } from '../api/error-text';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useLaunchSession } from '../game/use-launch-session';
import { downloadFile } from '../api/download';
import { apiErrorText } from '../api/http';
import type { QuizDetailDto, UpdateQuizDto } from '../api/generated/model';
import { quizItems, moveItem, slideLabel, type QuizItem } from '@/lib/quiz-items';
import { useMediaQuery } from '@/lib/use-media-query';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { languageName, licenseName } from '@/lib/quiz-terms';
import { ChromiumNotice } from '@/components/chromium-notice';
import { Notice } from '@/components/ui/notice';
import { Disclosure } from '@/components/ui/disclosure';
import { Drawer } from '@/components/ui/drawer';
import { QuestionForm } from './question-form';
import { PublicationDialog } from './publication-export';
import { QuizReadOnly } from './quiz-read-only';
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
import { getDemo } from '../config';
import { editorRoute } from '../router';
import { LoadFailed, PageLoading } from '@/components/ui/loading';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { clearDraft, formDraftKey } from '@/lib/draft-store';
import { StaleNotice } from '@/components/ui/stale-notice';
import { EmptyState } from '@/components/ui/empty-state';

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
  const { data, isLoading, error, refetch } = useQuizzesControllerGet(quizId);

  if (isLoading) return <PageLoading />;
  // Only when there is nothing to show: a reading again that fails (on focus, after
  // a save) keeps the open editor, and what is typed in it.
  if (!data) return <LoadFailed error={error} notFound={t('notFound')} />;
  const stale = error ? <StaleNotice onRetry={() => void refetch()} /> : null;
  // Another host's quiz, opened by a manager: read, never changed (#82).
  if (!data.data.editable) {
    return (
      <>
        {stale}
        <QuizReadOnly quiz={data.data} />
      </>
    );
  }
  return (
    <>
      {stale}
      <QuizEditor quiz={data.data} />
    </>
  );
}

function QuizEditor({ quiz }: { quiz: QuizDetailDto }) {
  const { t, i18n } = useTranslation(['editor', 'common']);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useQuizzesControllerUpdate();
  const transition = useQuizzesControllerTransition();
  const removeQuiz = useQuizzesControllerRemove();
  const removeQuestion = useQuestionsControllerRemove();
  const removeSlide = useSlidesControllerRemove();
  const reorder = useSlidesControllerReorderItems();
  type Editing = string | 'new' | 'new-slide' | null;
  // Side by side (wide), the first step opens with the page; on a phone the form is a
  // sheet, opened when a step is picked, never on arrival.
  const [editing, setEditing] = useState<Editing>(() =>
    window.matchMedia?.('(min-width: 1024px)').matches
      ? (quiz.questions[0]?.id ?? quiz.slides[0]?.id ?? 'new')
      : null,
  );
  // Unsaved edits in the open item form: switching item or closing asks first.
  const [formDirty, setFormDirty] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<Editing | undefined>(undefined);
  const onFormDirty = useCallback((d: boolean) => setFormDirty(d), []);
  // The open question form's save, to save before switching (#195); a slide form has none.
  const saveFormRef = useRef<(() => Promise<boolean>) | null>(null);
  const [savingFirst, setSavingFirst] = useState(false);
  // A new question saved: it stays open, as the question it now is.
  const openCreated = useCallback((id: string) => {
    setFormDirty(false);
    setEditing(id);
  }, []);
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
  // The session lives in its console; the editor stays about the content.
  const {
    launch,
    isLaunching: presenting,
    error: presentError,
    dialog: launchDialog,
  } = useLaunchSession();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The ⋯ menu's two actions that ask first: their dialogs outlive the menu.
  const [publishing, setPublishing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  // Deleting an item of the sequence asks first (a question takes its stats history with it).
  const [pendingDelete, setPendingDelete] = useState<QuizItem | null>(null);
  // Portable bundle (zip: quiz.json + media/) — the same file the Quiz Store shares.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const onExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await downloadFile(`/api/v1/quizzes/${quiz.id}/export`, 'quiz.quizdock.zip');
    } catch (e) {
      setExportError(apiErrorText(e, t('header.exportError')));
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

  // A save that fails says so, next to the settings, instead of snapping back
  // in silence (#82).
  const [saveError, setSaveError] = useState<string | null>(null);
  // Title and description save themselves when their field is left, like the settings
  // beside them: the quiz frame has one way of saving (UI system §3), and says so.
  const [title, setTitle] = useState(quiz.title);
  const [description, setDescription] = useState(quiz.description ?? '');
  useEffect(() => setTitle(quiz.title), [quiz.title]);
  useEffect(() => setDescription(quiz.description ?? ''), [quiz.description]);
  const [frameSave, setFrameSave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveFrame = async (data: UpdateQuizDto) => {
    setSaveError(null);
    setFrameSave('saving');
    try {
      await update.mutateAsync({ id: quiz.id, data });
      await invalidate();
      setFrameSave('saved');
    } catch (e) {
      // What was typed stays in the field: nothing is lost, the save can be tried again.
      setFrameSave('idle');
      setSaveError(apiErrorText(e, t('settings.saveError')));
    }
  };
  const commitTitle = () => {
    const next = title.trim();
    // A quiz keeps a title: an emptied one comes back.
    if (!next) setTitle(quiz.title);
    else if (next !== quiz.title) void saveFrame({ title: next });
  };
  const commitDescription = () => {
    setEditingDescription(false);
    const next = description.trim();
    if (next !== (quiz.description ?? '')) void saveFrame({ description: next || null });
  };
  // Typed but not yet left: leaving the page asks first.
  useUnsavedGuard(title.trim() !== quiz.title || description.trim() !== (quiz.description ?? ''));

  const guarded = async (action: () => Promise<unknown>) => {
    setSaveError(null);
    try {
      await action();
    } catch (e) {
      setSaveError(apiErrorText(e, t('settings.saveError')));
    }
  };
  const saveSettings = (data: UpdateQuizDto) =>
    guarded(async () => {
      await update.mutateAsync({ id: quiz.id, data });
      await invalidate();
    });

  const setFeedbackEnabled = (feedbackEnabled: boolean) => saveSettings({ feedbackEnabled });
  const setLoudness = (loudnessTargetLufs: LoudnessTarget) => saveSettings({ loudnessTargetLufs });
  const setAudioTarget = (audioTarget: AudioTarget) => saveSettings({ audioTarget });
  const setLicense = (license: (typeof QUIZ_LICENSES)[number] | null) => saveSettings({ license });
  const setLanguage = (language: string) => saveSettings({ language });
  const setShared = (shared: boolean) => saveSettings({ shared });
  const setTags = (tags: string[]) => saveSettings({ tags });
  const setMediaTailS = (mediaTailS: number) => saveSettings({ mediaTailS });

  const changeStatus = (status: 'draft' | 'ready' | 'archived') =>
    guarded(async () => {
      await transition.mutateAsync({ id: quiz.id, data: { status } });
      await invalidate();
    });

  // Called by a form saving an unfinished question in a published quiz; it says what fails.
  const moveToDraft = async () => {
    await transition.mutateAsync({ id: quiz.id, data: { status: 'draft' } });
    await invalidate();
  };

  const onPresent = () => launch(quiz.id, { fullCapture });

  const onDeleteQuiz = () =>
    guarded(async () => {
      await removeQuiz.mutateAsync({ id: quiz.id });
      await queryClient.invalidateQueries({ queryKey: getQuizzesControllerListQueryKey() });
      void navigate({ to: '/quizzes' });
    });

  const onDeleteQuestion = (qid: string) =>
    guarded(async () => {
      await removeQuestion.mutateAsync({ qid });
      await invalidate();
    });

  const onDeleteSlide = (sid: string) =>
    guarded(async () => {
      await removeSlide.mutateAsync({ sid });
      await invalidate();
    });

  // Questions and slides share one sequence (#7): the server re-anchors slides from it.
  const items = quizItems(quiz);
  // What each step still misses (a question its answers, a slide something to show):
  // what a quiz must finish to be published.
  const unfinished = items
    .map((item, i) => ({
      item,
      number: questionNumber(items, i),
      issues:
        item.kind === 'question'
          ? savedQuestionIssues(item.question)
          : slideIssues({ ...item.slide, blocks: item.slide.blocks as unknown[] }),
    }))
    .filter((u) => u.issues.length > 0);
  const [checklist, setChecklist] = useState(false);
  // Publishing an unfinished quiz lists what is missing, each line opening its step.
  const onPublish = () => (unfinished.length > 0 ? setChecklist(true) : void changeStatus('ready'));
  // Arrived from the dashboard's « Publish to present »: done once, then the address is clean.
  const { publish: publishOnArrival } = editorRoute.useSearch();
  useEffect(() => {
    if (!publishOnArrival) return;
    if (quiz.status === 'draft') onPublish();
    void navigate({
      to: '/quizzes/$quizId',
      params: { quizId: quiz.id },
      search: {},
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishOnArrival]);

  // One move at a time, until the list is read again: a move made meanwhile would
  // start from the old order and undo the one before it.
  const [reordering, setReordering] = useState(false);
  const reorderingRef = useRef(false);
  const persistOrder = async (next: QuizItem[]) => {
    if (reorderingRef.current) return;
    reorderingRef.current = true;
    setReordering(true);
    try {
      await guarded(async () => {
        await reorder.mutateAsync({
          id: quiz.id,
          data: { items: next.map((it) => ({ kind: it.kind, id: it.id })) },
        });
        await invalidate();
      });
    } finally {
      reorderingRef.current = false;
      setReordering(false);
    }
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
  const editingIndex = items.findIndex((it) => it.id === editing);
  // What a slide's quiz variables read in the builder's preview (`{title}`, `{questions}`…).
  const slideQuizFields = quiz
    ? {
        title: quiz.title,
        description: quiz.description,
        questionCount: quiz.questionCount,
        ...(quiz.ownerName ? { author: quiz.ownerName } : {}),
        tags: quiz.tags,
        license: quiz.license,
      }
    : undefined;
  const openForm: ReactNode =
    editing === 'new' ? (
      <QuestionForm
        key="new"
        quizId={quiz.id}
        mediaTailS={quiz.mediaTailS}
        quizStatus={quiz.status}
        position={{ index: quiz.questionCount, total: quiz.questionCount + 1 }}
        onMoveToDraft={moveToDraft}
        onClose={closeForm}
        onCreated={openCreated}
        saveRef={saveFormRef}
        onDirtyChange={onFormDirty}
      />
    ) : editing === 'new-slide' ? (
      <SlideForm
        key="new-slide"
        quizId={quiz.id}
        quizStatus={quiz.status}
        onMoveToDraft={moveToDraft}
        quizFields={slideQuizFields}
        onClose={closeForm}
        onDirtyChange={onFormDirty}
      />
    ) : editingItem?.kind === 'question' ? (
      // Keyed by item: switching items must remount the form (fresh defaults, fresh dirty state).
      <QuestionForm
        key={editingItem.id}
        quizId={quiz.id}
        question={editingItem.question}
        mediaTailS={quiz.mediaTailS}
        quizStatus={quiz.status}
        position={{ index: editingItem.question.orderIndex, total: quiz.questionCount }}
        onMoveToDraft={moveToDraft}
        onClose={closeForm}
        saveRef={saveFormRef}
        onDirtyChange={onFormDirty}
      />
    ) : editingItem?.kind === 'slide' ? (
      <SlideForm
        key={editingItem.id}
        quizId={quiz.id}
        slide={editingItem.slide}
        quizStatus={quiz.status}
        onMoveToDraft={moveToDraft}
        quizFields={slideQuizFields}
        onClose={closeForm}
        onDirtyChange={onFormDirty}
      />
    ) : null;
  const formTitle =
    editing === 'new' || editingItem?.kind === 'question'
      ? t('questions.formTitle')
      : t('slides.formTitle');

  return (
    <div className="flex w-full flex-col gap-6">
      <ChromiumNotice />
      {/* Header: the quiz is the page title; the main action (publish / present) lives here. */}
      {/* L'en-tête occupe toute la largeur : les actions ne prennent plus la moitié
          de la ligne au formulaire, la description et ce qui l'accompagne ont enfin
          la page entière. */}
      <header className="flex w-full min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-64 flex-1 items-center gap-3">
            <Input
              aria-label={t('settings.titleLabel')}
              className="hover:bg-accent/60 focus-visible:bg-accent/60 -mx-2 h-auto min-w-0 flex-1 rounded-md border-0 bg-transparent px-2 text-3xl font-bold tracking-tight shadow-none focus-visible:ring-0"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setFrameSave('idle');
              }}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <FrameSaveState state={frameSave} />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {/* L'état du quiz se lit sur la même ligne que ce qu'on peut en faire. */}
            <QuizStatusBadge status={quiz.status} className="mr-2" />
            <a
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              href={`/quizzes/${quiz.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              {t('header.preview')}
            </a>
            {/* The rest of what can be done with the quiz, the destructive last. */}
            <Popover
              align="end"
              trigger={({ open, toggle }) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={open}
                  onClick={toggle}
                >
                  <EllipsisVertical className="size-4" />
                  {t('header.more')}
                </Button>
              )}
            >
              {(close) => (
                <div className="flex min-w-56 flex-col">
                  <MenuItem
                    onClick={() => {
                      close();
                      void navigate({
                        to: '/quizzes/$quizId/history',
                        params: { quizId: quiz.id },
                      });
                    }}
                  >
                    <History className="size-4" />
                    {t('header.history')}
                  </MenuItem>
                  <MenuItem
                    disabled={exporting}
                    onClick={() => {
                      close();
                      void onExport();
                    }}
                  >
                    <Download className="size-4" />
                    {t('header.export')}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      setPublishing(true);
                    }}
                  >
                    <PackageCheck className="size-4" />
                    {t('publication.open')}
                  </MenuItem>
                  {/* A demo catalogue is read-only. */}
                  {quiz.status === 'ready' && !getDemo() ? (
                    <MenuItem
                      onClick={() => {
                        close();
                        setSharing(true);
                      }}
                    >
                      <Share2 className="size-4" />
                      {t('store:share')}
                    </MenuItem>
                  ) : null}
                  {quiz.status !== 'archived' ? (
                    <MenuItem
                      disabled={transition.isPending}
                      onClick={() => {
                        close();
                        void changeStatus('archived');
                      }}
                    >
                      <Archive className="size-4" />
                      {t('broadcast.archive')}
                    </MenuItem>
                  ) : null}
                  <MenuSeparator />
                  <MenuItem
                    destructive
                    onClick={() => {
                      close();
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 className="size-4" />
                    {t('header.deleteQuiz')}
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>
        </div>
        {shareNote ? <p className="text-muted-foreground text-sm">{shareNote}</p> : null}
        <div className={cn('grid items-start gap-x-8 gap-y-4', PAGE_COLUMNS)}>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {t('settings.descriptionLabel')}
            </span>
            {/* Du texte, rien d'autre : une description qui accepte du format
                  accepte un média, donc un identifiant local dans l'export et dans
                  le store. Elle se lit en paragraphe et s'ouvre au clic. */}
            {editingDescription ? (
              <Textarea
                aria-label={t('settings.descriptionLabel')}
                rows={3}
                autoFocus
                className="max-w-(--container-content-sm)"
                placeholder={t('settings.descriptionPlaceholder')}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setFrameSave('idle');
                }}
                onBlur={commitDescription}
              />
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:bg-accent/60 -mx-2 min-h-20 max-w-(--container-content-sm) rounded-md px-2 py-1 text-left text-sm whitespace-pre-line"
                onClick={() => setEditingDescription(true)}
              >
                {description || (
                  <span className="italic">{t('settings.descriptionPlaceholder')}</span>
                )}
              </button>
            )}
          </div>
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
                  className="flex items-center gap-2 text-[1em]"
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
                  className="flex flex-wrap items-center gap-2 text-[1em]"
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
            {/* The terms the quiz is shared under: required before sharing it as a template. */}
            <Disclosure
              flush
              className="-mx-3 border-t px-3 pt-1"
              title={t('settings.sharingLegend')}
              value={[
                quiz.shared ? t('settings.sharedOn') : t('settings.sharedOff'),
                languageName(quiz.language, i18n.language),
                quiz.license
                  ? t('settings.sharingSummary', {
                      license: licenseName(quiz.license),
                      count: quiz.tags.length,
                    })
                  : t('settings.noLicense'),
              ].join(' · ')}
            >
              {/* Private by default: the other hosts see nothing of it until it is shared. */}
              <CheckboxField
                className="mb-2"
                checked={quiz.shared}
                disabled={update.isPending}
                onChange={(shared) => void setShared(shared)}
                label={t('settings.sharedLabel')}
                hint={t('settings.sharedHelp')}
              />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label
                  className="flex items-center gap-2 text-[1em]"
                  title={t('settings.languageHelp')}
                >
                  <span className="font-medium">{t('settings.languageLabel')}</span>
                  <Select
                    className="h-8 w-auto"
                    value={quiz.language}
                    disabled={update.isPending}
                    onChange={(e) => void setLanguage(e.target.value)}
                  >
                    {languageOptions(quiz.language, i18n.language).map(({ code, name }) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label
                  className="flex items-center gap-2 text-[1em]"
                  title={t('settings.licenseHelp')}
                >
                  <span className="font-medium">{t('settings.licenseLabel')}</span>
                  <Select
                    className="h-8 w-auto"
                    value={quiz.license ?? ''}
                    disabled={update.isPending}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || isQuizLicense(value)) void setLicense(value || null);
                    }}
                  >
                    <option value="">{t('settings.noLicense')}</option>
                    {QUIZ_LICENSES.map((license) => (
                      <option key={license} value={license}>
                        {t(`settings.license.${LICENSE_KEYS[license]}`)}
                      </option>
                    ))}
                    {/* An imported quiz may carry a licence no longer offered: shown, not lost. */}
                    {quiz.license && !isQuizLicense(quiz.license) ? (
                      <option value={quiz.license} disabled>
                        {quiz.license}
                      </option>
                    ) : null}
                  </Select>
                </label>
                <TagsField
                  value={quiz.tags}
                  disabled={update.isPending}
                  onSave={(tags) => void setTags(tags)}
                />
              </div>
            </Disclosure>
          </Section>
        </div>
        {/* Où en est le quiz, et l'action qui suit : toute la largeur, sous la
              description et les réglages — l'accès live s'affiche ici pendant une session. */}
        <StatusBar
          quiz={quiz}
          presenting={presenting}
          presentError={presentError ?? exportError}
          fullCapture={fullCapture}
          onFullCapture={setFullCapture}
          onPublish={onPublish}
          onPresent={() => void onPresent()}
          onBackToDraft={() => void changeStatus('draft')}
          onRestore={() => void changeStatus('draft')}
          busy={transition.isPending}
        />
        {launchDialog}
        {saveError ? (
          <p className="text-destructive text-sm" role="alert">
            {saveError}
          </p>
        ) : null}
      </header>
      <ImportReportNotice quizId={quiz.id} />
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
            {/* Folded, the open step keeps its actions. */}
            {editingItem ? (
              <ItemMenu
                label={t('questions.itemActions', {
                  label:
                    editingItem.kind === 'slide'
                      ? slideLabel(editingItem.slide)
                      : editingItem.question.prompt,
                })}
                deleteLabel={
                  editingItem.kind === 'slide'
                    ? t('slides.deleteSlide')
                    : t('questions.deleteQuestion')
                }
                canMoveUp={editingIndex > 0 && !reordering}
                canMoveDown={editingIndex < items.length - 1 && !reordering}
                onMove={(d) => move(editingIndex, d)}
                onDelete={() => setPendingDelete(editingItem)}
              />
            ) : null}
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
                          unfinished={unfinished.some((u) => u.item.id === item.id)}
                          active={editing === item.id}
                          number={questionNumber(items, i)}
                          handle={handle}
                          canMoveUp={i > 0 && !reordering}
                          canMoveDown={i < items.length - 1 && !reordering}
                          onMove={(d) => move(i, d)}
                          onEdit={() => requestEditing(item.id)}
                          onDelete={() => setPendingDelete(item)}
                        />
                      )}
                    </SortableRow>
                  ))}
                  {items.length === 0 && editing === null && (
                    <li>
                      <EmptyState icon={ListOrdered}>{t('questions.empty')}</EmptyState>
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
        confirmLabel={
          pendingEdit ? t('discardConfirm.discardAndContinue') : t('discardConfirm.confirmLabel')
        }
        // A question's changes can be saved on the way (#195): only once saved does it go on.
        alternative={
          editing === 'new' || editingItem?.kind === 'question'
            ? {
                label: pendingEdit
                  ? t('discardConfirm.saveAndContinue')
                  : t('discardConfirm.saveAndClose'),
                busy: savingFirst,
                onClick: () => {
                  const next = pendingEdit ?? null;
                  setSavingFirst(true);
                  void (saveFormRef.current?.() ?? Promise.resolve(false)).then((ok) => {
                    setSavingFirst(false);
                    setPendingEdit(undefined);
                    if (!ok) return; // the form says why, its edits kept
                    setFormDirty(false);
                    setEditing(next);
                  });
                },
              }
            : undefined
        }
        onCancel={() => setPendingEdit(undefined)}
        onConfirm={() => {
          const next = pendingEdit ?? null;
          // Discarded: its draft goes too, or reopening it would bring the changes back.
          if (editing === 'new' || editing === 'new-slide') {
            clearDraft(formDraftKey(quiz.id, editing === 'new' ? 'question' : 'slide', null));
          } else if (editingItem) {
            clearDraft(formDraftKey(quiz.id, editingItem.kind, editingItem.id));
          }
          setPendingEdit(undefined);
          setFormDirty(false);
          setEditing(next);
        }}
      />
      <PublishChecklist
        open={checklist}
        steps={unfinished.map((u) => ({
          id: u.item.id,
          number: u.number,
          label: u.item.kind === 'question' ? u.item.question.prompt : slideLabel(u.item.slide),
          slide: u.item.kind === 'slide',
          texts: [...new Set(u.issues.map((i) => validationText(i.code)))],
        }))}
        onOpenStep={(id) => {
          setChecklist(false);
          requestEditing(id);
        }}
        onClose={() => setChecklist(false)}
      />
      {publishing ? (
        <PublicationDialog quizId={quiz.id} onClose={() => setPublishing(false)} />
      ) : null}
      <ShareTemplateDialog
        quizId={quiz.id}
        open={sharing}
        onClose={() => setSharing(false)}
        onDone={setShareNote}
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
/**
 * Arrived from a Kahoot sheet's import: how many questions came in, which ones to
 * finish, which rows were left out and why. Closed, it does not come back.
 */
function ImportReportNotice({ quizId }: { quizId: string }) {
  const { t } = useTranslation(['editor', 'common']);
  const navigate = useNavigate();
  const report = useRouterState({ select: (s) => s.location.state.importReport });
  if (!report) return null;
  const close = () =>
    void navigate({ to: '/quizzes/$quizId', params: { quizId }, state: {}, replace: true });
  return (
    <Notice tone="info" role="status">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium">{t('importReport.imported', { count: report.converted })}</p>
          <p>{t('importReport.media')}</p>
          {report.incomplete.length > 0 ? (
            <p>{t('importReport.incomplete', { count: report.incomplete.length })}</p>
          ) : null}
          {report.skipped.length > 0 ? (
            <ul className="text-muted-foreground list-disc pl-5">
              {report.skipped.map(({ row, reason }) => (
                <li key={row}>
                  {t('importReport.skipped', {
                    row,
                    reason: t(`importReport.reasons.${reason}`, TIME_LIMIT_S),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-1 size-7"
          aria-label={t('common:close')}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
    </Notice>
  );
}

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
  unfinished,
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
  /** Misses something to be played: publishing waits for it. */
  unfinished?: boolean;
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
  return (
    <div
      className={cn(
        'group relative flex items-stretch gap-1 rounded-xl border border-transparent transition-colors',
        active ? 'bg-primary/5 border-primary/30' : 'hover:bg-accent/60',
      )}
    >
      {/* The open step shows how to move it; nothing appears on hover only. */}
      {active ? <div className="flex items-center pl-1">{handle}</div> : null}
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
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-xs">
            {unfinished ? (
              <span className="text-warning-text flex items-center gap-1 font-medium">
                <AlertTriangle className="size-3.5" aria-hidden />
                {t('questions.unfinished')} ·
              </span>
            ) : null}
            {meta}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-0.5 pr-1">
        {active ? (
          <>
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
          </>
        ) : null}
        <ItemMenu
          label={t('questions.itemActions', { label: label || meta })}
          deleteLabel={isSlide ? t('slides.deleteSlide') : t('questions.deleteQuestion')}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/** A step's `⋯`: move it, or delete it (after a separator). */
function ItemMenu({
  label,
  deleteLabel,
  canMoveUp,
  canMoveDown,
  onMove,
  onDelete,
}: {
  label: string;
  deleteLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('editor');
  return (
    <Popover
      align="end"
      trigger={({ open, toggle }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-7"
          aria-label={label}
          aria-expanded={open}
          onClick={toggle}
        >
          <EllipsisVertical className="size-4" />
        </Button>
      )}
    >
      {(close) => (
        <div className="flex min-w-44 flex-col">
          <MenuItem
            disabled={!canMoveUp}
            onClick={() => {
              close();
              onMove(-1);
            }}
          >
            <ArrowUp className="size-4" />
            {t('questions.moveUp')}
          </MenuItem>
          <MenuItem
            disabled={!canMoveDown}
            onClick={() => {
              close();
              onMove(1);
            }}
          >
            <ArrowDown className="size-4" />
            {t('questions.moveDown')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            destructive
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <Trash2 className="size-4" />
            {deleteLabel}
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

/**
 * What a quiz misses to be published (UI system §1.5): each unfinished step with
 * what it lacks, and a way straight to it.
 */
function PublishChecklist({
  open,
  steps,
  onOpenStep,
  onClose,
}: {
  open: boolean;
  steps: { id: string; number: number | null; label: string; slide: boolean; texts: string[] }[];
  onOpenStep: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['editor', 'common']);
  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="publish-checklist-title"
      className="max-h-[calc(100dvh-2rem)] max-w-lg open:flex open:flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <h2 id="publish-checklist-title" className="text-lg font-semibold">
          {t('publishChecklist.title', { count: steps.length })}
        </h2>
        <p className="text-muted-foreground text-sm">{t('publishChecklist.description')}</p>
        <ul className="flex flex-col divide-y rounded-lg border">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3 px-3 py-2">
              <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums">
                {step.slide ? (
                  <LayoutTemplate className="size-4" aria-label={t('slides.kind')} />
                ) : (
                  step.number
                )}
              </span>
              <div className="min-w-0 flex-1">
                <Markdown profile="inline" className="line-clamp-1 block text-sm font-medium">
                  {step.label || t('publishChecklist.untitled')}
                </Markdown>
                {step.texts.map((text) => (
                  <p key={text} className="text-warning-text text-xs">
                    {text}
                  </p>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => onOpenStep(step.id)}>
                {t('publishChecklist.open')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:close')}
          </Button>
        </div>
      </div>
    </Modal>
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
    <EmptyState
      icon={Icon}
      size="large"
      title={variant === 'empty' ? t('emptyPane.emptyTitle') : t('emptyPane.selectTitle')}
      className="h-full min-h-[24rem]"
      action={
        variant === 'empty' ? (
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
        ) : null
      }
    >
      {variant === 'empty' ? t('emptyPane.emptyHint') : t('emptyPane.selectHint')}
    </EmptyState>
  );
}

/**
 * Status bar: the quiz's state with the one action that follows it, and — while
 * a session runs — the PIN and the three access screens (§4.1).
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
    <div className="bg-muted/40 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-5 py-3">
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
function ShareTemplateDialog({
  quizId,
  open,
  onClose,
  onDone,
}: {
  quizId: string;
  open: boolean;
  onClose: () => void;
  /** What happened, said under the header (shared, or why not). */
  onDone: (note: string) => void;
}) {
  const { t } = useTranslation(['store', 'common']);
  const queryClient = useQueryClient();
  const share = useStoreControllerShare();
  const onShare = async () => {
    onClose();
    try {
      const { data } = await share.mutateAsync({ data: { quizId } });
      await queryClient.invalidateQueries({ queryKey: getStoreControllerListQueryKey() });
      onDone(t('shared', { n: data.revision }));
    } catch (e) {
      onDone(apiErrorText(e, t('shareFailed')));
    }
  };
  return (
    <ConfirmDialog
      open={open}
      title={t('shareConfirm.title')}
      description={t('shareConfirm.description')}
      confirmLabel={t('share')}
      onCancel={onClose}
      onConfirm={() => void onShare()}
    />
  );
}

/** Where the quiz frame's own save is: saving, or saved (nothing shown before the first edit). */
function FrameSaveState({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  const { t } = useTranslation('editor');
  if (state === 'idle') return null;
  return (
    <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs" role="status">
      {state === 'saving' ? (
        t('settings.saving')
      ) : (
        <>
          <Check className="text-success size-3.5" aria-hidden />
          {t('settings.saved')}
        </>
      )}
    </span>
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
    <label className="flex items-center gap-2 text-[1em]" title={t('settings.mediaTailHelp')}>
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

/**
 * The languages offered, by name: the instance's first, then the common ones,
 * plus the quiz's own when it is none of those (an imported quiz), so it is
 * shown rather than lost.
 */
function languageOptions(current: string, uiLanguage: string) {
  const codes = [...new Set<string>([uiLanguage, ...QUIZ_LANGUAGES, current])];
  const [first, ...rest] = codes.map((code) => ({ code, name: languageName(code, uiLanguage) }));
  return [first, ...rest.sort((a, b) => a.name.localeCompare(b.name, uiLanguage))];
}

/** i18n keys: an SPDX identifier has dots, which i18next reads as nesting. */
const LICENSE_KEYS = { 'CC0-1.0': 'cc0', 'CC-BY-4.0': 'ccBy', 'CC-BY-SA-4.0': 'ccBySa' } as const;

/**
 * The quiz's tags, as chips: Enter or a comma adds what was typed, turned into
 * a tag ("Pop Culture" → pop-culture); Backspace in the empty field removes the
 * last one. Saved as soon as the list changes.
 */
function TagsField({
  value,
  disabled,
  onSave,
}: {
  value: string[];
  disabled: boolean;
  onSave: (tags: string[]) => void;
}) {
  const { t } = useTranslation('editor');
  const [draft, setDraft] = useState('');
  const full = value.length >= QUIZ_MAX_TAGS;
  const add = () => {
    const tag = toTag(draft);
    setDraft('');
    if (tag && !value.includes(tag) && !full) onSave([...value, tag]);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[1em]" title={t('settings.tagsHelp')}>
      <span className="font-medium">{t('settings.tagsLabel')}</span>
      {value.map((tag) => (
        <Badge key={tag} variant="muted" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            className="hover:text-foreground rounded-sm"
            aria-label={t('settings.removeTag', { tag })}
            disabled={disabled}
            onClick={() => onSave(value.filter((it) => it !== tag))}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {full ? null : (
        <Input
          className="h-8 w-40"
          aria-label={t('settings.tagsLabel')}
          placeholder={t('settings.tagsPlaceholder')}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onSave(value.slice(0, -1));
            }
          }}
        />
      )}
    </div>
  );
}
