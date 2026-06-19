import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '../api/http';
import type { QuizDetailDtoQuestionsItem } from '../api/generated/model';
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

const TYPES: { value: QType; label: string }[] = [
  { value: 'single_choice', label: 'QCM (réponse unique)' },
  { value: 'multiple_choice', label: 'QCM (multi-réponses)' },
  { value: 'true_false', label: 'Vrai / Faux' },
  { value: 'text_input', label: 'Saisie texte' },
  { value: 'numeric', label: 'Numérique' },
  { value: 'ordering', label: 'Remise en ordre' },
  { value: 'poll', label: 'Sondage' },
];

const COLORS = ['red', 'blue', 'yellow', 'green'] as const;
const SHAPES = ['triangle', 'diamond', 'circle', 'square'] as const;
const OPTION_TYPES: QType[] = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'ordering',
  'poll',
];
const SINGLE_CORRECT: QType[] = ['single_choice', 'true_false'];

interface OptionValue {
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
  timeLimitS: number;
  pointsMode: 'standard' | 'double' | 'none';
  numericValue: number;
  numericTolerance: number;
  options: OptionValue[];
  acceptedAnswers: { text: string }[];
}

function newOption(i: number, text = ''): OptionValue {
  return {
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
      timeLimitS: 20,
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
    timeLimitS: q.timeLimitS,
    pointsMode: q.pointsMode as FormValues['pointsMode'],
    numericValue: q.numericValue ? Number(q.numericValue) : 0,
    numericTolerance: q.numericTolerance ? Number(q.numericTolerance) : 0,
    options: q.options.map((o, i) => ({
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
}: {
  quizId: string;
  question?: QuizDetailDtoQuestionsItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const add = useQuestionsControllerAdd();
  const update = useQuestionsControllerUpdate();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: initialValues(question),
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
        onClose();
      } catch (err) {
        setError(apiErrorMessage(err, 'Question invalide.'));
      }
    },
  });

  const type = useStore(form.store, (s) => s.values.type);
  const mediaId = useStore(form.store, (s) => s.values.mediaId);
  const options = useStore(form.store, (s) => s.values.options);
  const answers = useStore(form.store, (s) => s.values.acceptedAnswers);

  const setOptions = (next: OptionValue[]) => form.setFieldValue('options', next);

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

  const optionField = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm';

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-primary/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Label>
        Type
        <Select value={type} onChange={(e) => onTypeChange(e.target.value as QType)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Label>

      <form.Field name="prompt">
        {(field) => (
          <Label>
            Énoncé
            <Textarea
              rows={4}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Votre question…"
            />
          </Label>
        )}
      </form.Field>

      <MediaUpload value={mediaId} onChange={(id) => form.setFieldValue('mediaId', id)} />

      <div className="flex flex-wrap gap-4">
        <form.Field name="timeLimitS">
          {(field) => (
            <Label>
              Temps (s)
              <Input
                type="number"
                min={5}
                max={120}
                className="w-24"
                value={field.state.value}
                onChange={(e) => field.handleChange(Number(e.target.value))}
              />
            </Label>
          )}
        </form.Field>
        {type !== 'poll' && (
          <form.Field name="pointsMode">
            {(field) => (
              <Label>
                Points
                <Select
                  className="w-32"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as FormValues['pointsMode'])}
                >
                  <option value="standard">Standard</option>
                  <option value="double">Double</option>
                </Select>
              </Label>
            )}
          </form.Field>
        )}
      </div>

      {OPTION_TYPES.includes(type) && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Options</legend>
          {options.map((opt, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`option ${i + 1}`}
                className="flex-1"
                value={opt.text}
                onChange={(e) =>
                  setOptions(
                    options.map((o, idx) => (idx === i ? { ...o, text: e.target.value } : o)),
                  )
                }
                placeholder={`Option ${i + 1}`}
              />
              <select
                aria-label={`couleur ${i + 1}`}
                className={optionField}
                value={opt.color}
                onChange={(e) =>
                  setOptions(
                    options.map((o, idx) => (idx === i ? { ...o, color: e.target.value } : o)),
                  )
                }
              >
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                aria-label={`forme ${i + 1}`}
                className={optionField}
                value={opt.shape}
                onChange={(e) =>
                  setOptions(
                    options.map((o, idx) => (idx === i ? { ...o, shape: e.target.value } : o)),
                  )
                }
              >
                {SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {type === 'ordering' ? (
                <Input
                  type="number"
                  aria-label={`rang ${i + 1}`}
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
                  correcte
                </label>
              )}

              {type !== 'true_false' && options.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Retirer l’option ${i + 1}`}
                  onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {type !== 'true_false' && options.length < 6 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setOptions([...options, newOption(options.length)])}
            >
              <Plus className="size-4" />
              Ajouter une option
            </Button>
          )}
        </fieldset>
      )}

      {type === 'text_input' && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Réponses acceptées</legend>
          {answers.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`réponse ${i + 1}`}
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
                aria-label={`Retirer la réponse ${i + 1}`}
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
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => form.setFieldValue('acceptedAnswers', [...answers, { text: '' }])}
          >
            <Plus className="size-4" />
            Ajouter une réponse
          </Button>
        </fieldset>
      )}

      {type === 'numeric' && (
        <div className="flex flex-wrap gap-4">
          <form.Field name="numericValue">
            {(field) => (
              <Label>
                Valeur cible
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
                Tolérance ±
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending || update.isPending}>
          {question ? 'Enregistrer' : 'Ajouter'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/** Construit le payload API en n'envoyant que les champs pertinents pour le type. */
function buildPayload(v: FormValues) {
  const base = {
    type: v.type,
    prompt: v.prompt,
    timeLimitS: v.timeLimitS,
    pointsMode: v.type === 'poll' ? ('none' as const) : v.pointsMode,
    ...(v.mediaId ? { mediaId: v.mediaId } : {}),
  };
  if (OPTION_TYPES.includes(v.type)) {
    return {
      ...base,
      options: v.options.map((o) => ({
        text: o.text || undefined,
        color: o.color as 'red' | 'blue' | 'yellow' | 'green',
        shape: o.shape as 'triangle' | 'diamond' | 'circle' | 'square',
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
