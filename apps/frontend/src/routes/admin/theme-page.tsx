import {
  ANSWER_SLOTS,
  ANSWER_THEMES,
  CONTRAST_RULES,
  DEFAULT_THEME,
  THEME_TOKENS,
  type Theme,
  type ThemeMode,
  type ThemeToken,
  checkTheme,
  contrast,
  answerColors,
  closestPairs,
  glyphOf,
  parseColor,
  resolvedPalette,
  simulate,
} from '@quiz-dock/contracts';
import { ShapeIcon } from '@/components/shape-icon';
import { Check, RotateCcw, Save, X } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { Notice } from '@/components/ui/notice';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { apiErrorText } from '../../api/http';
import { useReadOperation, useRefreshAdmin, useRunOperation } from './admin-api';
import type { SettingsList } from './settings-model';

/** An sRGB colour as `#rrggbb`, for the colour picker. */
function hexOf(value: string): string {
  const rgb = parseColor(value);
  if (!rgb) return '#000000';
  const h = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

/** The page's palette stylesheet, read again after a change. */
function reloadThemeSheet() {
  const link = document.querySelector<HTMLLinkElement>('link[href^="/branding/theme.css"]');
  if (link) link.href = `/branding/theme.css?v=${Date.now()}`;
}

/**
 * The instance's palette (lot 5): the brand's colours, light and dark, shown
 * on the application's own components before they are saved; every pair a
 * change touches checked for contrast as it is typed.
 */
export function ThemePage() {
  const { t } = useTranslation('admin');
  const current = useReadOperation<{ theme: Theme }>('theme.get');
  const list = useReadOperation<SettingsList>('settings.list');
  const run = useRunOperation();
  const refresh = useRefreshAdmin();
  const [mode, setMode] = useState<ThemeMode>('light');
  const [draft, setDraft] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const saved_ = current.data?.data?.theme;
  useEffect(() => {
    if (saved_ && draft === null) setDraft(saved_);
  }, [saved_, draft]);

  if (current.isError) return <LoadFailed error={current.error} />;
  if (!draft || !list.data?.data)
    return <Spinner label={t('loading')} showLabel className="text-sm" />;
  const access = list.data.data.access;
  const readOnly = access.scope !== 'write' || access.safeMode;
  const problems = checkTheme(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved_ ?? {});
  const palette = resolvedPalette(draft, mode);

  const setToken = (token: ThemeToken, value: string | null) =>
    setDraft((prev) => {
      const next: Theme = { ...prev, [mode]: { ...(prev?.[mode] ?? {}) } };
      if (value === null || value === '') delete next[mode]![token];
      else next[mode]![token] = value;
      return next;
    });

  const save = async (id: 'theme.set' | 'theme.reset') => {
    setError(null);
    setSaved(false);
    try {
      await run(id, id === 'theme.set' ? (draft as Record<string, unknown>) : {});
      if (id === 'theme.reset') setDraft({});
      setSaved(true);
      reloadThemeSheet();
      await refresh();
    } catch (err) {
      setError(apiErrorText(err));
    }
  };

  const vars = Object.fromEntries(
    THEME_TOKENS.map((token) => [`--${token}`, palette[token]]),
  ) as CSSProperties;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {readOnly ? t('look.readOnly') : t('look.intro')}
      </p>
      <Segmented
        label={t('look.mode')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'light', label: t('look.light') },
          { value: 'dark', label: t('look.dark') },
        ]}
        className="w-fit"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          {THEME_TOKENS.map((token) => {
            const value = draft[mode]?.[token] ?? '';
            const unreadable = problems.some(
              (p) => p.kind === 'unreadable' && p.mode === mode && p.token === token,
            );
            return (
              <div key={token} className="flex flex-wrap items-center gap-2">
                <label htmlFor={`theme-${token}`} className="w-48 text-sm">
                  {t(`look.tokens.${token}`)}
                  <code className="text-muted-foreground block text-xs">--{token}</code>
                </label>
                <input
                  type="color"
                  aria-label={t('look.pick', { token: t(`look.tokens.${token}`) })}
                  disabled={readOnly}
                  value={hexOf(palette[token])}
                  onChange={(e) => setToken(token, e.target.value)}
                  className="h-9 w-10 cursor-pointer rounded border"
                />
                <Input
                  id={`theme-${token}`}
                  disabled={readOnly}
                  value={value}
                  placeholder={DEFAULT_THEME[mode][token]}
                  onChange={(e) => setToken(token, e.target.value)}
                  aria-invalid={unreadable}
                  className="min-w-40 flex-1 font-mono text-xs"
                />
                {value ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={readOnly}
                    aria-label={t('look.default')}
                    title={t('look.default')}
                    onClick={() => setToken(token, null)}
                  >
                    <RotateCcw aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </Card>
        <div className="flex flex-col gap-4">
          <Preview vars={vars} dark={mode === 'dark'} />
          <Contrasts theme={draft} mode={mode} />
        </div>
      </div>
      {problems.some((p) => p.kind === 'unreadable') ? (
        <Notice>{t('look.unreadable')}</Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={readOnly || !changed || problems.length > 0}
          onClick={() => void save('theme.set')}
        >
          <Save aria-hidden className="size-4" />
          {t('edit.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={readOnly || Object.keys(saved_ ?? {}).length === 0}
          onClick={() => void save('theme.reset')}
        >
          <RotateCcw aria-hidden className="size-4" />
          {t('look.reset')}
        </Button>
        {saved ? (
          <p role="status" className="text-success text-sm">
            {t('look.saved')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The application's components, in the palette being edited. */
function Preview({ vars, dark }: { vars: CSSProperties; dark: boolean }) {
  const { t } = useTranslation('admin');
  return (
    <div className={cn(dark && 'dark')}>
      <div
        style={vars}
        className="bg-background text-foreground flex flex-col gap-3 rounded-lg border p-4"
      >
        <p className="text-sm font-medium">{t('look.preview')}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button">{t('look.sample.primary')}</Button>
          <Button type="button" variant="main-action">
            {t('look.sample.success')}
          </Button>
          <Button type="button" variant="destructive">
            {t('look.sample.destructive')}
          </Button>
          <Button type="button" variant="outline" className="ring-ring ring-2 ring-offset-2">
            {t('look.sample.focus')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{t('look.sample.badge')}</Badge>
          <Badge variant="warning">{t('look.sample.badge')}</Badge>
          <Badge variant="destructive">{t('look.sample.badge')}</Badge>
          <span className="text-warning-text text-sm">{t('look.sample.warningText')}</span>
          <span className="text-primary text-sm underline">{t('look.sample.link')}</span>
        </div>
      </div>
    </div>
  );
}

/** Each pair that must stay readable, in the mode shown: its ratio against its minimum. */
function Contrasts({ theme, mode }: { theme: Theme; mode: ThemeMode }) {
  const { t, i18n } = useTranslation('admin');
  const palette = resolvedPalette(theme, mode);
  const changed = theme[mode] ?? {};
  return (
    <Card className="flex flex-col gap-1 p-4 text-sm">
      <p className="font-medium">{t('look.contrasts')}</p>
      <ul className="flex flex-col gap-1">
        {CONTRAST_RULES.map((rule) => {
          const fg = parseColor(palette[rule.fg]);
          const bg = parseColor(palette[rule.bg]);
          const ratio = fg && bg ? contrast(fg, bg) : null;
          const touched = rule.fg in changed || rule.bg in changed;
          const ok = ratio !== null && ratio >= rule.min;
          return (
            <li
              key={`${rule.fg}-${rule.bg}`}
              className={cn('flex items-center gap-2', !touched && 'text-muted-foreground')}
            >
              {ok ? (
                <Check aria-hidden className="text-success size-4" />
              ) : (
                <X
                  aria-hidden
                  className={cn('size-4', touched ? 'text-destructive' : 'text-muted-foreground')}
                />
              )}
              <span className="flex-1">
                {t(`look.tokens.${rule.fg}`)} /{' '}
                {rule.bg === 'background' ? t('look.background') : t(`look.tokens.${rule.bg}`)}
              </span>
              <span className="tabular-nums">
                {ratio === null
                  ? '—'
                  : ratio.toLocaleString(i18n.language, { maximumFractionDigits: 2 })}
                :1 ≥ {rule.min}:1
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">{t('look.contrastsHelp')}</p>
    </Card>
  );
}

const VISIONS = ['typical', 'protanopia', 'deuteranopia', 'tritanopia'] as const;

/**
 * The answer themes (lot 6): how the answers' slots are drawn — colour and
 * glyph —, each shown as people with each common colour vision deficiency
 * see it. Chosen for the instance (`ANSWER_THEME`); the quizzes keep their slots.
 */
export function AnswerThemes() {
  const { t } = useTranslation('admin');
  const list = useReadOperation<SettingsList>('settings.list');
  const run = useRunOperation();
  const refresh = useRefreshAdmin();
  const [error, setError] = useState<string | null>(null);
  const data = list.data?.data;
  if (!data) return null;
  const row = data.rows.find((r) => r.key === 'ANSWER_THEME');
  const current = String(row?.value ?? 'classic');
  const readOnly = data.access.scope !== 'write' || data.access.safeMode || !!row?.locked;

  const choose = async (id: string) => {
    setError(null);
    try {
      await run('settings.set', { key: 'ANSWER_THEME', value: id });
      reloadThemeSheet();
      await refresh();
    } catch (err) {
      setError(apiErrorText(err));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{t('answers.title')}</h2>
      <p className="text-muted-foreground text-sm">{t('answers.intro')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {ANSWER_THEMES.map((theme) => {
          const colors = answerColors(theme);
          const pairs = closestPairs(theme, 4);
          const chosen = theme.id === current;
          return (
            <button
              key={theme.id}
              type="button"
              disabled={readOnly || chosen}
              aria-pressed={chosen}
              onClick={() => void choose(theme.id)}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 text-left disabled:cursor-default',
                chosen ? 'border-primary bg-accent' : !readOnly && 'hover:bg-accent/60',
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {chosen ? <Check aria-hidden className="text-success size-4" /> : null}
                {t(`answers.themes.${theme.id}.title`)}
              </span>
              <span className="text-muted-foreground text-xs">
                {t(`answers.themes.${theme.id}.help`)}
              </span>
              <table className="text-xs">
                <tbody>
                  {VISIONS.map((vision) => (
                    <tr key={vision}>
                      <th scope="row" className="text-muted-foreground pr-2 text-left font-normal">
                        {t(`answers.vision.${vision}`)}
                      </th>
                      {ANSWER_SLOTS.slice(0, 4).map((slot, i) => {
                        const rgb = parseColor(colors[slot])!;
                        const shown = vision === 'typical' ? rgb : simulate(rgb, vision);
                        const background = `rgb(${[shown.r, shown.g, shown.b].map((x) => Math.round(x * 255)).join(' ')})`;
                        return (
                          <td key={slot} className="p-0.5">
                            <span
                              className="flex h-7 w-10 items-center justify-center rounded text-white"
                              style={{ background }}
                            >
                              {glyphOf(theme.glyph, i) ?? <ShapeIcon shape={SAMPLE_SHAPES[i]} />}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-muted-foreground pl-2 tabular-nums">
                        {pairs.find((p) => p.vision === vision)!.distance.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{t('answers.distanceHelp')}</p>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The shapes of a new question's first answers, for the samples. */
const SAMPLE_SHAPES = ['triangle', 'diamond', 'circle', 'square'];

/** The look of the instance: its palette, then how its answers are drawn. */
export function LookPage() {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t('look.title')}</h2>
        <ThemePage />
      </section>
      <AnswerThemes />
    </div>
  );
}
