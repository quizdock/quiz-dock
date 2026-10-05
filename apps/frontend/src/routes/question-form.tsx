import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { appConfig } from '../config';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AUDIO_TARGETS,
  type AudioTarget,
  MEDIA_POSITIONS,
  MEDIA_POSITION_DEFAULT,
  type MediaPosition,
  WAVEFORM_SIZES,
  WAVEFORM_SIZE_DEFAULT,
  type WaveformSize,
  MEDIA_TAIL_DEFAULT_S,
  NO_QUESTION_MEDIA,
  effectiveTimeLimitS,
  type QuestionMedia,
  type SlideGradient,
  type SlideTextTone,
  ACCEPTED_ANSWERS_MAX,
  OPTION_COLORS,
  OPTION_SHAPES,
  OPTION_TYPES,
  OPTIONS_MAX,
  QUESTION_TYPES,
  type QuestionCompletenessInput,
  type QuestionTypeName,
  REVEAL_DELAY_S,
  type Scoring,
  TIME_LIMIT_S,
  type QuestionContent,
  normalizeAnswer,
  questionContentSchema,
  questionIssues,
  scoringsFor,
} from '@quiz-dock/contracts';
import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaEditsContext, useMediaEdits } from '@/lib/media-edits';
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  GripVertical,
  Image as ImageIcon,
  type LucideIcon,
  Monitor,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Pin,
  PinOff,
  Smartphone,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useFormDraft } from '@/lib/use-form-draft';
import { clearDraft, formDraftKey, loadDraft } from '@/lib/draft-store';
import { FormActionBar } from '@/components/form-action-bar';
import { DraftNotice } from '@/components/draft-notice';
import { MarkdownEditor } from '@/components/markdown-editor';
import { promptImage } from '@/lib/prompt-image';
import { mediaControllerDescribe, mediaControllerSetAlt } from '../api/generated/media/media';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { COLOR_BG, OPTION_BG_FALLBACK } from '@/lib/option-style';
import { cn } from '@/lib/utils';
import { useSessionState } from '@/lib/use-session-state';
import { FieldMessage } from '@/components/ui/field-message';
import {
  type FieldIssue,
  issuesAsErrors,
  issuesAsWarnings,
  focusField,
  issuesFor,
} from '@/lib/question-issues';
import { ApiError, apiErrorText, apiFieldErrors } from '../api/http';
import type { QuizDetailDtoQuestionsItem } from '../api/generated/model';
import { BackgroundField, NO_BACKGROUND, type BackgroundValue } from './background-field';
import { Waveform } from '../game/media/waveform';
import { useContentT } from '../i18n/content-language';
import { QuestionMediaField, useMediaDurationMs } from './question-media-field';
import {
  useQuestionsControllerAdd,
  useQuestionsControllerUpdate,
} from '../api/generated/questions/questions';
import { getQuizzesControllerGetQueryKey } from '../api/generated/quizzes/quizzes';
import { ShapeIcon } from '@/components/shape-icon';
import { ImageChoiceOptions } from './image-choice-options';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { CorrectToggle } from '@/components/ui/correct-toggle';
import { Notice } from '@/components/ui/notice';
import { MenuItem } from '@/components/ui/menu-item';
import { Popover } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { useMediaUrl } from '@/lib/media-url';
import { RoomScreen } from './quiz-steps-preview';
import { stepView } from './step-view';
import { useHotkeys } from 'react-hotkeys-hook';

type QType = QuestionTypeName;
const TYPES = QUESTION_TYPES;
// Eight distinct colour+shape pairs, one per position: no two options ever look alike (max 8).
const COLORS = OPTION_COLORS;
const SHAPES = OPTION_SHAPES;
const SINGLE_CORRECT: QType[] = ['single_choice', 'true_false'];

interface OptionValue {
  /** Client-only stable key (drag and drop); never sent. */
  key: string;
  text: string;
  color: string;
  shape: string;
  isCorrect: boolean;
  correctOrderIndex: number;
  /** An answer's picture: an image choice's, or one kept from an import. */
  mediaId: string | null;
  /** Its alternative text, in the quiz's language (image choice). */
  alt: string;
}
interface FormValues {
  type: QType;
  prompt: string;
  /** Visual + audio slots, in the contract's shape (never a video with a sound). */
  media: QuestionMedia;
  answerExplanation: string;
  background: BackgroundValue;
  timeLimitS: number;
  revealDelayS: number | null;
  /** Which devices play its sound; null = the game's default. */
  audioTarget: AudioTarget | null;
  /** How thick the sound's waveform is drawn on the screens. */
  waveformSize: WaveformSize;
  mediaPosition: MediaPosition;
  /** Listen first: the timer starts when the media ends. */
  timerAfterMedia: boolean;
  pointsMode: 'standard' | 'double' | 'none' | 'fixed';
  scoring: Scoring;
  /** Empty (null) until the author sets it: a draft may wait for it. */
  numericValue: number | null;
  numericTolerance: number | null;
  /** Image choice: several pictures may be right. */
  multiSelect: boolean;
  options: OptionValue[];
  acceptedAnswers: { text: string }[];
}

// Unique across page loads too: a restored draft keeps the keys of the previous load
// (a counter alone starts over at each load and would hand one out again).
let optionSeq = 0;
const optionKey = () => `opt-${Date.now().toString(36)}-${++optionSeq}`;

function newOption(i: number, text = '', isCorrect = false): OptionValue {
  return {
    key: optionKey(),
    text,
    color: COLORS[i % COLORS.length],
    shape: SHAPES[i % SHAPES.length],
    isCorrect,
    correctOrderIndex: i,
    mediaId: null,
    alt: '',
  };
}

function initialValues(q?: QuizDetailDtoQuestionsItem): FormValues {
  if (!q) {
    return {
      type: 'single_choice',
      prompt: '',
      media: NO_QUESTION_MEDIA,
      answerExplanation: '',
      background: NO_BACKGROUND,
      timeLimitS: 20,
      revealDelayS: null,
      audioTarget: null,
      waveformSize: WAVEFORM_SIZE_DEFAULT,
      mediaPosition: MEDIA_POSITION_DEFAULT,
      timerAfterMedia: false,
      pointsMode: 'standard',
      scoring: 'standard',
      numericValue: null,
      numericTolerance: 0,
      multiSelect: false,
      options: [newOption(0), newOption(1)],
      acceptedAnswers: [],
    };
  }
  return {
    type: q.type as QType,
    prompt: q.prompt,
    media: (q.media as QuestionMedia | undefined) ?? NO_QUESTION_MEDIA,
    answerExplanation: q.answerExplanation ?? '',
    background: {
      mediaId: q.backgroundMediaId ?? null,
      gradient: (q.backgroundGradient as SlideGradient | null | undefined) ?? null,
      textTone: (q.textTone as SlideTextTone | undefined) ?? 'light',
      textOutline: q.textOutline ?? true,
    },
    timeLimitS: q.timeLimitS,
    revealDelayS: q.revealDelayS ?? null,
    audioTarget: (q.audioTarget as AudioTarget | null | undefined) ?? null,
    waveformSize: (q.waveformSize as WaveformSize | undefined) ?? WAVEFORM_SIZE_DEFAULT,
    mediaPosition: (q.mediaPosition as MediaPosition | undefined) ?? MEDIA_POSITION_DEFAULT,
    timerAfterMedia: q.timerAfterMedia ?? false,
    // A poll is stored as 'none', which the menu does not offer: the poll's own
    // setting stays out of the form, so a change of type starts from 'standard'.
    pointsMode: (q.pointsMode === 'none' ? 'standard' : q.pointsMode) as FormValues['pointsMode'],
    scoring: (q.scoring ?? 'standard') as Scoring,
    numericValue: q.numericValue == null ? null : Number(q.numericValue),
    numericTolerance: q.numericTolerance == null ? null : Number(q.numericTolerance),
    multiSelect: q.multiSelect ?? false,
    options: q.options.map((o, i) => ({
      key: o.id,
      text: o.text ?? '',
      color: o.color,
      shape: o.shape,
      isCorrect: o.isCorrect,
      correctOrderIndex: o.correctOrderIndex ?? i,
      mediaId: o.mediaId ?? null,
      alt: o.alt ?? '',
    })),
    acceptedAnswers: q.acceptedAnswers.map((a) => ({ text: a.text })),
  };
}

export function QuestionForm({
  quizId,
  quizLanguage,
  question,
  mediaTailS = MEDIA_TAIL_DEFAULT_S,
  quizStatus = 'draft',
  position,
  onMoveToDraft,
  onClose,
  onCreated,
  saveRef,
  onDirtyChange,
}: {
  quizId: string;
  /** The quiz's language (BCP 47): the True and False it starts with are written in it. */
  quizLanguage?: string;
  question?: QuizDetailDtoQuestionsItem;
  /** A published quiz only takes complete questions: an unfinished one sends it back to draft. */
  quizStatus?: string;
  /** Its place among the quiz's questions (0-based), for the preview's band. */
  position?: { index: number; total: number };
  onMoveToDraft?: () => Promise<void>;
  /** The quiz's pause after a media: a longer media stretches the question's time. */
  mediaTailS?: number;
  onClose: () => void;
  /** A new question saved: the parent opens it (without it, the form closes). */
  onCreated?: (questionId: string) => void;
  /** Where the parent finds this form's save, to save before switching (#195): true once saved. */
  saveRef?: RefObject<(() => Promise<boolean>) | null>;
  /** Reports unsaved edits so the parent can guard against losing them. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(['editor', 'common']);
  const contentT = useContentT(quizLanguage, 'editor');
  const queryClient = useQueryClient();
  const add = useQuestionsControllerAdd();
  const update = useQuestionsControllerUpdate();
  const [error, setError] = useState<string | null>(null);
  // What blocks the save, by field (the structure, or the server's refusal).
  const [errors, setErrors] = useState<FieldIssue[]>([]);
  // What is left to finish shows once the question was saved, or a save was tried.
  const [checked, setChecked] = useState(!!question);
  // A published quiz and an unfinished question: back to draft, or keep editing.
  const [askDraft, setAskDraft] = useState(false);
  // A time typed out of bounds was brought back to the nearest one: said once, under it.
  const [clamped, setClamped] = useState<'time' | 'reveal' | null>(null);
  // A type change took the right answers away: the author is told once.
  const [ticksCleared, setTicksCleared] = useState(false);
  // Computed once: option keys are generated, so a fresh copy per render would reset the form.
  // A save makes what was saved the new baseline: the editor stays open, clean (#195).
  const [initial, setInitial] = useState(() => initialValues(question));
  // "Saved" shows after a save, until the next change.
  const [saved, setSaved] = useState(false);
  // Whether the last submit got saved (a refusal, or the ready-to-draft question, did not).
  const savedOk = useRef(false);
  // Draft kept in localStorage until saved or discarded (survives reload / closed tab).
  const draftKey = formDraftKey(quizId, 'question', question?.id ?? null);
  // A draft saved before the media slots existed has no `media`: it is not restored.
  const [restored, setRestored] = useState(() => {
    const draft = loadDraft<FormValues>(draftKey);
    return draft && 'media' in draft ? withDefaults(draft) : null;
  });

  const form = useForm({
    defaultValues: restored ?? initial,
    onSubmit: async ({ value }) => {
      savedOk.current = false;
      setError(null);
      setErrors([]);
      setChecked(true);
      const data = buildPayload(value);
      // The server's own schema: what no question may break is said here, not after a round trip.
      const parsed = questionContentSchema.safeParse(data);
      if (!parsed.success) {
        const found = issuesAsErrors(parsed.error.issues);
        setErrors(found);
        focusField(found[0].field);
        return;
      }
      if (quizStatus === 'ready' && questionIssues(parsed.data).length > 0) {
        setAskDraft(true);
        return;
      }
      await save(data, value);
    },
  });
  const save = async (data: ReturnType<typeof buildPayload>, value: FormValues) => {
    try {
      // The media's alt and credit, edited here, are saved with the question.
      await mediaEdits.flush();
      let createdId: string | null = null;
      if (question) {
        await update.mutateAsync({ qid: question.id, data });
      } else {
        createdId = (await add.mutateAsync({ id: quizId, data })).data.id;
      }
      await queryClient.invalidateQueries({
        queryKey: getQuizzesControllerGetQueryKey(quizId),
      });
      clearDraft(draftKey);
      savedOk.current = true;
      if (createdId === null) {
        // What was typed meanwhile stays a change.
        setInitial(value);
        setRestored(null);
        setSaved(true);
      } else if (onCreated) onCreated(createdId);
      else onClose();
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.data as { code?: string })?.code === INCOMPLETE_IN_READY
      ) {
        setAskDraft(true);
        return;
      }
      const found = apiFieldErrors(err).map(
        (e): FieldIssue => ({ field: e.field, text: e.message, tone: 'error' }),
      );
      setErrors(found);
      setError(apiErrorText(err, t('questionForm.invalidError')));
      if (found[0]) focusField(found[0].field);
    }
  };
  const moveToDraftAndSave = async () => {
    setAskDraft(false);
    try {
      await onMoveToDraft?.();
    } catch (err) {
      setError(apiErrorText(err));
      return;
    }
    const value = form.state.values;
    await save(buildPayload(value), value);
  };
  const values = useStore(form.store, (s) => s.values);
  // Dirty = values differ from what was loaded (a fresh question is dirty as soon as typed in).
  const formDirty = useFormDraft(draftKey, initial, values, onDirtyChange);
  // Alt texts and credits typed here wait for the Save, and count as changes.
  const mediaEdits = useMediaEdits();
  const dirty = formDirty || mediaEdits.dirty;
  useEffect(() => {
    if (mediaEdits.dirty) onDirtyChange?.(true);
  }, [mediaEdits.dirty, onDirtyChange]);
  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);
  // Cmd+S (macOS) or Ctrl+S saves the question, from any of its fields, instead of the
  // browser saving the page; not under a dialog, and once at a time.
  const formRef = useRef<HTMLFormElement>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useHotkeys(
    'mod+s',
    () => {
      if (dirtyRef.current && !form.state.isSubmitting) void form.handleSubmit();
    },
    {
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: true,
      // A dialog over the form (its own confirms, another one) keeps the keys; the
      // sheet the form sits in on a phone is a dialog too, and does not.
      ignoreEventWhen: () => {
        const formEl = formRef.current;
        return (
          !formEl || [...document.querySelectorAll('dialog[open]')].some((d) => !d.contains(formEl))
        );
      },
    },
    [form],
  );
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      await form.handleSubmit();
      return savedOk.current;
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, form]);
  // Back to what was loaded: the draft goes with the changes.
  const discardDraft = () => {
    setRestored(null);
    form.reset(initial);
  };

  const type = useStore(form.store, (s) => s.values.type);
  const cancel = () => {
    clearDraft(draftKey);
    onClose();
  };
  const media = useStore(form.store, (s) => s.values.media);
  const timeLimitS = useStore(form.store, (s) => s.values.timeLimitS);
  const revealDelayS = useStore(form.store, (s) => s.values.revealDelayS);
  const mediaMs = useMediaDurationMs(media);
  // What the session will give this question, estimated with the default read delay
  // (the server uses the instance's GAME_READ_DELAY_MS).
  const listenFirst = useStore(form.store, (s) => s.values.timerAfterMedia);
  // Read on the folded lines (playback, points).
  const audioTarget = useStore(form.store, (s) => s.values.audioTarget);
  const waveformSize = useStore(form.store, (s) => s.values.waveformSize);
  const pointsMode = useStore(form.store, (s) => s.values.pointsMode);
  const scoring = useStore(form.store, (s) => s.values.scoring);
  const multiSelect = useStore(form.store, (s) => s.values.multiSelect);
  const scorings = scoringsFor(type, multiSelect);
  const canListenFirst = mediaHasSound(media) && mediaMs !== null;
  const stretchedS =
    canListenFirst && listenFirst
      ? timeLimitS
      : effectiveTimeLimitS(timeLimitS, mediaMs, mediaTailS, READ_DELAY_DEFAULT_MS);
  const options = useStore(form.store, (s) => s.values.options);
  // Index of the option whose removal awaits confirmation.
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const answers = useStore(form.store, (s) => s.values.acceptedAnswers);
  // Under each field: what blocks the save, then what is left to finish (the same check as
  // publishing). Errors stand until the next save.
  const issues = useMemo(
    () => [
      ...errors,
      ...(checked
        ? issuesAsWarnings(questionIssues(buildPayload(values) as QuestionCompletenessInput))
        : []),
    ],
    [errors, checked, values],
  );
  const issuesAt = (field: string) => issuesFor(issues, field);

  // Colour and shape are a pair fixed by position (red ▲, blue ◆, yellow ●, green ■):
  // nothing to choose, and removing an option re-flows the ones after it.
  // The places in the right order stay 1 to n, whatever was added or removed.
  const setOptions = (next: OptionValue[]) => {
    const places = rankPlaces(next);
    form.setFieldValue(
      'options',
      next.map((o, i) => ({
        ...o,
        color: COLORS[i % COLORS.length],
        shape: SHAPES[i % SHAPES.length],
        correctOrderIndex: places[i],
      })),
    );
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onOptionDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.key === active.id);
    const to = options.findIndex((o) => o.key === over.id);
    if (from >= 0 && to >= 0) setOptions(arrayMove(options, from, to));
  };

  // True or false starts with "True" ticked: the most common answer is one click away.
  // Both are written in the quiz's language, as any other answer: editable text.
  const trueFalse = () => [
    newOption(0, contentT('questionForm.trueOption'), true),
    newOption(1, contentT('questionForm.falseOption')),
  ];
  const onTypeChange = (next: QType) => {
    const wasImages = type === 'image_choice';
    // What was ticked is chosen again under the new rules: said, not silently lost.
    setTicksCleared(options.some((o) => o.isCorrect) && next !== 'poll' && next !== type);
    form.setFieldValue('type', next);
    // A typed answer starts with one line to fill.
    if (next === 'text_input' && answers.length === 0) {
      form.setFieldValue('acceptedAnswers', [{ text: '' }]);
    }
    if (next !== 'image_choice') form.setFieldValue('multiSelect', false);
    if (next === 'image_choice') {
      form.setFieldValue('media', { visual: null, audio: media.audio } as QuestionMedia);
    }
    if (next === 'true_false') setOptions(trueFalse());
    // Text answers make no pictures, and pictures no text: both start afresh.
    else if (next === 'image_choice' || wasImages || options.length < 2) {
      setOptions(OPTION_TYPES.includes(next) ? [newOption(0), newOption(1)] : options);
    } else {
      // The texts stay; what was right under the old rules is chosen again under the new ones.
      setOptions(options.map((o, i) => ({ ...o, isCorrect: false, correctOrderIndex: i })));
    }
  };

  const setCorrect = (index: number, checked: boolean) => {
    setTicksCleared(false);
    setOptions(
      options.map((o, i) => ({
        ...o,
        isCorrect:
          SINGLE_CORRECT.includes(type) || (type === 'image_choice' && !multiSelect)
            ? i === index
            : i === index
              ? checked
              : o.isCorrect,
      })),
    );
  };

  return (
    <MediaEditsContext.Provider value={mediaEdits.edits}>
      <form
        ref={formRef}
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {/* Enregistrer est en haut, collant : une question longue (propositions,
          explication, arrière-plan) mettait le bouton hors d'atteinte, et on ne
          devrait jamais avoir à chercher comment garder ce qu'on vient d'écrire. */}
        <FormActionBar
          title={question ? t('questionForm.titleEdit') : t('questionForm.titleAdd')}
          dirty={dirty}
          saved={saved && !dirty}
          busy={add.isPending || update.isPending}
          submitLabel={question ? t('questionForm.submitUpdate') : t('questionForm.submitAdd')}
          issues={issues}
          onIssue={focusField}
          onCancel={cancel}
        />

        {restored ? <DraftNotice onDiscard={discardDraft} /> : null}
        <LivePreview values={values} position={position} />
        <Label>
          {t('questionForm.typeLabel')}
          <Select value={type} onChange={(e) => onTypeChange(e.target.value as QType)}>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`questionType.${value}`)}
              </option>
            ))}
          </Select>
        </Label>
        {/* What this type does on screen and how it scores — the rules are not obvious. */}
        <p className="text-muted-foreground -mt-3 text-xs leading-snug">
          {t(`questionTypeHelp.${type}`)}
        </p>
        {ticksCleared ? <Notice tone="info">{t('questionForm.ticksCleared')}</Notice> : null}

        <form.Field name="prompt">
          {(field) => (
            <div id="qf-prompt" className="flex flex-col gap-1.5">
              <span className="text-sm font-medium leading-none">
                {t('questionForm.promptLabel')}
              </span>
              <MarkdownEditor
                aria-label={t('questionForm.promptLabel')}
                value={field.state.value}
                onChange={field.handleChange}
                placeholder={t('questionForm.promptPlaceholder')}
              />
              <FieldMessage issues={issuesAt('prompt')} />
              {type === 'image_choice' ? null : (
                <PromptImageNotice
                  prompt={field.state.value}
                  media={media}
                  onMove={(rest, next) => {
                    field.handleChange(rest);
                    form.setFieldValue('media', next);
                  }}
                />
              )}
            </div>
          )}
        </form.Field>

        {type === 'image_choice' && (
          <fieldset id="qf-options" className="flex flex-col gap-2">
            <legend className={LEGEND}>{t('questionForm.imagesLegend')}</legend>
            <ImageChoiceOptions
              options={options}
              currentOptions={() => form.getFieldValue('options')}
              multiSelect={multiSelect}
              showErrors={checked}
              sensors={sensors}
              setOptions={setOptions}
              newOption={newOption}
              onCorrect={setCorrect}
              onMultiSelect={(multi) => {
                form.setFieldValue('multiSelect', multi);
                // Back to one right picture: the first one ticked stays.
                if (!multi) {
                  const first = options.findIndex((o) => o.isCorrect);
                  setOptions(options.map((o, i) => ({ ...o, isCorrect: i === first })));
                }
              }}
            />
            {/* Each picture says what it misses; here, what the whole question does. */}
            <FieldMessage issues={issues.filter((i) => i.field === 'options')} />
          </fieldset>
        )}

        {OPTION_TYPES.includes(type) && type !== 'image_choice' && (
          <fieldset id="qf-options" className="flex flex-col gap-2">
            <legend className={LEGEND}>{t('questionForm.optionsLegend')}</legend>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onOptionDragEnd}
            >
              <SortableContext
                items={options.map((o) => o.key)}
                strategy={verticalListSortingStrategy}
              >
                {options.map((opt, i) => (
                  <SortableOption key={opt.key} id={opt.key}>
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md text-lg text-white',
                        COLOR_BG[opt.color] ?? OPTION_BG_FALLBACK,
                      )}
                    >
                      <ShapeIcon shape={opt.shape} />
                    </span>
                    <MarkdownEditor
                      profile="inline"
                      aria-label={t('questionForm.optionAriaLabel', { index: i + 1 })}
                      className="min-w-48 flex-1"
                      value={opt.text}
                      onChange={(text) =>
                        setOptions(options.map((o, idx) => (idx === i ? { ...o, text } : o)))
                      }
                      placeholder={t('questionForm.optionPlaceholder', { index: i + 1 })}
                    />

                    {type === 'ordering' ? (
                      // Its place in the right order, from 1: taking a place swaps with its holder.
                      <Select
                        aria-label={t('questionForm.orderAriaLabel', { index: i + 1 })}
                        className="w-24"
                        value={opt.correctOrderIndex}
                        onChange={(e) => setOptions(swapPlace(options, i, Number(e.target.value)))}
                      >
                        {options.map((_, place) => (
                          <option key={place} value={place}>
                            {t('questionForm.place', { count: place + 1, ordinal: true })}
                          </option>
                        ))}
                      </Select>
                    ) : type === 'poll' ? null : (
                      <CorrectToggle
                        single={SINGLE_CORRECT.includes(type)}
                        checked={opt.isCorrect}
                        label={t('questionForm.correct')}
                        onChange={(checked) => setCorrect(i, checked)}
                      />
                    )}

                    {/* Moving and removing, in reach without a mouse or a hover. */}
                    <Popover
                      align="end"
                      trigger={({ open, toggle }) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground size-8"
                          aria-label={t('questionForm.optionActions', { index: i + 1 })}
                          aria-expanded={open}
                          onClick={toggle}
                        >
                          <EllipsisVertical className="size-4" />
                        </Button>
                      )}
                    >
                      {(close) => (
                        <div className="flex w-44 flex-col gap-0.5">
                          <MenuItem
                            disabled={i === 0}
                            onClick={() => {
                              close();
                              setOptions(arrayMove(options, i, i - 1));
                            }}
                          >
                            <ArrowUp className="size-4" />
                            {t('questions.moveUp')}
                          </MenuItem>
                          <MenuItem
                            disabled={i === options.length - 1}
                            onClick={() => {
                              close();
                              setOptions(arrayMove(options, i, i + 1));
                            }}
                          >
                            <ArrowDown className="size-4" />
                            {t('questions.moveDown')}
                          </MenuItem>
                          {type !== 'true_false' ? (
                            <MenuItem
                              destructive
                              disabled={options.length <= 2}
                              onClick={() => {
                                close();
                                // An empty option goes without asking; a typed one is worth a confirmation.
                                if ((opt.text ?? '').trim()) setPendingRemoval(i);
                                else setOptions(options.filter((_, idx) => idx !== i));
                              }}
                            >
                              <Trash2 className="size-4" />
                              {t('questionForm.removeOptionShort')}
                            </MenuItem>
                          ) : null}
                        </div>
                      )}
                    </Popover>
                  </SortableOption>
                ))}
              </SortableContext>
            </DndContext>
            <FieldMessage issues={issuesAt('options')} />
            {type !== 'true_false' && (
              // At the limit the button stays, and says it.
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={options.length >= OPTIONS_MAX}
                onClick={() => setOptions([...options, newOption(options.length)])}
              >
                <Plus className="size-4" />
                {options.length >= OPTIONS_MAX
                  ? t('questionForm.addOptionMax', { max: OPTIONS_MAX })
                  : t('questionForm.addOption')}
              </Button>
            )}
          </fieldset>
        )}

        {type === 'text_input' && (
          <fieldset id="qf-acceptedAnswers" className="flex flex-col gap-2">
            <legend className={LEGEND}>
              {t('questionForm.acceptedAnswersLegend')}{' '}
              <span className="tabular-nums">
                {answers.length}/{ACCEPTED_ANSWERS_MAX}
              </span>
            </legend>
            {answers.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={t('questionForm.answerAriaLabel', { index: i + 1 })}
                  value={a.text}
                  onChange={(e) =>
                    form.setFieldValue(
                      'acceptedAnswers',
                      answers.map((x, idx) => (idx === i ? { text: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t('questionForm.removeAnswer', { index: i + 1 })}
                  onClick={() =>
                    form.setFieldValue(
                      'acceptedAnswers',
                      answers.filter((_, idx) => idx !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <FieldMessage issues={issuesAt('acceptedAnswers')} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              disabled={answers.length >= ACCEPTED_ANSWERS_MAX}
              onClick={() => form.setFieldValue('acceptedAnswers', [...answers, { text: '' }])}
            >
              <Plus className="size-4" />
              {answers.length >= ACCEPTED_ANSWERS_MAX
                ? t('questionForm.addAnswerMax', { max: ACCEPTED_ANSWERS_MAX })
                : t('questionForm.addAnswer')}
            </Button>
          </fieldset>
        )}

        {type === 'numeric' && (
          <fieldset className="flex flex-col gap-2">
            <legend className={LEGEND}>{t('questionForm.numericLegend')}</legend>
            <div className="flex flex-wrap gap-4">
              <form.Field name="numericValue">
                {(field) => (
                  <div id="qf-numericValue" className="flex flex-col gap-1.5">
                    <Label>
                      {t('questionForm.numericValueLabel')}
                      {/* Any number, decimals included. */}
                      <Input
                        type="number"
                        step="any"
                        className="w-32"
                        value={field.state.value ?? ''}
                        onChange={(e) =>
                          field.handleChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </Label>
                    <FieldMessage issues={issuesAt('numericValue')} />
                  </div>
                )}
              </form.Field>
              <form.Field name="numericTolerance">
                {(field) => (
                  <div id="qf-numericTolerance" className="flex flex-col gap-1.5">
                    <Label>
                      {t('questionForm.numericToleranceLabel')}
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        className="w-32"
                        value={field.state.value ?? ''}
                        onChange={(e) =>
                          field.handleChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                        // A tolerance below 0 means none: 0.
                        onBlur={() => {
                          if ((field.state.value ?? 0) < 0) field.handleChange(0);
                        }}
                      />
                    </Label>
                    <FieldMessage issues={issuesAt('numericTolerance')} />
                  </div>
                )}
              </form.Field>
            </div>
            <p className="text-muted-foreground text-xs">{t('questionForm.decimalsAllowed')}</p>
          </fieldset>
        )}

        {/* Les médias, repliés en un seul bloc ; écouter d'abord et la lecture ferment le
          groupe du son. */}
        <div id="qf-media" className="flex flex-col gap-1.5">
          <QuestionMediaField
            value={media}
            onChange={(m) => form.setFieldValue('media', m)}
            withVisual={type !== 'image_choice'}
          >
            {media.visual ? (
              // Where the picture sits against the text on the big screen; the answers stay below.
              <form.Field name="mediaPosition">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">
                      {t('questionForm.mediaPositionLabel')}
                    </span>
                    <Segmented
                      label={t('questionForm.mediaPositionLabel')}
                      value={field.state.value}
                      onChange={field.handleChange}
                      options={MEDIA_POSITIONS.map((position) => ({
                        value: position,
                        label: t(`questionForm.mediaPosition.${position}`),
                        icon: POSITION_ICON[position],
                      }))}
                    />
                    <p className="text-muted-foreground text-xs">
                      {t('questionForm.mediaPositionHint')}
                    </p>
                  </div>
                )}
              </form.Field>
            ) : null}
            {canListenFirst ? (
              <form.Field name="timerAfterMedia">
                {(field) => (
                  <CheckboxField
                    title={t('questionForm.listenFirstHint')}
                    checked={field.state.value}
                    onChange={field.handleChange}
                    label={t('questionForm.listenFirstLabel')}
                    hint={t('questionForm.listenFirstHint')}
                  />
                )}
              </form.Field>
            ) : null}
            {mediaHasSound(media) ? (
              <Disclosure
                title={t('questionForm.playbackLegend')}
                value={[
                  audioTarget
                    ? t(`settings.audioTarget.${audioTarget}`)
                    : t('questionForm.audioTargetDefault'),
                  media.audio ? t(`questionForm.waveformSize.${waveformSize}`) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <form.Field name="audioTarget">
                  {(field) => (
                    <Label title={t('questionForm.audioTargetHint')}>
                      {t('questionForm.audioTargetLabel')}
                      <Select
                        value={field.state.value ?? ''}
                        onChange={(e) =>
                          field.handleChange(
                            e.target.value === '' ? null : (e.target.value as AudioTarget),
                          )
                        }
                      >
                        <option value="">{t('questionForm.audioTargetDefault')}</option>
                        {AUDIO_TARGETS.map((target) => (
                          <option key={target} value={target}>
                            {t(`settings.audioTarget.${target}`)}
                          </option>
                        ))}
                      </Select>
                    </Label>
                  )}
                </form.Field>
                {media.audio ? (
                  <form.Field name="waveformSize">
                    {(field) => (
                      <div className="flex flex-col gap-1.5">
                        <Label title={t('questionForm.waveformSizeHint')}>
                          {t('questionForm.waveformSizeLabel')}
                          <Select
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as WaveformSize)}
                          >
                            {WAVEFORM_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {t(`questionForm.waveformSize.${size}`)}
                              </option>
                            ))}
                          </Select>
                        </Label>
                        {/* As the screens will draw it, at their type size — or, hidden,
                        the one place it still shows (faded, with why). */}
                        {field.state.value === 'hidden' ? (
                          <p className="text-muted-foreground text-xs">
                            {t('questionForm.waveformHiddenNote')}
                          </p>
                        ) : null}
                        <Waveform
                          peaks={media.audio?.peaks ?? []}
                          progress={0}
                          size={field.state.value}
                          className={cn(
                            'text-base',
                            field.state.value === 'hidden' && 'opacity-40',
                          )}
                          label={t('questionForm.waveformPreview')}
                        />
                      </div>
                    )}
                  </form.Field>
                ) : null}
              </Disclosure>
            ) : null}
          </QuestionMediaField>
          <FieldMessage issues={issuesAt('media')} />
        </div>

        {/* Folded like every setting; its summary says the time the room will really get. */}
        <Disclosure
          title={t('questionForm.timingLegend')}
          value={[
            stretchedS > timeLimitS && !(canListenFirst && listenFirst)
              ? t('questionForm.timingSummaryStretched', { time: timeLimitS, total: stretchedS })
              : t('questionForm.timingSummary', { time: timeLimitS }),
            revealDelayS == null
              ? appConfig.autoAdvanceS
                ? t('questionForm.revealDelaySummaryAuto', { seconds: appConfig.autoAdvanceS })
                : t('questionForm.revealDelayAuto')
              : t('questionForm.revealDelaySummary', { seconds: revealDelayS }),
          ].join(' · ')}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <form.Field name="timeLimitS">
              {(field) => (
                <Label>
                  {t('questionForm.timeLimitLabel')}
                  <Input
                    type="number"
                    min={TIME_LIMIT_S.min}
                    max={TIME_LIMIT_S.max}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(Number(e.target.value))}
                    // Out of bounds, the nearest bound — and a note, not an error.
                    onBlur={() => {
                      const next = clampTime(field.state.value);
                      setClamped(next === field.state.value ? null : 'time');
                      field.handleChange(next);
                    }}
                  />
                </Label>
              )}
            </form.Field>
            <form.Field name="revealDelayS">
              {(field) => (
                <Label title={t('questionForm.revealDelayHint')}>
                  {t('questionForm.revealDelayLabel')}
                  <Input
                    type="number"
                    min={REVEAL_DELAY_S.min}
                    max={REVEAL_DELAY_S.max}
                    placeholder={
                      appConfig.autoAdvanceS
                        ? t('questionForm.revealDelayAutoValue', {
                            seconds: appConfig.autoAdvanceS,
                          })
                        : t('questionForm.revealDelayPlaceholder')
                    }
                    value={field.state.value ?? ''}
                    onChange={(e) =>
                      field.handleChange(e.target.value === '' ? null : Number(e.target.value))
                    }
                    onBlur={() => {
                      const next = clampReveal(field.state.value);
                      setClamped(next === field.state.value ? null : 'reveal');
                      field.handleChange(next);
                    }}
                  />
                </Label>
              )}
            </form.Field>
          </div>
          {clamped ? (
            <p className="text-muted-foreground text-sm" role="note">
              {clamped === 'time'
                ? t('questionForm.clampedTime', { ...TIME_LIMIT_S, value: timeLimitS })
                : t('questionForm.clampedReveal', {
                    ...REVEAL_DELAY_S,
                    value: form.getFieldValue('revealDelayS'),
                  })}
            </p>
          ) : null}
          {canListenFirst && listenFirst ? (
            <p className="text-muted-foreground text-sm" role="note">
              {t('questionForm.listenFirstTime', {
                media: Math.ceil((mediaMs ?? 0) / 1000),
                time: timeLimitS,
              })}
            </p>
          ) : stretchedS > timeLimitS ? (
            <p className="text-muted-foreground text-sm" role="note">
              {t('questionForm.stretchedTime', {
                media: Math.ceil((mediaMs ?? 0) / 1000),
                total: stretchedS,
                tail: mediaTailS,
              })}
            </p>
          ) : null}
        </Disclosure>

        {/* Le barème par défaut convient presque toujours : il se lit replié. */}
        {type !== 'poll' && (
          <Disclosure
            title={t('questionForm.pointsLegend')}
            value={[
              t(`questionForm.pointsMode.${pointsMode}`, { defaultValue: pointsMode }),
              scorings.length > 0
                ? t(
                    `questionForm.scoring.${type}.${scorings.includes(scoring) ? scoring : 'standard'}`,
                  )
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="pointsMode">
                {(field) => (
                  <Label>
                    {t('questionForm.pointsLabel')}
                    <Select
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(e.target.value as FormValues['pointsMode'])
                      }
                    >
                      <option value="standard">{t('questionForm.pointsMode.standard')}</option>
                      <option value="double">{t('questionForm.pointsMode.double')}</option>
                      <option value="fixed">{t('questionForm.pointsMode.fixed')}</option>
                    </Select>
                  </Label>
                )}
              </form.Field>
              {scorings.length > 0 && (
                <form.Field name="scoring">
                  {(field) => (
                    <Label>
                      {t('questionForm.scoringLabel')}
                      <Select
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value as Scoring)}
                      >
                        <option value="standard">
                          {t(`questionForm.scoring.${type}.standard`)}
                        </option>
                        {scorings.map((v) => (
                          <option key={v} value={v}>
                            {t(`questionForm.scoring.${type}.${v}`)}
                          </option>
                        ))}
                      </Select>
                    </Label>
                  )}
                </form.Field>
              )}
            </div>
            {/* The rule chosen, in words, where the choice is made. */}
            {scorings.length > 0 ? (
              <p className="text-muted-foreground text-xs leading-snug">
                {t(
                  `questionForm.scoringHelp.${type}.${scorings.includes(scoring) ? scoring : 'standard'}`,
                )}
              </p>
            ) : null}
          </Disclosure>
        )}

        {/* Facultative : repliée, comme tout ce qui est secondaire. */}
        {type !== 'poll' && (
          <form.Field name="answerExplanation">
            {(field) => (
              <Disclosure
                title={t('questionForm.answerExplanationLabel')}
                value={
                  field.state.value.trim()
                    ? t('questionForm.explanationWritten')
                    : t('questionForm.explanationEmpty')
                }
              >
                <MarkdownEditor
                  aria-label={t('questionForm.answerExplanationLabel')}
                  value={field.state.value}
                  onChange={field.handleChange}
                  placeholder={t('questionForm.answerExplanationPlaceholder')}
                />
              </Disclosure>
            )}
          </form.Field>
        )}

        <form.Field name="background">
          {(field) => (
            <div id="qf-backgroundGradient" className="flex flex-col gap-1.5">
              <BackgroundField value={field.state.value} onChange={field.handleChange} />
              <FieldMessage issues={issuesAt('backgroundGradient')} />
            </div>
          )}
        </form.Field>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <ConfirmDialog
          open={askDraft}
          title={t('questionForm.moveToDraft.title')}
          description={t('questionForm.moveToDraft.description')}
          confirmLabel={t('questionForm.moveToDraft.confirmLabel')}
          cancelLabel={t('questionForm.moveToDraft.cancelLabel')}
          onCancel={() => setAskDraft(false)}
          onConfirm={() => void moveToDraftAndSave()}
        />
        <ConfirmDialog
          open={pendingRemoval !== null}
          destructive
          title={t('questionForm.removeOptionConfirm.title')}
          description={t('questionForm.removeOptionConfirm.description', {
            label:
              pendingRemoval !== null
                ? options[pendingRemoval]?.text || `#${pendingRemoval + 1}`
                : '',
          })}
          confirmLabel={t('questionForm.removeOptionConfirm.confirmLabel')}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => {
            if (pendingRemoval !== null)
              setOptions(options.filter((_, idx) => idx !== pendingRemoval));
            setPendingRemoval(null);
          }}
        />
      </form>
    </MediaEditsContext.Provider>
  );
}

/** A draft saved before the image choice: its answers get no picture, it gets one right answer. */
function withDefaults(draft: FormValues): FormValues {
  return {
    ...draft,
    multiSelect: draft.multiSelect ?? false,
    options: draft.options.map((o) => ({ ...o, mediaId: o.mediaId ?? null, alt: o.alt ?? '' })),
  };
}

/** The server's refusal of a question saved unfinished in a published quiz. */
const INCOMPLETE_IN_READY = 'question.incomplete_in_ready_quiz';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));
/** A time out of bounds (or unreadable) becomes the nearest bound, never an error. */
const clampTime = (value: number) =>
  Number.isFinite(value) ? clamp(value, TIME_LIMIT_S.min, TIME_LIMIT_S.max) : TIME_LIMIT_S.default;
const clampReveal = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? null
    : clamp(value, REVEAL_DELAY_S.min, REVEAL_DELAY_S.max);

/** Each option's place in the right order, as 0..n-1 in the order of the places they had. */
function rankPlaces(options: { correctOrderIndex: number }[]): number[] {
  const byPlace = options
    .map((o, i) => ({ place: o.correctOrderIndex, i }))
    .sort((a, b) => a.place - b.place || a.i - b.i);
  const places: number[] = [];
  byPlace.forEach(({ i }, rank) => (places[i] = rank));
  return places;
}

/** Option `index` takes `place`; the option that held it takes the old place of `index`. */
export function swapPlace<T extends { correctOrderIndex: number }>(
  options: T[],
  index: number,
  place: number,
): T[] {
  const from = options[index].correctOrderIndex;
  return options.map((o, i) =>
    i === index
      ? { ...o, correctOrderIndex: place }
      : o.correctOrderIndex === place
        ? { ...o, correctOrderIndex: from }
        : o,
  );
}

/** Legend of a primary section of the form; secondary groups fold in a `Disclosure`. */
const LEGEND = 'text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase';

/** Whether the media play a sound: an MP3, or a video's own track. */
function mediaHasSound(media: QuestionMedia): boolean {
  return !!media.audio || media.visual?.kind === 'video';
}

/** The engine's default reading window before answers open (GAME_READ_DELAY_MS), for the hint. */
const READ_DELAY_DEFAULT_MS = 3000;

/** Each place of the picture, drawn as the screen it gives. */
const POSITION_ICON: Record<MediaPosition, LucideIcon> = {
  bottom: PanelBottom,
  top: PanelTop,
  left: PanelLeft,
  right: PanelRight,
};

/** Construit le payload API en n'envoyant que les champs pertinents pour le type. */
function buildPayload(v: FormValues) {
  const base = {
    type: v.type,
    prompt: v.prompt,
    // Saved before the field was left: the same bounds as on leaving it.
    timeLimitS: clampTime(v.timeLimitS),
    revealDelayS: clampReveal(v.revealDelayS),
    // Nothing to hear, nothing to target: a removed sound takes its setting with it.
    audioTarget: mediaHasSound(v.media) ? v.audioTarget : null,
    waveformSize: v.waveformSize,
    mediaPosition: v.mediaPosition,
    // Only with a media to wait for; the server also falls back when its length is unknown.
    timerAfterMedia: mediaHasSound(v.media) && v.timerAfterMedia,
    // 'none' is a poll's: a restored draft may still carry it after a change of type.
    pointsMode:
      v.type === 'poll'
        ? ('none' as const)
        : v.pointsMode === 'none'
          ? ('standard' as const)
          : v.pointsMode,
    scoring: scoringsFor(v.type, v.multiSelect).includes(v.scoring)
      ? v.scoring
      : ('standard' as const),
    media: v.media,
    answerExplanation: v.answerExplanation.trim() || null,
    backgroundMediaId: v.background.mediaId,
    backgroundGradient: v.background.gradient,
    textTone: v.background.textTone,
    textOutline: v.background.textOutline,
  };
  if (v.type === 'image_choice') {
    return {
      ...base,
      // The answers are the pictures: no visual of the question's own.
      media: { visual: null, audio: v.media.audio } as QuestionMedia,
      multiSelect: v.multiSelect,
      options: v.options.map((o) => ({
        mediaId: o.mediaId ?? undefined,
        alt: o.alt.trim(),
        color: o.color as (typeof COLORS)[number],
        shape: o.shape as (typeof SHAPES)[number],
        isCorrect: o.isCorrect,
      })),
    };
  }
  if (OPTION_TYPES.includes(v.type)) {
    return {
      ...base,
      options: v.options.map((o) => ({
        text: o.text || undefined,
        // A picture an answer already holds (an imported quiz) is kept, not lost on save.
        mediaId: o.mediaId ?? undefined,
        color: o.color as (typeof COLORS)[number],
        shape: o.shape as (typeof SHAPES)[number],
        isCorrect: o.isCorrect,
        correctOrderIndex: v.type === 'ordering' ? o.correctOrderIndex : undefined,
      })),
    };
  }
  if (v.type === 'text_input') {
    return {
      ...base,
      acceptedAnswers: v.acceptedAnswers
        .filter((a) => a.text.trim())
        .map((a) => ({ text: a.text })),
    };
  }
  if (v.type === 'numeric') {
    return {
      ...base,
      numericValue: v.numericValue ?? undefined,
      numericTolerance: v.numericTolerance == null ? undefined : Math.max(0, v.numericTolerance),
    };
  }
  return base;
}

/** Sortable option row: grip handle on the left, keyboard-sortable too. */
function SortableOption({ id, children }: { id: string; children: ReactNode }) {
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
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md',
        isDragging && 'bg-background relative z-10 shadow-md',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={t('questionForm.dragOption')}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      {children}
    </div>
  );
}

/**
 * An image written in the prompt (images are no longer added there, one already
 * there still shows): while the question has no visual, the editor offers to move
 * it to the question's media — framed on every screen, zoomable on the phones and
 * fetched ahead. The author decides, sees the result, and can cancel before saving.
 */
function PromptImageNotice({
  prompt,
  media,
  onMove,
}: {
  prompt: string;
  media: QuestionMedia;
  onMove: (rest: string, media: QuestionMedia) => void;
}) {
  const { t } = useTranslation('editor');
  const found = media.visual ? null : promptImage(prompt);
  if (!found) return null;
  const move = () => {
    onMove(found.rest, {
      visual: { kind: 'image', assetId: found.mediaId },
      audio: media.audio,
    } as QuestionMedia);
    // Its description travels with it, when the media has none yet.
    if (found.alt.trim()) {
      void mediaControllerDescribe(found.mediaId)
        .then((res) =>
          res.data.alt ? null : mediaControllerSetAlt(found.mediaId, { alt: found.alt.trim() }),
        )
        .catch(() => undefined);
    }
  };
  return (
    <div
      role="note"
      className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <ImageIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{t('questionForm.promptImageNotice')}</span>
      <Button type="button" size="sm" variant="outline" onClick={move}>
        {t('questionForm.promptImageMove')}
      </Button>
    </div>
  );
}

/**
 * The question as the room will see it, while it is being written: the real
 * projection or phone (UI system §3), folded until asked for.
 */
function LivePreview({
  values,
  position = { index: 0, total: 1 },
}: {
  values: FormValues;
  position?: { index: number; total: number };
}) {
  const { t } = useTranslation('editor');
  const url = useMediaUrl();
  const [device, setDevice] = useState<'projection' | 'phone'>('projection');
  const [answer, setAnswer] = useState(false);
  // Pinned, it stays at the top while the form scrolls, from one question to the next.
  const [pinned, setPinned] = useSessionState(
    'editor:preview-pinned',
    false,
    (v): v is boolean => typeof v === 'boolean',
  );
  const view = useMemo(() => {
    const question = previewQuestion(values);
    const view = stepView([{ kind: 'question', id: question.id, question }], 0, NO_QUIZ, url, {
      reveal: answer,
    });
    // Where it stands in the quiz, as the room's band will say.
    return {
      ...view,
      questionIndex: position.index,
      totalQuestions: position.total,
      question: view.question && { ...view.question, questionIndex: position.index },
    };
  }, [values, url, answer, position.index, position.total]);
  return (
    <Disclosure
      title={t('preview.title')}
      value={t(`preview.${device}`)}
      rememberAs="question-preview"
      className={cn(pinned && 'bg-background sticky top-0 z-20 shadow-md')}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            size="sm"
            label={t('preview.device')}
            value={device}
            onChange={setDevice}
            options={[
              { value: 'projection', label: t('preview.projection'), icon: Monitor },
              { value: 'phone', label: t('preview.phone'), icon: Smartphone },
            ]}
          />
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={answer}
              onCheckedChange={setAnswer}
              aria-label={t('preview.showAnswer')}
            />
            {t('preview.showAnswer')}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            aria-pressed={pinned}
            onClick={() => setPinned(!pinned)}
          >
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? t('preview.unpin') : t('preview.pin')}
          </Button>
        </div>
        {/* Pinned, it leaves the form most of the screen. */}
        <div className={cn(pinned && 'mx-auto w-full max-w-[calc(40dvh*16/9)]')}>
          <RoomScreen view={view} device={device} />
        </div>
      </div>
    </Disclosure>
  );
}

/** A preview has no quiz around it: no title, no variables. */
const NO_QUIZ = { title: '', description: null, questionCount: 1, tags: [], license: null };

/** The question being written, in the shape of a saved one, for the preview. */
function previewQuestion(v: FormValues): QuizDetailDtoQuestionsItem {
  const p = buildPayload(v) as Partial<QuestionContent> & { media: QuestionMedia };
  return {
    id: 'preview',
    quizId: '',
    orderIndex: 0,
    type: v.type,
    prompt: v.prompt,
    media: p.media,
    answerExplanation: p.answerExplanation ?? null,
    backgroundMediaId: v.background.mediaId,
    backgroundGradient: v.background.gradient,
    textTone: v.background.textTone,
    textOutline: v.background.textOutline,
    timeLimitS: p.timeLimitS ?? TIME_LIMIT_S.default,
    revealDelayS: p.revealDelayS ?? null,
    audioTarget: p.audioTarget ?? null,
    waveformSize: v.waveformSize,
    mediaPosition: v.mediaPosition,
    timerAfterMedia: p.timerAfterMedia ?? false,
    pointsMode: p.pointsMode ?? 'standard',
    scoring: p.scoring ?? 'standard',
    numericValue: v.numericValue == null ? null : String(v.numericValue),
    numericTolerance: v.numericTolerance == null ? null : String(v.numericTolerance),
    multiSelect: v.type === 'image_choice' && v.multiSelect,
    options: (p.options ?? []).map((o, i) => ({
      id: v.options[i]?.key ?? String(i),
      orderIndex: i,
      text: o.text ?? null,
      mediaId: o.mediaId ?? null,
      alt: o.alt ?? null,
      color: o.color,
      shape: o.shape,
      isCorrect: o.isCorrect ?? false,
      correctOrderIndex: o.correctOrderIndex ?? null,
    })),
    acceptedAnswers: (p.acceptedAnswers ?? []).map((a, i) => ({
      id: String(i),
      text: a.text,
      normalized: normalizeAnswer(a.text),
    })),
  } as QuizDetailDtoQuestionsItem;
}
