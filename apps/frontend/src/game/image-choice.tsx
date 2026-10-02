import { type PublicOption, TILE_RATIO } from '@quiz-dock/contracts';
import type { ReactNode } from 'react';
import { AnswerGlyph } from '@/components/answer-glyph';
import { COLOR_BG, OPTION_BG_FALLBACK } from '@/lib/option-style';
import { cn } from '@/lib/utils';
import { BACKDROP_EDGE } from './surface';

/**
 * An answer's colour and shape over a picture: a white shape in a square of the
 * answer's colour, both haloed so they read over any image. Sized by the text
 * around it (em), like every live element.
 */
export function ShapeBadge({
  color,
  shape,
  index = 0,
  className,
}: {
  color: string;
  shape: string;
  /** Its place among the answers, for a letter or number theme. */
  index?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[1.8em] shrink-0 items-center justify-center rounded-[0.3em] text-white',
        'shadow-[0_0_0_0.12em_rgb(255_255_255/0.9),0_0.1em_0.5em_rgb(0_0_0/0.55)]',
        COLOR_BG[color] ?? OPTION_BG_FALLBACK,
        className,
      )}
    >
      <AnswerGlyph
        shape={shape}
        index={index}
        className="size-[1.1em] drop-shadow-[0_0_0.08em_rgb(0_0_0/0.7)]"
      />
    </span>
  );
}

/** How a tile shows at the reveal: as it was, dimmed (a wrong one) or put forward (a right one). */
export type TileState = 'idle' | 'dim' | 'correct';

/**
 * One answer of an image choice: the picture cropped to the tile's fixed ratio
 * (`object-fit: cover`, what the room sees), framed in the answer's colour, its
 * shape badge in the corner. The same tile on the projection, the phones and the
 * editor's preview, so an answer never looks different from one to the other.
 */
export function ImageTile({
  src,
  alt,
  color,
  shape,
  index = 0,
  state = 'idle',
  className,
  children,
}: {
  /** The picture's URL; none yet (editor) leaves the tile empty, framed and badged. */
  src: string | null;
  alt: string;
  color: string;
  shape: string;
  /** Its place among the answers (the glyph of a letter or number theme). */
  index?: number;
  state?: TileState;
  className?: string;
  /** Laid over the picture, bottom right: a count, a tick. */
  children?: ReactNode;
}) {
  return (
    <div
      data-color={color}
      data-correct={state === 'idle' ? undefined : String(state === 'correct')}
      className={cn(
        'qd-answer relative w-full overflow-hidden rounded-[0.5em] p-[0.2em] transition-[opacity,box-shadow]',
        COLOR_BG[color] ?? OPTION_BG_FALLBACK,
        // Put forward whatever the page behind: a ring in the success colour, clear of the frame.
        state === 'correct'
          ? 'ring-success ring-offset-background ring-[0.25em] ring-offset-[0.2em]'
          : BACKDROP_EDGE,
        className,
      )}
      style={{ aspectRatio: TILE_RATIO }}
    >
      <div className="bg-muted relative size-full overflow-hidden rounded-[0.35em]">
        {src ? (
          <img src={src} alt={alt} className="size-full object-cover" draggable={false} />
        ) : null}
        {state === 'dim' ? <div aria-hidden className="absolute inset-0 bg-black/65" /> : null}
      </div>
      <ShapeBadge
        color={color}
        shape={shape}
        index={index}
        className="absolute top-[0.5em] left-[0.5em]"
      />
      {children ? (
        <div className="absolute right-[0.5em] bottom-[0.5em] flex items-center gap-[0.3em]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** What names an answer to whoever cannot see it: its text, else its picture's alt, else its colour. */
export const optionLabel = (o: Pick<PublicOption, 'text' | 'color' | 'media'>): string =>
  o.text || o.media?.alt || o.color;

/** Gap between tiles, in em (the grid's size is worked out with it). */
const GAP_EM = 0.6;

/**
 * Width of a grid of `count` pictures that fills its container without
 * overflowing it: the container's width, or the width its height allows —
 * rows of tiles at TILE_RATIO, the gaps between them included.
 */
export function screenFitWidth(count: number): string {
  const rows = Math.ceil(count / 2);
  const rowsHigh = `(100cqh - ${(rows - 1) * GAP_EM}em)`;
  return `min(100cqw, calc(${rowsHigh} * ${(2 * TILE_RATIO) / rows} + ${GAP_EM}em))`;
}

/**
 * The answers of an image choice, two columns: one row for 2 pictures, two rows
 * for 4. `fit="screen"` (a projection, the big screen view) makes the grid as
 * large as the space it is given allows, in width and in height, without ever
 * overflowing it — the parent gives it a definite height (a flex item with
 * `min-h-0`). `fit="width"` (a phone, a preview) takes the width and lets the
 * page scroll.
 *
 * At the reveal, `correctIds` dims the wrong tiles and puts the right one(s)
 * forward; `counts` lays each answer's count on its tile.
 */
export function ImageChoiceGrid({
  options,
  fit = 'width',
  correctIds,
  counts,
  selectedIds,
  highlightIds,
  onPick,
  disabled,
  className,
}: {
  options: PublicOption[];
  fit?: 'screen' | 'width';
  correctIds?: string[];
  counts?: Record<string, number>;
  /** The host's hint on the console: the right one(s) outlined, nothing dimmed (not a reveal). */
  highlightIds?: string[];
  selectedIds?: string[];
  onPick?: (optionId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const width = screenFitWidth(options.length);
  const grid = (
    <ul
      className={cn('qd-answers grid grid-cols-2', fit === 'width' && 'w-full')}
      data-layout="images"
      style={{ gap: `${GAP_EM}em`, ...(fit === 'screen' ? { width } : {}) }}
    >
      {options.map((o, i) => {
        const state: TileState = !correctIds
          ? 'idle'
          : correctIds.includes(o.id)
            ? 'correct'
            : 'dim';
        const picked = selectedIds?.includes(o.id) ?? false;
        const tile = (
          <ImageTile
            src={o.media?.url ?? null}
            alt={o.media?.alt ?? ''}
            color={o.color}
            shape={o.shape}
            index={i}
            state={state}
            className={cn(
              picked && 'outline-foreground outline-[0.25em] outline-offset-[0.15em] outline',
              highlightIds?.includes(o.id) &&
                'outline-success outline-[0.2em] outline-offset-[0.15em] outline',
            )}
          >
            {counts ? (
              <span className="rounded-full bg-black/75 px-[0.6em] py-[0.1em] text-[1.3em] font-bold text-white tabular-nums">
                {counts[o.id] ?? 0}
              </span>
            ) : null}
            {state === 'correct' ? (
              <span
                aria-hidden
                className="bg-success inline-flex size-[1.6em] items-center justify-center rounded-full text-[1.1em] text-white"
              >
                ✓
              </span>
            ) : null}
          </ImageTile>
        );
        return (
          <li key={o.id}>
            {onPick ? (
              <button
                type="button"
                disabled={disabled}
                aria-pressed={picked}
                aria-label={optionLabel(o)}
                onClick={() => onPick(o.id)}
                className={cn(
                  'block w-full rounded-[0.5em] transition',
                  !disabled && 'cursor-pointer hover:brightness-110 active:scale-[0.98]',
                )}
              >
                {tile}
              </button>
            ) : (
              tile
            )}
          </li>
        );
      })}
    </ul>
  );
  if (fit === 'width') return <div className={cn('w-full', className)}>{grid}</div>;
  return (
    <div
      className={cn('flex min-h-0 w-full items-center justify-center', className)}
      style={{ containerType: 'size' }}
    >
      {grid}
    </div>
  );
}
