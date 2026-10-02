/**
 * The instance's palette (administration spec, lot 5): the brand's colour
 * tokens, light and dark, changed from the administration and served as a
 * stylesheet — the neutrals stay the application's. Shared by the backend
 * (validation, the stylesheet) and the web (the editor, its preview).
 */

/** The tokens the administration may change (`--primary`…). */
export const THEME_TOKENS = [
  'primary',
  'primary-foreground',
  'ring',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-text',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeMode = 'light' | 'dark';

/** What the administration changed, mode by mode; a token left out keeps the application's. */
export type Theme = Partial<Record<ThemeMode, Partial<Record<ThemeToken, string>>>>;

/** The application's own values (apps/frontend/src/index.css), and the grounds they sit on. */
export const DEFAULT_THEME: Record<ThemeMode, Record<ThemeToken | 'background', string>> = {
  light: {
    background: 'oklch(1 0 0)',
    primary: 'oklch(0.55 0.22 264)',
    'primary-foreground': 'oklch(0.985 0 0)',
    ring: 'oklch(0.55 0.22 264)',
    destructive: 'oklch(0.577 0.245 27.325)',
    'destructive-foreground': 'oklch(0.985 0 0)',
    success: 'oklch(0.6 0.17 150)',
    'success-foreground': 'oklch(0.985 0 0)',
    warning: 'oklch(76.9% 0.188 70.08)',
    'warning-text': 'oklch(55.5% 0.163 48.998)',
  },
  dark: {
    background: 'oklch(0.145 0 0)',
    primary: 'oklch(0.7 0.18 264)',
    'primary-foreground': 'oklch(0.145 0 0)',
    ring: 'oklch(0.7 0.18 264)',
    destructive: 'oklch(0.704 0.191 22.216)',
    'destructive-foreground': 'oklch(0.985 0 0)',
    success: 'oklch(0.7 0.17 150)',
    'success-foreground': 'oklch(0.145 0 0)',
    warning: 'oklch(76.9% 0.188 70.08)',
    'warning-text': 'oklch(0.82 0.15 75)',
  },
};

/** The pairs that must stay readable (WCAG 2: 4.5 for text, 3 for a component against the page). */
export const CONTRAST_RULES: { fg: ThemeToken; bg: ThemeToken | 'background'; min: number }[] = [
  { fg: 'primary-foreground', bg: 'primary', min: 4.5 },
  { fg: 'destructive-foreground', bg: 'destructive', min: 4.5 },
  { fg: 'success-foreground', bg: 'success', min: 4.5 },
  { fg: 'warning-text', bg: 'background', min: 4.5 },
  { fg: 'primary', bg: 'background', min: 3 },
  { fg: 'ring', bg: 'background', min: 3 },
  { fg: 'destructive', bg: 'background', min: 3 },
];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** sRGB in 0–1 from OKLCH (Björn Ottosson's OKLab), clamped into the gamut. */
function oklchToRgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = {
    r: 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    g: -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    b: -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  };
  const encode = (x: number) => {
    const v = clamp01(x);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return { r: encode(lin.r), g: encode(lin.g), b: encode(lin.b) };
}

/**
 * A colour as the palette accepts it: `#rgb`, `#rrggbb`, or `oklch(L C H)` —
 * `L` as 0–1 or a percentage, no alpha (a brand colour is opaque).
 */
export function parseColor(text: string): Rgb | null {
  const value = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (ok) {
    const l = Number(ok[1]) / (ok[2] ? 100 : 1);
    const c = Number(ok[3]);
    const h = Number(ok[4]);
    if (!(l >= 0 && l <= 1) || !(c >= 0 && c <= 0.5) || !(h >= 0 && h <= 360)) return null;
    return oklchToRgb(l, c, h);
  }
  return null;
}

/** Relative luminance (WCAG 2). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A mode's full set of values: the application's, then the administration's. */
export function resolvedPalette(
  theme: Theme,
  mode: ThemeMode,
): Record<ThemeToken | 'background', string> {
  return { ...DEFAULT_THEME[mode], ...(theme[mode] ?? {}) };
}

export interface ThemeProblem {
  mode: ThemeMode;
  token?: ThemeToken;
  /** `unreadable`: not a colour the palette takes; `contrast`: a pair below its minimum. */
  kind: 'unreadable' | 'contrast';
  fg?: ThemeToken;
  bg?: ThemeToken | 'background';
  ratio?: number;
  min?: number;
}

/** What is wrong with a palette: unreadable colours, pairs a change made unreadable. */
export function checkTheme(theme: Theme): ThemeProblem[] {
  const problems: ThemeProblem[] = [];
  for (const mode of ['light', 'dark'] as const) {
    for (const [token, value] of Object.entries(theme[mode] ?? {})) {
      if (!(THEME_TOKENS as readonly string[]).includes(token) || !parseColor(String(value))) {
        problems.push({ mode, token: token as ThemeToken, kind: 'unreadable' });
      }
    }
    if (problems.some((p) => p.mode === mode)) continue;
    const palette = resolvedPalette(theme, mode);
    const changed = theme[mode] ?? {};
    // Only the pairs a change touches: the application answers for its own values.
    for (const rule of CONTRAST_RULES.filter((r) => r.fg in changed || r.bg in changed)) {
      const ratio = contrast(parseColor(palette[rule.fg])!, parseColor(palette[rule.bg])!);
      if (ratio < rule.min) {
        problems.push({
          mode,
          kind: 'contrast',
          fg: rule.fg,
          bg: rule.bg,
          ratio: Math.round(ratio * 100) / 100,
          min: rule.min,
        });
      }
    }
  }
  return problems;
}

/** The stylesheet of a palette: only what the administration changed, after the application's. */
export function themeCss(theme: Theme): string {
  const block = (selector: string, values: Partial<Record<ThemeToken, string>> | undefined) => {
    const lines = Object.entries(values ?? {})
      .filter(
        ([token, value]) =>
          (THEME_TOKENS as readonly string[]).includes(token) && parseColor(String(value)),
      )
      .map(([token, value]) => `  --${token}: ${String(value).trim()};`);
    return lines.length ? `${selector} {\n${lines.join('\n')}\n}\n` : '';
  };
  return `/* The instance's palette, from its administration. */\n${block(':root', theme.light)}${block('.dark', theme.dark)}`;
}
