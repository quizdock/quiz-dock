import type {
  ClosestRow,
  LeaderboardRow,
  PublicOption,
  QuestionRevealPayload,
  QuestionStartPayload,
  SlideColumnsRatio,
  SlideImageSize,
  SlideLeafBlock,
  SlideShowPayload,
  SlideTextAlign,
  SlideTextSize,
} from '@quiz-dock/contracts';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Markdown } from '@/components/markdown';
import {
  COLOR_BG,
  COLOR_BG_SOFT,
  COLOR_TEXT,
  OPTION_BG_FALLBACK,
  SHAPE_GLYPH,
} from '@/lib/option-style';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';
import { Surface } from './surface';

/**
 * Typography of the live screens is set **once per surface** and everything
 * inside is sized in `em`: the same component scales from a phone to a
 * projector by changing the base only. `stage` is the 1280×720 slide canvas
 * (scaled by transform), `screen` the projected page, `phone` the participant.
 */
export const TYPE_BASE = {
  stage: 'text-[20px]',
  // On the smaller side of the screen: a 16:9 projection runs out of height first.
  screen: 'text-[clamp(1rem,2.6vmin,2.5rem)]',
  phone: 'text-[clamp(0.875rem,0.45rem_+_1.4vmin,1.5rem)]',
} as const;

/**
 * One answer layout for every screen (#92): two columns, as many rows as it takes,
 * so an answer sits at the same place on the projection and on the phone. An odd
 * last answer keeps the width of the others, centred on its own row.
 */
const ANSWER_GRID = 'grid w-full grid-cols-2 gap-[0.6em]';
const lastOdd = (index: number, count: number) =>
  count % 2 === 1 && index === count - 1
    ? 'col-span-2 w-[calc(50%-0.3em)] justify-self-center'
    : undefined;

/** Beyond this label length the tile text steps down a size. */
const OPTION_TILE_MAX_CHARS = 18;

/**
 * Grille d'options colorées + formes, le texte dans la tuile. `onPick` la rend
 * interactive (joueur à distance) ; `correctIds` met en évidence la bonne réponse au
 * reveal ; jamais de flag correct avant (anti-triche §7 — les options publiques n'en
 * portent pas).
 */
export function OptionGrid({
  options,
  onPick,
  selectedIds,
  correctIds,
  highlightIds,
  disabled,
  layout = 'tiles',
}: {
  options: PublicOption[];
  onPick?: (optionId: string) => void;
  /** Options mises en évidence (réponse unique = 1 id ; multi = plusieurs). */
  selectedIds?: string[];
  correctIds?: string[];
  /**
   * Souligne en vert la/les bonne(s) réponse(s) **sans** estomper les autres —
   * indice réservé à l'animateur (console hôte), pas un reveal. Distinct de
   * `correctIds` (qui, lui, estompe les mauvaises au moment du reveal).
   */
  highlightIds?: string[];
  disabled?: boolean;
  /** `tiles`: the coloured tiles. `list` (a participant's reveal): the answers one under the other. */
  layout?: 'tiles' | 'list';
}) {
  if (layout === 'list') {
    return (
      <OptionKey options={options} selectedIds={selectedIds} correctIds={correctIds} showPick />
    );
  }
  const many = options.length > 4;
  const long = options.some((o) => (o.text ?? '').length > OPTION_TILE_MAX_CHARS);
  return (
    <div className={ANSWER_GRID}>
      {options.map((o, i) => {
        const isCorrect = correctIds?.includes(o.id);
        const isPicked = selectedIds?.includes(o.id) ?? false;
        const isHinted = highlightIds?.includes(o.id); // indice animateur (outline verte)
        const dimmed = correctIds && !isCorrect; // au reveal, estompe les mauvaises
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={o.id}
            type={onPick ? 'button' : undefined}
            disabled={onPick ? disabled : undefined}
            onClick={onPick ? () => onPick(o.id) : undefined}
            aria-pressed={onPick ? isPicked : undefined}
            className={cn(
              'flex items-center gap-[0.6em] rounded-[0.75em] px-[0.9em] py-[0.6em] text-left leading-tight font-semibold text-white shadow transition',
              // Five answers and more: lower tiles, so four rows still leave room above.
              many ? 'min-h-[2.6em]' : 'min-h-[3.25em]',
              long ? 'text-[0.95em]' : many ? 'text-[1em]' : 'text-[1.125em]',
              lastOdd(i, options.length),
              COLOR_BG[o.color] ?? OPTION_BG_FALLBACK,
              onPick && !disabled && 'hover:brightness-110 active:scale-[0.98] cursor-pointer',
              dimmed && 'opacity-40',
              isCorrect && 'ring-4 ring-white',
              isPicked && 'ring-4 ring-black/60',
              isHinted && 'outline-success outline outline-2 outline-offset-2',
            )}
            aria-label={o.text ?? o.color}
          >
            <span aria-hidden className="shrink-0 text-[1.35em] leading-none">
              {SHAPE_GLYPH[o.shape] ?? '●'}
            </span>
            {o.text ? (
              <Markdown profile="inline" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {o.text}
              </Markdown>
            ) : null}
            {isCorrect ? <span className="ml-auto">✓</span> : null}
          </Tag>
        );
      })}
    </div>
  );
}

/** The answers, in reading order, keyed by colour and shape (the phone's legend for the tiles). */
export function OptionKey({
  options,
  selectedIds,
  correctIds,
  showPick = false,
}: {
  options: PublicOption[];
  selectedIds?: string[];
  correctIds?: string[];
  /** Tags this participant's pick (a reveal), rather than only shading it. */
  showPick?: boolean;
}) {
  const { t } = useTranslation('live');
  const picked = (id: string) => selectedIds?.includes(id) ?? false;
  return (
    <ol className="flex w-full flex-col gap-[0.4em] text-left">
      {options.map((o) => (
        <li
          key={o.id}
          className={cn(
            'flex items-center gap-[0.6em] rounded-[0.5em] px-[0.6em] py-[0.4em] leading-snug',
            picked(o.id) && 'bg-foreground/10 font-semibold',
            correctIds && !correctIds.includes(o.id) && 'opacity-50',
          )}
        >
          <span
            aria-hidden
            className={cn('shrink-0 text-[1.25em] leading-none', COLOR_TEXT[o.color])}
          >
            {SHAPE_GLYPH[o.shape] ?? '●'}
          </span>
          {o.text ? (
            <Markdown profile="inline" className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {o.text}
            </Markdown>
          ) : null}
          {/* At the reveal: the right answer(s) and what this participant picked. */}
          {correctIds?.includes(o.id) ? (
            <span className="bg-success inline-flex size-[1.3em] shrink-0 items-center justify-center rounded-full text-[0.85em] text-white">
              ✓
            </span>
          ) : null}
          {showPick && picked(o.id) ? (
            <span className="text-muted-foreground shrink-0 text-[0.8em]">
              {t('reveal.yourPick')}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The tap targets of a phone in the room: colour + shape only, big and steady
 * whatever the labels — the text is read on the projection, at the same place.
 */
export function OptionTiles({
  options,
  onPick,
  selectedIds,
  correctIds,
  disabled,
}: {
  options: PublicOption[];
  onPick?: (optionId: string) => void;
  selectedIds?: string[];
  correctIds?: string[];
  disabled?: boolean;
}) {
  const many = options.length > 4;
  return (
    <div className={ANSWER_GRID}>
      {options.map((o, i) => {
        const isCorrect = correctIds?.includes(o.id);
        const isPicked = selectedIds?.includes(o.id) ?? false;
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={o.id}
            type={onPick ? 'button' : undefined}
            disabled={onPick ? disabled : undefined}
            onClick={onPick ? () => onPick(o.id) : undefined}
            aria-label={o.text ?? o.color}
            aria-pressed={onPick ? isPicked : undefined}
            className={cn(
              'flex items-center justify-center rounded-[0.75em] text-[1.6em] leading-none text-white shadow transition',
              // Low enough to leave the prompt its room; five answers and more, lower still.
              many ? 'min-h-[2em]' : 'min-h-[2.75em]',
              lastOdd(i, options.length),
              COLOR_BG[o.color] ?? OPTION_BG_FALLBACK,
              onPick && !disabled && 'hover:brightness-110 active:scale-[0.97] cursor-pointer',
              correctIds && !isCorrect && 'opacity-40',
              isCorrect && 'ring-4 ring-white',
              isPicked && 'ring-4 ring-black/60',
            )}
          >
            <span aria-hidden>{SHAPE_GLYPH[o.shape] ?? '●'}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/** Répartition des réponses par option (barres) — affichée au reveal (§3.3/§4.2). */
export function Distribution({
  options,
  reveal,
}: {
  options: PublicOption[];
  reveal: QuestionRevealPayload;
}) {
  const total = Object.values(reveal.distribution).reduce((a, b) => a + b, 0) || 1;
  return (
    <ul className="flex w-full flex-col gap-[0.5em]">
      {options.map((o) => {
        const n = reveal.distribution[o.id] ?? 0;
        const pct = Math.round((n / total) * 100);
        const isCorrect = reveal.correctOptionIds?.includes(o.id);
        return (
          <li
            key={o.id}
            className={cn(
              'flex items-center gap-[0.5em]',
              // The right answer stands out: full colour and an outline; the others step back.
              reveal.correctOptionIds && !isCorrect && 'opacity-50 grayscale-[0.4]',
            )}
          >
            {/* Same colour + shape codes as the answer grid, so the reveal reads like the question. */}
            <span
              aria-hidden
              className={cn(
                'w-[1.5em] text-center text-[1.25em] leading-none',
                COLOR_TEXT[o.color],
              )}
            >
              {SHAPE_GLYPH[o.shape] ?? '●'}
            </span>
            <div
              className={cn(
                'relative h-[1.9em] flex-1 overflow-hidden rounded-[0.35em]',
                COLOR_BG_SOFT[o.color] ?? 'bg-muted',
                isCorrect && COLOR_TEXT[o.color],
                isCorrect && 'outline outline-[0.15em] outline-offset-[0.15em] outline-current',
              )}
            >
              <div
                className={cn('h-full', COLOR_BG[o.color] ?? OPTION_BG_FALLBACK)}
                style={{ width: `${pct}%` }}
              />
              {/* Intitulé de la réponse en surimpression de la barre. */}
              <span
                className={cn(
                  'text-foreground absolute inset-0 flex items-center px-[0.75em] text-[0.95em] font-medium',
                  isCorrect && 'font-bold',
                )}
              >
                {o.text ?? o.color}
              </span>
            </div>
            {/* Fixed slots (count, then the ✓ badge) so the column stays aligned across rows. */}
            <span className="w-[2.5em] text-right text-[0.95em] tabular-nums">{n}</span>
            <span
              aria-label={isCorrect ? '✓' : undefined}
              className={cn(
                'inline-flex size-[1.4em] shrink-0 items-center justify-center rounded-full text-[0.95em]',
                isCorrect && 'bg-success text-white',
              )}
            >
              {isCorrect ? '✓' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Révélation de la réponse : répartition par option si la question en a (QCM, V/F,
 * ordre, sondage), sinon la **bonne valeur** (numérique / saisie texte).
 */
export function RevealAnswer({
  question,
  reveal,
}: {
  question: QuestionStartPayload;
  reveal: QuestionRevealPayload;
}) {
  const { t } = useTranslation('live');
  const opts = question.options;

  // QCM / V-F / sondage : répartition par option (avec intitulés).
  if (opts?.length && question.type !== 'ordering') {
    return <Distribution options={opts} reveal={reveal} />;
  }

  // Remise en ordre : la « bonne valeur » est une liste d'ids → on affiche les intitulés.
  if (question.type === 'ordering' && opts?.length) {
    const ids = Array.isArray(reveal.correctValue) ? reveal.correctValue : [];
    const labels = ids.map((id) => opts.find((o) => o.id === id)?.text ?? id);
    return (
      <p className="text-[1.25em]">
        {t('reveal.goodOrder')} <strong>{labels.join(' → ')}</strong>
      </p>
    );
  }

  // Numérique / saisie texte : valeur(s) acceptée(s).
  const val = reveal.correctValue;
  const text = Array.isArray(val) ? val.join(t('reveal.or')) : (val ?? '');
  return (
    <div className="flex w-full flex-col items-center gap-[0.75em]">
      <p className="text-[1.25em]">
        {t('reveal.goodAnswer')} <strong>{String(text)}</strong>
      </p>
      {reveal.closest ? <ClosestList rows={reveal.closest} /> : null}
    </div>
  );
}

/** Numeric `closest`: the answers from the closest to the farthest, with the points earned. */
export function ClosestList({ rows }: { rows: ClosestRow[] }) {
  const { t } = useTranslation('live');
  if (rows.length === 0) return null;
  return (
    <div className="flex w-full max-w-[28em] flex-col gap-[0.4em]">
      <h3 className="text-muted-foreground text-[0.9em] font-semibold">
        {t('reveal.closestTitle')}
      </h3>
      <ol className="flex w-full flex-col gap-[0.3em]">
        {rows.map((r) => (
          <li
            key={`${r.rank}-${r.nickname}`}
            className={cn(
              'flex items-center gap-[0.5em] rounded-[0.3em] px-[0.6em] py-[0.3em]',
              r.rank === 1 ? 'bg-success/15 font-semibold' : 'bg-muted/60',
            )}
          >
            <span className="text-muted-foreground w-[1.5em] tabular-nums">{r.rank}.</span>
            <Avatar name={r.avatar || r.nickname} size="1.6em" />
            <span className="min-w-0 flex-1 truncate text-left">{r.nickname}</span>
            <span className="tabular-nums">{r.value}</span>
            <span className="text-muted-foreground w-[4.5em] text-right text-[0.85em] tabular-nums">
              {t('reveal.closestDistance', { distance: +r.distance.toFixed(2) })}
            </span>
            <span className="w-[3.5em] text-right tabular-nums">+{r.points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What kind of answer the question expects (several right answers, all or
 * nothing, tolerance…) and how it scores — shown with the question on the
 * projection and on the phone, so the rules never surprise anyone.
 */
/**
 * The media attached to a question, on every screen that shows the question
 * (#41). Images only for now: an audio question raises its own questions — one
 * source of sound in a room, every device when people are remote — and is left
 * alone rather than half-answered.
 *
 * `maxClassName` caps the height per screen: on a phone the answer zone must
 * stay where the thumb expects it, on a projected screen the image can breathe.
 * The alternative text is generic because a question carries no authored one;
 * the prompt right next to it is what actually describes the question.
 */
export function QuestionMedia({
  media,
  className,
  zoomable = false,
}: {
  media: QuestionStartPayload['media'] | undefined;
  className?: string;
  /** A phone's picture: a tap opens it over the whole screen, another closes it. */
  zoomable?: boolean;
}) {
  const { t } = useTranslation('live');
  const visual = media?.visual;
  if (visual?.kind !== 'image') return null;
  // What the author wrote (#43), or a generic label saying an image is there —
  // never an empty alt, which would hide the image from a screen reader entirely
  // while it carries the question for everyone else.
  const alt = visual.alt?.trim() || t('question.mediaAlt');
  const img = (
    <img
      src={visual.url}
      alt={alt}
      className={cn('mx-auto rounded-lg object-contain', className)}
    />
  );
  return zoomable ? (
    <ZoomableImage src={visual.url} alt={alt}>
      {img}
    </ZoomableImage>
  ) : (
    img
  );
}

/**
 * A picture that opens over the whole screen on a tap and closes on the next
 * (or Escape). The page's clock stays above it: time keeps running.
 */
export function ZoomableImage({
  src,
  alt,
  children,
  className,
}: {
  src: string;
  alt: string;
  /** The picture as it sits in the page. */
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    overlay.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn('mx-auto block max-w-full cursor-zoom-in', className)}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              ref={overlay}
              role="dialog"
              aria-modal="true"
              aria-label={alt}
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 flex cursor-zoom-out items-center justify-center bg-black/90 p-[1em] outline-none"
            >
              <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * The question's clock as a draining bar across the top, the seconds and their
 * icon at its right end (#92): the prompt gets the room a big number took.
 */
export function TimerBar({
  remaining,
  totalS,
  icon,
  label,
  paused = false,
  className,
}: {
  remaining: number;
  /** The full time, for the bar's length; unknown (0) draws it full. */
  totalS: number;
  icon: string;
  label: string;
  paused?: boolean;
  className?: string;
}) {
  const total = Math.max(totalS, remaining);
  const share = total > 0 ? remaining / total : 1;
  // The last seconds turn red, where a player's eye goes anyway.
  const late = !paused && remaining <= 5;
  return (
    <div
      role="timer"
      aria-label={label}
      className={cn('flex w-full items-center gap-[0.6em]', paused && 'opacity-60', className)}
    >
      <div className="bg-muted h-[0.5em] flex-1 overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-1000 ease-linear',
            late ? 'bg-destructive' : 'bg-primary',
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <span className="shrink-0 font-bold whitespace-nowrap tabular-nums">
        <span aria-hidden>{icon}</span> {remaining}
      </span>
    </div>
  );
}

export function AnswerRules({
  question,
  className,
}: {
  question: QuestionStartPayload;
  className?: string;
}) {
  const { t } = useTranslation('live');
  const badge =
    question.type === 'poll' ? null : question.basePoints >= 2000 ? t('rules.double') : null;
  // A scoring variant has its own wording (closest wins, partial credit, typos forgiven).
  const scoring = question.scoring ?? 'standard';
  const ruleKey =
    scoring !== 'standard' ? `rules.${question.type}_${scoring}` : `rules.${question.type}`;
  return (
    <p
      className={cn(
        'text-muted-foreground flex flex-wrap items-center justify-center gap-[0.5em] text-[0.9em]',
        className,
      )}
    >
      <span>{t(ruleKey, { defaultValue: t(`rules.${question.type}`) })}</span>
      {badge ? (
        <span className="rounded-full bg-amber-500/20 px-[0.6em] py-[0.1em] text-[0.85em] font-semibold text-amber-700">
          {badge}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Explanation of the answer (#5): Markdown, present in the reveal payload only
 * when the question has one. Same block on the projected screen, the host
 * console and the participant's phone.
 */
export function AnswerExplanation({
  reveal,
  className,
}: {
  reveal: QuestionRevealPayload;
  className?: string;
}) {
  const { t } = useTranslation('live');
  if (!reveal.answerExplanation) return null;
  return (
    <section
      aria-label={t('reveal.explanation')}
      className={cn(
        'w-full rounded-[0.5em] border bg-muted/40 px-[1em] py-[0.75em] text-left',
        className,
      )}
    >
      <h3 className="text-muted-foreground mb-[0.25em] text-[0.8em] font-semibold uppercase tracking-wide">
        {t('reveal.explanation')}
      </h3>
      <Markdown>{reveal.answerExplanation}</Markdown>
    </section>
  );
}

/**
 * A content slide (#7): a composition of blocks on the whole surface — no
 * max-width, the projected screen is a slide, not a document. Optional
 * full-cover background with light/dark text and a subtitle-like outline.
 */
export function SlideView({ slide }: { slide: SlideShowPayload }) {
  return (
    <Surface
      background={slide.background}
      textTone={slide.textTone}
      textOutline={slide.textOutline}
      // No explicit height: a flex parent stretches it (`h-full` would opt out of stretching).
      className="w-full flex-1"
    >
      <article className="flex h-full min-h-full w-full flex-col justify-center gap-[1.5em] p-[2em]">
        {slide.blocks.map((b) =>
          b.type === 'columns' ? (
            <div
              key={b.id}
              className="grid items-start gap-[2em]"
              style={{ gridTemplateColumns: columnsTemplate(b.columns.length, b.ratio) }}
            >
              {b.columns.map((col, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-[1em]">
                  {col.map((leaf) => (
                    <SlideBlockView key={leaf.id} block={leaf} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <SlideBlockView key={b.id} block={b} />
          ),
        )}
      </article>
    </Surface>
  );
}

/** Grid template for a columns block: equal columns, or a 1-2 / 2-1 split for two. */
export function columnsTemplate(count: number, ratio?: SlideColumnsRatio): string {
  if (count === 2 && ratio === '1-2') return 'minmax(0, 1fr) minmax(0, 2fr)';
  if (count === 2 && ratio === '2-1') return 'minmax(0, 2fr) minmax(0, 1fr)';
  return `repeat(${count}, minmax(0, 1fr))`;
}

/** Text blocks are centred unless the author says otherwise (a slide, not a document). */
const TEXT_ALIGN: Record<SlideTextAlign, string> = {
  left: 'text-left [&_ul]:text-left [&_ol]:text-left',
  center: 'text-center [&_ul]:inline-block [&_ul]:text-left [&_ol]:inline-block [&_ol]:text-left',
  right: 'text-right [&_ul]:text-left [&_ol]:text-left',
};

/** Text block sizes, relative to the surface base (20 px base → 20 / 30 / 40 px on the stage). */
const TEXT_SIZE: Record<SlideTextSize, string> = {
  small: 'text-[1em]',
  medium: 'text-[1.5em]',
  large: 'text-[2em]',
};

const IMAGE_WIDTH: Record<SlideImageSize, string> = {
  small: 'w-1/3',
  medium: 'w-1/2',
  large: 'w-3/4',
  full: 'w-full',
};

function SlideBlockView({ block }: { block: SlideLeafBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 1 ? (
        <h1
          className={cn(
            'text-[3em] leading-tight font-bold text-balance',
            TEXT_ALIGN[block.align ?? 'center'],
          )}
        >
          {block.text}
        </h1>
      ) : (
        <h2
          className={cn(
            'text-[2em] leading-snug font-semibold text-balance',
            TEXT_ALIGN[block.align ?? 'center'],
          )}
        >
          {block.text}
        </h2>
      );
    case 'text':
      return (
        <Markdown
          className={cn(
            'w-full leading-relaxed',
            TEXT_ALIGN[block.align ?? 'center'],
            TEXT_SIZE[block.size ?? 'medium'],
          )}
        >
          {block.md}
        </Markdown>
      );
    case 'image':
      return (
        <img
          src={block.url ?? `/api/v1/media/${block.mediaId}`}
          alt=""
          className={cn(
            'max-h-[18em] rounded-[0.5em] object-contain',
            IMAGE_WIDTH[block.size],
            block.align === 'center' ? 'mx-auto' : block.align === 'right' ? 'ml-auto' : 'mr-auto',
          )}
        />
      );
  }
}

/**
 * Classement en liste (une ligne par participant, top `max`) avec **barre de
 * progression** proportionnelle au score du leader. Surligne le joueur courant si
 * `highlightRank` est fourni. Utilisé à l'affichage de la réponse (entre questions).
 */
export function LeaderboardList({
  rows,
  highlightRank,
  max = 10,
}: {
  rows: LeaderboardRow[];
  highlightRank?: number;
  max?: number;
}) {
  const shown = rows.slice(0, max);
  const topScore = Math.max(0, ...shown.map((r) => r.score));
  return (
    <ol className="flex w-full flex-col gap-[0.4em]">
      {shown.map((r) => {
        const pct = topScore > 0 ? Math.round((r.score / topScore) * 100) : 0;
        const me = r.rank === highlightRank;
        return (
          <li
            key={`${r.rank}-${r.nickname}`}
            className={cn(
              'relative flex items-center gap-[0.5em] overflow-hidden rounded-[0.3em] px-[0.75em] py-[0.4em]',
              me ? 'ring-primary font-semibold ring-2' : '',
            )}
          >
            {/* Barre de progression (fond) : largeur ∝ score / score du leader. */}
            <div
              className={cn('absolute inset-y-0 left-0', me ? 'bg-primary/25' : 'bg-primary/15')}
              style={{ width: `${pct}%` }}
              aria-hidden
            />
            <span className="text-muted-foreground relative tabular-nums">{r.rank}.</span>
            <Avatar name={r.avatar || r.nickname} size="1.75em" />
            <span className="relative min-w-0 flex-1 truncate text-left">{r.nickname}</span>
            <span className="relative tabular-nums">{r.score}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Podium top 3 (participant + projeté, §5.5). */
export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const order = [rows[1], rows[0], rows[2]]; // 2 · 1 · 3
  const heights = ['h-[6em]', 'h-[8em]', 'h-[5em]'];
  return (
    <div className="flex items-end justify-center gap-[0.75em]">
      {order.map((r, i) =>
        r ? (
          <div key={r.rank} className="flex w-[6em] flex-col items-center gap-[0.25em]">
            <Avatar name={r.avatar || r.nickname} size="3em" />
            <span className="max-w-full truncate font-semibold">{r.nickname}</span>
            <span className="text-muted-foreground text-[0.875em] tabular-nums">{r.score}</span>
            <div
              className={cn(
                'flex w-full items-start justify-center rounded-t-[0.5em] pt-[0.5em] text-[1.5em] font-bold text-white',
                heights[i],
                r.rank === 1 ? 'bg-amber-500' : r.rank === 2 ? 'bg-slate-400' : 'bg-amber-800',
              )}
            >
              {r.rank}
            </div>
          </div>
        ) : (
          <div key={`empty-${i}`} className="w-[6em]" />
        ),
      )}
    </div>
  );
}
