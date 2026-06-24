import type {
  LeaderboardRow,
  PublicOption,
  QuestionRevealPayload,
  QuestionStartPayload,
} from '@quiz-dock/contracts';
import { useTranslation } from 'react-i18next';
import { COLOR_BG, OPTION_BG_FALLBACK, SHAPE_GLYPH } from '@/lib/option-style';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';

/**
 * Grille d'options colorées + formes. `onPick` la rend interactive (joueur) ;
 * `correctIds` met en évidence la bonne réponse au reveal ; jamais de flag correct
 * avant (anti-triche §7 — les options publiques n'en portent pas).
 */
export function OptionGrid({
  options,
  onPick,
  selectedIds,
  correctIds,
  highlightIds,
  disabled,
  size = 'md',
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
  size?: 'md' | 'lg';
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((o) => {
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
            className={cn(
              'flex items-center gap-3 rounded-xl px-4 font-semibold text-white shadow transition',
              size === 'lg' ? 'py-8 text-2xl' : 'py-5 text-lg',
              COLOR_BG[o.color] ?? OPTION_BG_FALLBACK,
              onPick && !disabled && 'hover:brightness-110 active:scale-[0.98] cursor-pointer',
              dimmed && 'opacity-40',
              isCorrect && 'ring-4 ring-white',
              isPicked && 'ring-4 ring-black/60',
              isHinted && 'outline-success outline outline-2 outline-offset-2',
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
                className={cn('h-full', COLOR_BG[o.color] ?? OPTION_BG_FALLBACK)}
                style={{ width: `${pct}%` }}
              />
              {/* Intitulé de la réponse en surimpression de la barre. */}
              <span
                className={cn(
                  'absolute inset-0 flex items-center px-3 text-sm font-medium',
                  isCorrect && 'font-semibold',
                )}
              >
                {o.text ?? o.color}
              </span>
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
      <p className="text-xl">
        {t('reveal.goodOrder')} <strong>{labels.join(' → ')}</strong>
      </p>
    );
  }

  // Numérique / saisie texte : valeur(s) acceptée(s).
  const val = reveal.correctValue;
  const text = Array.isArray(val) ? val.join(' ou ') : (val ?? '');
  return (
    <p className="text-xl">
      {t('reveal.goodAnswer')} <strong>{String(text)}</strong>
    </p>
  );
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
    <ol className="flex w-full flex-col gap-1.5">
      {shown.map((r) => {
        const pct = topScore > 0 ? Math.round((r.score / topScore) * 100) : 0;
        const me = r.rank === highlightRank;
        return (
          <li
            key={`${r.rank}-${r.nickname}`}
            className={cn(
              'relative flex items-center gap-2 overflow-hidden rounded px-3 py-1.5',
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
            <Avatar name={r.avatar || r.nickname} size={28} />
            <span className="relative min-w-0 flex-1 truncate text-left">{r.nickname}</span>
            <span className="relative tabular-nums">{r.score}</span>
          </li>
        );
      })}
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
            <Avatar name={r.avatar || r.nickname} size={48} />
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
