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
import type { SlideGradient, SlideTextTone } from '@quiz-dock/contracts';
import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store';
import { DraftNotice } from '@/components/draft-notice';
import { MarkdownEditor } from '@/components/markdown-editor';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { COLOR_BG, OPTION_BG_FALLBACK, SHAPE_GLYPH } from '@/lib/option-style';
import { cn } from '@/lib/utils';
import { apiErrorText } from '../api/http';
import type { QuizDetailDtoQuestionsItem } from '../api/generated/model';
import { BackgroundField, NO_BACKGROUND, type BackgroundValue } from './background-field';
import { MediaUpload } from './media-upload';
import {
  useQuestionsControllerAdd,
  useQuestionsControllerUpdate,
} from '../api/generated/questions/questions';
import { getQuizzesControllerGetQueryKey } from '../api/generated/quizzes/quizzes';

type QType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'text_input'
  | 'numeric'
  | 'ordering'
  | 'poll';

const TYPES: QType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'text_input',
  'numeric',
  'ordering',
  'poll',
];

// Eight distinct colour+shape pairs, one per position: no two options ever look alike (max 8).
const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'pink', 'teal'] as const;
const SHAPES = [
  'triangle',
  'diamond',
  'circle',
  'square',
  'star',
  'hexagon',
  'heart',
  'cross',
] as const;
const OPTION_TYPES: QType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'ordering',
  'poll',
];
const SINGLE_CORRECT: QType[] = ['single_choice', 'true_false'];

interface OptionValue {
  /** Client-only stable key (drag and drop); never sent. */
  key: string;
  text: string;
  color: string;
  shape: string;
  isCorrect: boolean;
  correctOrderIndex: number;
}
interface FormValues {
  type: QType;
  prompt: string;
  mediaId: string | null;
  answerExplanation: string;
  background: BackgroundValue;
  timeLimitS: number;
  revealDelayS: number | null;
  pointsMode: 'standard' | 'double' | 'none';
  numericValue: number;
  numericTolerance: number;
  options: OptionValue[];
  acceptedAnswers: { text: string }[];
}

let optionSeq = 0;
const optionKey = () => `opt-${++optionSeq}`;

function newOption(i: number, text = ''): OptionValue {
  return {
    key: optionKey(),
    text,
    color: COLORS[i % COLORS.length],
    shape: SHAPES[i % SHAPES.length],
    isCorrect: false,
    correctOrderIndex: i,
  };
}

function initialValues(q?: QuizDetailDtoQuestionsItem): FormValues {
  if (!q) {
    return {
      type: 'single_choice',
      prompt: '',
      mediaId: null,
      answerExplanation: '',
      background: NO_BACKGROUND,
      timeLimitS: 20,
      revealDelayS: null,
      pointsMode: 'standard',
      numericValue: 0,
      numericTolerance: 0,
      options: [newOption(0), newOption(1)],
      acceptedAnswers: [],
    };
  }
  return {
    type: q.type as QType,
    prompt: q.prompt,
    mediaId: q.mediaId ?? null,
    answerExplanation: q.answerExplanation ?? '',
    background: {
      mediaId: q.backgroundMediaId ?? null,
      gradient: (q.backgroundGradient as SlideGradient | null | undefined) ?? null,
      textTone: (q.textTone as SlideTextTone | undefined) ?? 'light',
      textOutline: q.textOutline ?? true,
    },
    timeLimitS: q.timeLimitS,
    revealDelayS: q.revealDelayS ?? null,
    pointsMode: q.pointsMode as FormValues['pointsMode'],
    numericValue: q.numericValue ? Number(q.numericValue) : 0,
    numericTolerance: q.numericTolerance ? Number(q.numericTolerance) : 0,
    options: q.options.map((o, i) => ({
      key: o.id,
      text: o.text ?? '',
      color: o.color,
      shape: o.shape,
      isCorrect: o.isCorrect,
      correctOrderIndex: o.correctOrderIndex ?? i,
    })),
    acceptedAnswers: q.acceptedAnswers.map((a) => ({ text: a.text })),
  };
}

export function QuestionForm({
  quizId,
  question,
  onClose,
  onDirtyChange,
}: {
  quizId: string;
  question?: QuizDetailDtoQuestionsItem;
  onClose: () => void;
  /** Reports unsaved edits so the parent can guard against losing them. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(['editor', 'common']);
  const queryClient = useQueryClient();
  const add = useQuestionsControllerAdd();
  const update = useQuestionsControllerUpdate();
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Computed once: option keys are generated, so a fresh copy per render would reset the form.
  const [initial] = useState(() => initialValues(question));
  // Draft kept in localStorage until saved or discarded (survives reload / closed tab).
  const draftKey = `quiz:${quizId}:question:${question?.id ?? 'new'}`;
  const [restored, setRestored] = useState(() => loadDraft<FormValues>(draftKey));

  const form = useForm({
    defaultValues: restored ?? initial,
    onSubmit: async ({ value }) => {
      setError(null);
      const data = buildPayload(value);
      try {
        if (question) {
          await update.mutateAsync({ qid: question.id, data });
        } else {
          await add.mutateAsync({ id: quizId, data });
        }
        await queryClient.invalidateQueries({
          queryKey: getQuizzesControllerGetQueryKey(quizId),
        });
        clearDraft(draftKey);
        onClose();
      } catch (err) {
        setError(apiErrorText(err, t('questionForm.invalidError')));
      }
    },
  });
  const values = useStore(form.store, (s) => s.values);
  useEffect(() => {
    if (JSON.stringify(values) === JSON.stringify(initial)) clearDraft(draftKey);
    else saveDraft(draftKey, values);
  }, [values, initial, draftKey]);
  const discardDraft = () => {
    clearDraft(draftKey);
    setRestored(null);
    form.reset(initial);
  };

  const type = useStore(form.store, (s) => s.values.type);
  // Dirty = values differ from what was loaded (a fresh question is dirty as soon as typed in).
  const dirty = useStore(form.store, (s) => JSON.stringify(s.values) !== JSON.stringify(initial));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useUnsavedGuard(dirty);
  const cancel = () => (dirty ? setConfirmDiscard(true) : onClose());
  const mediaId = useStore(form.store, (s) => s.values.mediaId);
  const options = useStore(form.store, (s) => s.values.options);
  const answers = useStore(form.store, (s) => s.values.acceptedAnswers);

  // Colour and shape are a pair fixed by position (red ▲, blue ◆, yellow ●, green ■):
  // nothing to choose, and removing an option re-flows the ones after it.
  const setOptions = (next: OptionValue[]) =>
    form.setFieldValue(
      'options',
      next.map((o, i) => ({
        ...o,
        color: COLORS[i % COLORS.length],
        shape: SHAPES[i % SHAPES.length],
      })),
    );
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

  const onTypeChange = (t: QType) => {
    form.setFieldValue('type', t);
    if (t === 'true_false') {
      setOptions([newOption(0, 'Vrai'), newOption(1, 'Faux')]);
    } else if (OPTION_TYPES.includes(t) && options.length < 2) {
      setOptions([newOption(0), newOption(1)]);
    }
  };

  const setCorrect = (index: number, checked: boolean) => {
    setOptions(
      options.map((o, i) => ({
        ...o,
        isCorrect: SINGLE_CORRECT.includes(type)
          ? i === index
          : i === index
            ? checked
            : o.isCorrect,
      })),
    );
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {restored ? <DraftNotice onDiscard={discardDraft} /> : null}
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

      <form.Field name="prompt">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">
              {t('questionForm.promptLabel')}
            </span>
            <MarkdownEditor
              aria-label={t('questionForm.promptLabel')}
              value={field.state.value}
              onChange={field.handleChange}
              placeholder={t('questionForm.promptPlaceholder')}
            />
          </div>
        )}
      </form.Field>

      <MediaUpload value={mediaId} onChange={(id) => form.setFieldValue('mediaId', id)} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <form.Field name="timeLimitS">
          {(field) => (
            <Label>
              {t('questionForm.timeLimitLabel')}
              <Input
                type="number"
                min={5}
                max={120}
                value={field.state.value}
                onChange={(e) => field.handleChange(Number(e.target.value))}
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
                min={1}
                max={300}
                placeholder={t('questionForm.revealDelayPlaceholder')}
                value={field.state.value ?? ''}
                onChange={(e) =>
                  field.handleChange(e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Label>
          )}
        </form.Field>
        {type !== 'poll' && (
          <form.Field name="pointsMode">
            {(field) => (
              <Label>
                {t('questionForm.pointsLabel')}
                <Select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as FormValues['pointsMode'])}
                >
                  <option value="standard">{t('questionForm.pointsMode.standard')}</option>
                  <option value="double">{t('questionForm.pointsMode.double')}</option>
                </Select>
              </Label>
            )}
          </form.Field>
        )}
      </div>

      {OPTION_TYPES.includes(type) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
            {t('questionForm.optionsLegend')}
          </legend>
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
                    {SHAPE_GLYPH[opt.shape] ?? '●'}
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
                    <Input
                      type="number"
                      aria-label={t('questionForm.orderAriaLabel', { index: i + 1 })}
                      min={0}
                      className="w-20"
                      value={opt.correctOrderIndex}
                      onChange={(e) =>
                        setOptions(
                          options.map((o, idx) =>
                            idx === i ? { ...o, correctOrderIndex: Number(e.target.value) } : o,
                          ),
                        )
                      }
                    />
                  ) : type === 'poll' ? null : (
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type={SINGLE_CORRECT.includes(type) ? 'radio' : 'checkbox'}
                        name="correct"
                        checked={opt.isCorrect}
                        onChange={(e) => setCorrect(i, e.target.checked)}
                      />
                      {t('questionForm.correct')}
                    </label>
                  )}

                  {type !== 'true_false' && options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('questionForm.removeOption', { index: i + 1 })}
                      onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </SortableOption>
              ))}
            </SortableContext>
          </DndContext>
          {type !== 'true_false' && options.length < COLORS.length && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setOptions([...options, newOption(options.length)])}
            >
              <Plus className="size-4" />
              {t('questionForm.addOption')}
            </Button>
          )}
        </fieldset>
      )}

      {type === 'text_input' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
            {t('questionForm.acceptedAnswersLegend')}
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
                aria-label={t('questionForm.removeAnswer', { index: i + 1 })}
                onClick={() =>
                  form.setFieldValue(
                    'acceptedAnswers',
                    answers.filter((_, idx) => idx !== i),
                  )
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => form.setFieldValue('acceptedAnswers', [...answers, { text: '' }])}
          >
            <Plus className="size-4" />
            {t('questionForm.addAnswer')}
          </Button>
        </fieldset>
      )}

      {type === 'numeric' && (
        <div className="flex flex-wrap gap-4">
          <form.Field name="numericValue">
            {(field) => (
              <Label>
                {t('questionForm.numericValueLabel')}
                <Input
                  type="number"
                  className="w-32"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                />
              </Label>
            )}
          </form.Field>
          <form.Field name="numericTolerance">
            {(field) => (
              <Label>
                {t('questionForm.numericToleranceLabel')}
                <Input
                  type="number"
                  min={0}
                  className="w-32"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                />
              </Label>
            )}
          </form.Field>
        </div>
      )}

      {type !== 'poll' && (
        <form.Field name="answerExplanation">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium leading-none">
                {t('questionForm.answerExplanationLabel')}
              </span>
              <MarkdownEditor
                aria-label={t('questionForm.answerExplanationLabel')}
                value={field.state.value}
                onChange={field.handleChange}
                placeholder={t('questionForm.answerExplanationPlaceholder')}
              />
            </div>
          )}
        </form.Field>
      )}

      <form.Field name="background">
        {(field) => <BackgroundField value={field.state.value} onChange={field.handleChange} />}
      </form.Field>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={!dirty || add.isPending || update.isPending}>
          {question ? t('questionForm.submitUpdate') : t('questionForm.submitAdd')}
        </Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          {t('common:cancel')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        destructive
        title={t('discardConfirm.title')}
        description={t('discardConfirm.description')}
        confirmLabel={t('discardConfirm.confirmLabel')}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          clearDraft(draftKey);
          onClose();
        }}
      />
    </form>
  );
}

/** Construit le payload API en n'envoyant que les champs pertinents pour le type. */
function buildPayload(v: FormValues) {
  const base = {
    type: v.type,
    prompt: v.prompt,
    timeLimitS: v.timeLimitS,
    revealDelayS: v.revealDelayS,
    pointsMode: v.type === 'poll' ? ('none' as const) : v.pointsMode,
    ...(v.mediaId ? { mediaId: v.mediaId } : {}),
    answerExplanation: v.answerExplanation.trim() || null,
    backgroundMediaId: v.background.mediaId,
    backgroundGradient: v.background.gradient,
    textTone: v.background.textTone,
    textOutline: v.background.textOutline,
  };
  if (OPTION_TYPES.includes(v.type)) {
    return {
      ...base,
      options: v.options.map((o) => ({
        text: o.text || undefined,
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
      numericValue: v.numericValue,
      numericTolerance: v.numericTolerance,
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
