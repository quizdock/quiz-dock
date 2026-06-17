import type { LeaderboardRow, PublicOption, QuestionRevealPayload } from '@roux-quizz/contracts';
import { cn } from '@/lib/utils';

/** Glyphe par forme — accessibilité couleur + forme (technique §4). */
export const SHAPE_GLYPH: Record<string, string> = {
  triangle: '▲',
  diamond: '◆',
  circle: '●',
  square: '■',
};

/** Couleur de fond par option (cohérent avec l'éditeur / l'aperçu). */
export const COLOR_BG: Record<string, string> = {
  red: 'bg-red-600',
  blue: 'bg-blue-600',
  yellow: 'bg-amber-500',
  green: 'bg-green-600',
};

/**
 * Grille d'options colorées + formes. `onPick` la rend interactive (joueur) ;
 * `correctIds` met en évidence la bonne réponse au reveal ; jamais de flag correct
 * avant (anti-triche §7 — les options publiques n'en portent pas).
 */
export function OptionGrid({
  options,
  onPick,
  pickedId,
  correctIds,
  disabled,
  size = 'md',
}: {
  options: PublicOption[];
  onPick?: (optionId: string) => void;
  pickedId?: string | null;
  correctIds?: string[];
  disabled?: boolean;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((o) => {
        const isCorrect = correctIds?.includes(o.id);
        const isPicked = pickedId === o.id;
        const dimmed = correctIds && !isCorrect; // au reveal, estompe les mauvaises
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={o.id}
            type={onPick ? 'button' : undefined}
            disabled={onPick ? disabled : undefined}
            onClick={onPick ? () => onPick(o.id) : undefined}
            className={cn(
              'flex items-center gap-3 rounded-xl px-4 font-semibold text-white shadow transition',
              size === 'lg' ? 'py-8 text-2xl' : 'py-5 text-lg',
              COLOR_BG[o.color] ?? 'bg-slate-600',
              onPick && !disabled && 'hover:brightness-110 active:scale-[0.98] cursor-pointer',
              dimmed && 'opacity-40',
              isCorrect && 'ring-4 ring-white',
              isPicked && 'ring-4 ring-black/60',
            )}
            aria-label={o.text ?? o.color}
          >
            <span aria-hidden className="text-2xl">
              {SHAPE_GLYPH[o.shape] ?? '●'}
            </span>
            {o.text ? <span>{o.text}</span> : null}
            {isCorrect ? <span className="ml-auto">✓</span> : null}
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
    <ul className="flex w-full flex-col gap-2">
      {options.map((o) => {
        const n = reveal.distribution[o.id] ?? 0;
        const pct = Math.round((n / total) * 100);
        const isCorrect = reveal.correctOptionIds?.includes(o.id);
        return (
          <li key={o.id} className="flex items-center gap-2">
            <span aria-hidden className="w-6 text-center">
              {SHAPE_GLYPH[o.shape] ?? '●'}
            </span>
            <div className="bg-muted relative h-7 flex-1 overflow-hidden rounded">
              <div
                className={cn('h-full', COLOR_BG[o.color] ?? 'bg-slate-600')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-16 text-right text-sm tabular-nums">
              {n} {isCorrect ? '✓' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Classement (lignes nickname/score) — surligne le joueur courant si fourni. */
export function LeaderboardList({
  rows,
  highlightRank,
  max = 10,
}: {
  rows: LeaderboardRow[];
  highlightRank?: number;
  max?: number;
}) {
  return (
    <ol className="flex w-full flex-col gap-1">
      {rows.slice(0, max).map((r) => (
        <li
          key={`${r.rank}-${r.nickname}`}
          className={cn(
            'flex items-center justify-between rounded px-3 py-1.5',
            r.rank === highlightRank ? 'bg-primary/15 font-semibold' : 'bg-muted/50',
          )}
        >
          <span>
            <span className="text-muted-foreground mr-2 tabular-nums">{r.rank}.</span>
            {r.nickname}
          </span>
          <span className="tabular-nums">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}

/** Podium top 3 (apprenant + projeté, §5.5). */
export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const order = [rows[1], rows[0], rows[2]]; // 2 · 1 · 3
  const heights = ['h-24', 'h-32', 'h-20'];
  return (
    <div className="flex items-end justify-center gap-3">
      {order.map((r, i) =>
        r ? (
          <div key={r.rank} className="flex w-24 flex-col items-center gap-1">
            <span className="font-semibold">{r.nickname}</span>
            <span className="text-muted-foreground text-sm tabular-nums">{r.score}</span>
            <div
              className={cn(
                'flex w-full items-start justify-center rounded-t-lg pt-2 text-2xl font-bold text-white',
                heights[i],
                r.rank === 1 ? 'bg-amber-500' : r.rank === 2 ? 'bg-slate-400' : 'bg-amber-800',
              )}
            >
              {r.rank}
            </div>
          </div>
        ) : (
          <div key={`empty-${i}`} className="w-24" />
        ),
      )}
    </div>
  );
}
