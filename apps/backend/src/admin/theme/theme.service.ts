import { Injectable } from '@nestjs/common';
import { type Theme, themeCss } from '@quiz-dock/contracts';
import { OverridesService } from '../settings/overrides.service';

export const THEME_KEY = 'theme.palette';
/** How long the served stylesheet is kept before it is read again (a change shows within it). */
const CACHE_MS = 30_000;

/**
 * The instance's palette (lot 5): kept with the instance's values, served as a
 * stylesheet loaded after the application's and before `branding/override.css`
 * — what the operator writes there still has the last word.
 */
@Injectable()
export class ThemeService {
  private cached: { at: number; css: string } | null = null;

  constructor(private readonly values: OverridesService) {}

  async get(): Promise<Theme> {
    const raw = await this.values.value(THEME_KEY);
    try {
      return raw ? (JSON.parse(raw) as Theme) : {};
    } catch {
      return {};
    }
  }

  async set(theme: Theme | null, actor: { name: string; userId?: string }): Promise<void> {
    await this.values.setValue(THEME_KEY, theme ? JSON.stringify(theme) : null, actor);
    this.cached = null;
  }

  async css(): Promise<string> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.css;
    const css = themeCss(await this.get());
    this.cached = { at: Date.now(), css };
    return css;
  }
}
