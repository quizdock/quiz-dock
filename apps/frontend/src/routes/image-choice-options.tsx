import { DndContext, closestCenter, type DragEndEvent, type SensorDescriptor } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IMAGE_CHOICE_OPTION_COUNTS, OPTION_ALT_MAX } from '@quiz-dock/contracts';
import { GripVertical } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CorrectToggle } from '@/components/ui/correct-toggle';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { mediaControllerDescribe } from '../api/generated/media/media';
import { ImageTile } from '../game/image-choice';
import { MediaUpload } from './media-upload';
import { mediaUrl } from '@/lib/media-url';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Segmented } from '@/components/ui/segmented';

/** What the editor keeps of an image choice answer. */
export interface ImageOptionValue {
  key: string;
  color: string;
  shape: string;
  mediaId: string | null;
  alt: string;
  isCorrect: boolean;
}

/**
 * The answers of an image choice: 2 or 4 pictures in the grid the room will see,
 * each tile cropped as the projection crops it. Per answer: a picture from the
 * library (or uploaded), its alternative text in the quiz's language (required:
 * it is the answer for whoever cannot see it, and its label in the history),
 * right or not. Tiles reorder by drag and drop; colours and shapes follow the
 * positions, as for every choice.
 */
export function ImageChoiceOptions<T extends ImageOptionValue>({
  options,
  currentOptions,
  multiSelect,
  showErrors,
  sensors,
  setOptions,
  newOption,
  onCorrect,
  onMultiSelect,
}: {
  options: T[];
  /** The answers as they are now (read when a request comes back, not when it left). */
  currentOptions: () => T[];
  multiSelect: boolean;
  /** After a refused save: the missing pictures and texts are pointed out. */
  showErrors: boolean;
  sensors: SensorDescriptor<object>[];
  /** Re-assigns colour and shape by position. */
  setOptions: (next: T[]) => void;
  newOption: (index: number) => T;
  onCorrect: (index: number, checked: boolean) => void;
  onMultiSelect: (multi: boolean) => void;
}) {
  const { t } = useTranslation('editor');
  // Going down to 2 pictures when the last two hold some: asked first.
  const [confirmTwo, setConfirmTwo] = useState(false);

  const setCount = (count: number) => {
    if (count === options.length) return;
    if (count > options.length) {
      setOptions([
        ...options,
        ...Array.from({ length: count - options.length }, (_, i) => newOption(options.length + i)),
      ]);
    } else if (options.slice(count).some((o) => o.mediaId)) {
      setConfirmTwo(true);
    } else {
      setOptions(options.slice(0, count));
    }
  };
  /** One answer changed, on the answers as they are now (an upload comes back later). */
  const update = (key: string, patch: Partial<ImageOptionValue>) =>
    setOptions(currentOptions().map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.key === active.id);
    const to = options.findIndex((o) => o.key === over.id);
    if (from >= 0 && to >= 0) setOptions(arrayMove(options, from, to));
  };
  /** A picture chosen with no text yet: the media's own description, when it has one, to start from. */
  const onPicture = (key: string, mediaId: string | null) => {
    update(key, { mediaId });
    if (
      !mediaId ||
      currentOptions()
        .find((o) => o.key === key)
        ?.alt.trim()
    )
      return;
    void mediaControllerDescribe(mediaId)
      .then(({ data }) => {
        if (!data.alt) return;
        // Whatever changed meanwhile stays: only this answer, still on this picture
        // and still without a text, takes the description.
        const now = currentOptions();
        const at = now.findIndex((o) => o.key === key);
        if (at < 0 || now[at].mediaId !== mediaId || now[at].alt.trim()) return;
        update(key, { alt: data.alt.slice(0, OPTION_ALT_MAX) });
      })
      .catch(() => undefined); // an empty field, to be written
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('questionForm.imageCountLabel')}</span>
          <Segmented
            size="sm"
            label={t('questionForm.imageCountLabel')}
            value={String(options.length)}
            onChange={(count) => setCount(Number(count))}
            options={IMAGE_CHOICE_OPTION_COUNTS.map((count) => ({
              value: String(count),
              label: String(count),
            }))}
          />
        </div>
        <CheckboxField
          title={t('questionForm.multiSelectHint')}
          checked={multiSelect}
          onChange={onMultiSelect}
          label={t('questionForm.multiSelectLabel')}
        />
      </div>
      <p className="text-muted-foreground -mt-1 text-xs">{t('questionForm.imageCropNote')}</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={options.map((o) => o.key)} strategy={rectSortingStrategy}>
          <div className="grid gap-4 sm:grid-cols-2">
            {options.map((opt, i) => {
              const altMissing = showErrors && !opt.alt.trim();
              const pictureMissing = showErrors && !opt.mediaId;
              return (
                <SortableTile key={opt.key} id={opt.key}>
                  <div className="text-base">
                    <ImageTile
                      src={opt.mediaId ? mediaUrl(opt.mediaId) : null}
                      alt={opt.alt}
                      color={opt.color}
                      shape={opt.shape}
                      className={cn(pictureMissing && 'outline-destructive outline-2')}
                    />
                  </div>
                  <MediaUpload
                    value={opt.mediaId}
                    onChange={(id) => onPicture(opt.key, id)}
                    kind="image"
                    preview={false}
                    assetAlt={false}
                    label={t('questionForm.imageAdd')}
                  />
                  {pictureMissing ? (
                    <p role="alert" className="text-destructive text-xs">
                      {t('questionForm.imageRequired')}
                    </p>
                  ) : null}
                  <label className="flex flex-col gap-1 text-[1em]">
                    <span className="font-medium">{t('questionForm.imageAltLabel')}</span>
                    <Input
                      aria-label={t('questionForm.imageAltAria', { index: i + 1 })}
                      aria-invalid={altMissing || undefined}
                      maxLength={OPTION_ALT_MAX}
                      value={opt.alt}
                      placeholder={t('questionForm.imageAltPlaceholder')}
                      onChange={(e) => update(opt.key, { alt: e.target.value })}
                    />
                    {altMissing ? (
                      <span role="alert" className="text-destructive text-xs">
                        {t('questionForm.imageAltRequired')}
                      </span>
                    ) : null}
                  </label>
                  <CorrectToggle
                    single={!multiSelect}
                    checked={opt.isCorrect}
                    label={t('questionForm.correct')}
                    onChange={(checked) => onCorrect(i, checked)}
                  />
                </SortableTile>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <ConfirmDialog
        open={confirmTwo}
        destructive
        title={t('questionForm.imageCountConfirm.title')}
        description={t('questionForm.imageCountConfirm.description')}
        confirmLabel={t('questionForm.imageCountConfirm.confirmLabel')}
        onCancel={() => setConfirmTwo(false)}
        onConfirm={() => {
          setConfirmTwo(false);
          setOptions(options.slice(0, 2));
        }}
      />
    </div>
  );
}

/** A sortable answer: the grip above its tile, keyboard-sortable too. */
function SortableTile({ id, children }: { id: string; children: ReactNode }) {
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
        'flex flex-col gap-2 rounded-md border p-2',
        isDragging && 'bg-background relative z-10 shadow-md',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={t('questionForm.dragOption')}
        className="text-muted-foreground hover:text-foreground w-fit cursor-grab touch-none rounded p-1 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      {children}
    </div>
  );
}
