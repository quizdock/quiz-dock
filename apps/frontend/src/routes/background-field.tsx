import type { SlideGradient, SlideTextTone } from '@quiz-dock/contracts';
import { ChevronRight, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { gradientCss } from '../game/surface';
import { MediaUpload } from './media-upload';

/** What a slide or a question stores about its background. */
export interface BackgroundValue {
  mediaId: string | null;
  gradient: SlideGradient | null;
  textTone: SlideTextTone;
  textOutline: boolean;
}

export const NO_BACKGROUND: BackgroundValue = {
  mediaId: null,
  gradient: null,
  textTone: 'light',
  textOutline: true,
};

const DEFAULT_GRADIENT: SlideGradient = { angle: 135, colors: ['#1e3a8a', '#7c3aed'] };

/**
 * Background settings, folded by default (white is the norm): none, an uploaded
 * image, or a gradient built from 2–4 colours and an angle; then the text
 * contrast (tone + outline) once a background exists.
 */
export function BackgroundField({
  value,
  onChange,
}: {
  value: BackgroundValue;
  onChange: (next: BackgroundValue) => void;
}) {
  const { t } = useTranslation('editor');
  // The chosen kind is local UI state: "image" stays selected while the upload is pending.
  type Kind = 'none' | 'image' | 'gradient';
  const [kind, setKindState] = useState<Kind>(
    value.mediaId ? 'image' : value.gradient ? 'gradient' : 'none',
  );
  const setKind = (k: Kind) => {
    setKindState(k);
    onChange({
      ...value,
      mediaId: k === 'image' ? value.mediaId : null,
      gradient: k === 'gradient' ? (value.gradient ?? DEFAULT_GRADIENT) : null,
    });
  };
  const g = value.gradient;
  const setGradient = (next: SlideGradient) => onChange({ ...value, gradient: next });

  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium select-none">
        <ChevronRight className="text-muted-foreground size-4 transition-transform group-open:rotate-90" />
        {t('background.legend')}
        <span className="text-muted-foreground ml-auto text-xs">
          {t(`background.kind.${kind}`)}
        </span>
        {kind === 'gradient' && g ? (
          <span
            aria-hidden
            className="size-4 rounded-full border"
            style={{ backgroundImage: gradientCss(g) }}
          />
        ) : null}
      </summary>
      <div className="flex flex-col gap-3 border-t px-3 py-3">
        <div className="flex flex-wrap gap-2">
          {(['none', 'image', 'gradient'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={kind === k ? 'default' : 'outline'}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {t(`background.kind.${k}`)}
            </Button>
          ))}
        </div>

        {kind === 'image' ? (
          <MediaUpload
            value={value.mediaId}
            onChange={(id) => onChange({ ...value, mediaId: id, gradient: null })}
          />
        ) : null}

        {kind === 'gradient' && g ? (
          <div className="flex flex-col gap-3">
            <div
              className="h-12 w-full rounded-md border"
              style={{ backgroundImage: gradientCss(g) }}
            />
            <div className="flex flex-wrap items-center gap-2">
              {g.colors.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label={t('background.color', { index: i + 1 })}
                    className="size-9 cursor-pointer rounded-md border p-0.5"
                    value={c}
                    onChange={(e) =>
                      setGradient({
                        ...g,
                        colors: g.colors.map((x, idx) => (idx === i ? e.target.value : x)),
                      })
                    }
                  />
                  {g.colors.length > 2 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('background.removeColor', { index: i + 1 })}
                      onClick={() =>
                        setGradient({ ...g, colors: g.colors.filter((_, idx) => idx !== i) })
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  ) : null}
                </span>
              ))}
              {g.colors.length < 4 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setGradient({ ...g, colors: [...g.colors, g.colors[g.colors.length - 1]] })
                  }
                >
                  <Plus className="size-4" />
                  {t('background.addColor')}
                </Button>
              ) : null}
            </div>
            <label className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0">{t('background.angle')}</span>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                className="flex-1"
                value={g.angle}
                onChange={(e) => setGradient({ ...g, angle: Number(e.target.value) })}
              />
              <span className="w-12 text-right tabular-nums">{g.angle}°</span>
            </label>
          </div>
        ) : null}

        {kind !== 'none' ? (
          <div className="flex flex-wrap items-center gap-4 border-t pt-3">
            <Select
              aria-label={t('slideForm.contrastLegend')}
              className="w-64"
              value={value.textTone}
              onChange={(e) => onChange({ ...value, textTone: e.target.value as SlideTextTone })}
            >
              <option value="light">{t('slideForm.tone.light')}</option>
              <option value="dark">{t('slideForm.tone.dark')}</option>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.textOutline}
                onChange={(e) => onChange({ ...value, textOutline: e.target.checked })}
              />
              {t('slideForm.outline')}
            </label>
          </div>
        ) : null}
      </div>
    </details>
  );
}
