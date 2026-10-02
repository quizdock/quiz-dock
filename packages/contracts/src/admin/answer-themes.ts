import { type Rgb, parseColor } from './theme';

/**
 * Answer themes (administration spec, lot 6): how an answer's slot is shown —
 * its colour, and its glyph beside it (the author's shape, or a letter, or a
 * number by position). A quiz keeps its slots (`red`, `blue`…): a theme only
 * changes how the instance draws them, on the projection, the phones and the
 * console.
 */

/** The answers' slots, in the order a question gives them (OptionColor). */
export const ANSWER_SLOTS = [
  'red',
  'blue',
  'yellow',
  'green',
  'purple',
  'orange',
  'pink',
  'teal',
] as const;
export type AnswerSlot = (typeof ANSWER_SLOTS)[number];

export type AnswerGlyph = 'shape' | 'letter' | 'number';

export interface AnswerTheme {
  id: 'classic' | 'letters' | 'numbers' | 'colorblind';
  glyph: AnswerGlyph;
  /** Colours replacing the application's, slot by slot; absent: the application's. */
  colors?: Partial<Record<AnswerSlot, string>>;
}

/** The application's answer colours (apps/frontend/src/index.css). */
export const DEFAULT_ANSWER_COLORS: Record<AnswerSlot, string> = {
  red: 'oklch(57.7% 0.245 27.325)',
  blue: 'oklch(54.6% 0.245 262.881)',
  yellow: 'oklch(76.9% 0.188 70.08)',
  green: 'oklch(62.7% 0.194 149.214)',
  purple: 'oklch(55.8% 0.288 302.321)',
  orange: 'oklch(70.5% 0.213 47.604)',
  pink: 'oklch(59.2% 0.249 0.584)',
  teal: 'oklch(60% 0.118 184.704)',
};

export const ANSWER_THEMES: AnswerTheme[] = [
  { id: 'classic', glyph: 'shape' },
  { id: 'letters', glyph: 'letter' },
  { id: 'numbers', glyph: 'number' },
  {
    // Paul Tol's and Okabe & Ito's colours, chosen so that every slot stays told
    // apart under each common colour vision deficiency — hues kept close to
    // the slots' names.
    id: 'colorblind',
    glyph: 'shape',
    colors: {
      red: '#cc3311',
      blue: '#332288',
      yellow: '#ccbb44',
      green: '#44aa99',
      purple: '#882255',
      orange: '#ee7733',
      pink: '#aa3377',
      teal: '#33bbee',
    },
  },
];

export const answerTheme = (id: string): AnswerTheme =>
  ANSWER_THEMES.find((t) => t.id === id) ?? ANSWER_THEMES[0];

export const answerColors = (theme: AnswerTheme): Record<AnswerSlot, string> => ({
  ...DEFAULT_ANSWER_COLORS,
  ...(theme.colors ?? {}),
});

/** What an answer shows beside its text: its shape, or its letter or number by position. */
export function glyphOf(glyph: AnswerGlyph, index: number): string | null {
  if (glyph === 'letter') return String.fromCharCode(65 + (index % 26));
  if (glyph === 'number') return String(index + 1);
  return null;
}

// ── Colour vision deficiencies (Machado, Oliveira & Fernandes 2009, severity 1) ──

export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';

const MACHADO: Record<Deficiency, number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
  ],
};

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toSrgb = (x: number) => {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};

/** A colour as a person with this deficiency sees it. */
export function simulate(rgb: Rgb, deficiency: Deficiency): Rgb {
  const m = MACHADO[deficiency];
  const [r, g, b] = [toLinear(rgb.r), toLinear(rgb.g), toLinear(rgb.b)];
  return {
    r: toSrgb(m[0] * r + m[1] * g + m[2] * b),
    g: toSrgb(m[3] * r + m[4] * g + m[5] * b),
    b: toSrgb(m[6] * r + m[7] * g + m[8] * b),
  };
}

/** Perceptual distance (OKLab, 0–~1.4): below ~0.1 two tiles read as alike at a glance. */
export function distance(a: Rgb, b: Rgb): number {
  const lab = ({ r, g, b: bl }: Rgb) => {
    const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(bl)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The closest two of the first `count` slots, as seen with each deficiency (and without). */
export function closestPairs(
  theme: AnswerTheme,
  count = 4,
): { vision: 'typical' | Deficiency; distance: number; slots: [AnswerSlot, AnswerSlot] }[] {
  const colors = answerColors(theme);
  const slots = ANSWER_SLOTS.slice(0, count);
  return (['typical', 'protanopia', 'deuteranopia', 'tritanopia'] as const).map((vision) => {
    const seen = slots.map((s) => {
      const rgb = parseColor(colors[s])!;
      return vision === 'typical' ? rgb : simulate(rgb, vision);
    });
    let best = { distance: Infinity, slots: [slots[0], slots[1]] as [AnswerSlot, AnswerSlot] };
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const d = distance(seen[i], seen[j]);
        if (d < best.distance) best = { distance: d, slots: [slots[i], slots[j]] };
      }
    }
    return { vision, distance: Math.round(best.distance * 1000) / 1000, ...{ slots: best.slots } };
  });
}

/** The answer colours of a theme, as stylesheet lines (only what it changes). */
export function answerThemeCss(theme: AnswerTheme): string {
  const lines = Object.entries(theme.colors ?? {}).map(
    ([slot, color]) => `  --answer-${slot}: ${color};`,
  );
  return lines.length ? `:root,\n.dark {\n${lines.join('\n')}\n}\n` : '';
}
