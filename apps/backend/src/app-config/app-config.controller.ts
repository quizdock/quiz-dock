import { access, readFile } from 'node:fs/promises';
import { liveMotionDefault } from '../game/live-motion';
import { join } from 'node:path';
import { Controller, Get, Header, NotFoundException, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { instanceLanguage } from '../common/instance-language';
import { SETTINGS, answerTheme } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

/** The icon (tab, home screen), which an operator may give in `branding/`. */
export const ICONS = ['favicon.png'];

/**
 * Sert `/config.js` (white-label runtime) quand le backend héberge aussi le SPA
 * (image unique). Généré à la volée depuis l'env → compatible `read_only` (aucune
 * écriture disque) et reflète `APP_NAME`/`APP_LANG` du conteneur sans rebuild.
 *
 * Exclu du préfixe global (`config.js`) ET du `ServeStaticModule` (sinon le
 * `dist/config.js` bundlé masquerait cette route et figerait les valeurs). Même
 * traitement pour `branding/override.css`, servie ici pour rendre le fichier
 * facultatif (cf. `overrideCss`).
 */
@Controller()
export class AppConfigController {
  @Public() // chargé avant toute authentification (branding du SPA)
  @Get('config.js')
  @ApiExcludeEndpoint() // asset JS (chargé via <script>), pas un endpoint d'API → hors OpenAPI
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  configJs(): string {
    const appName = settings.get(SETTINGS.APP_NAME);
    const lang = instanceLanguage();

    // Vide (le défaut) = le SPA cherche le logo dans `branding/`, tous formats web.
    const logoUrl = settings.get(SETTINGS.APP_LOGO_URL);
    // The home page's feedback links: empty = the QuizDock repository, `none` = hidden.
    const feedbackUrl = settings.get(SETTINGS.APP_FEEDBACK_URL);
    // JSON is valid JavaScript, whatever the values hold (quotes, backslashes, line breaks).
    // A new room's screens move between steps unless the instance says `off` (UI system §1.8).
    const liveMotion = liveMotionDefault();
    // How the answers are drawn: the author's shape, or a letter or number by position (lot 6).
    const answerGlyph = answerTheme(settings.get(SETTINGS.ANSWER_THEME)).glyph;
    const config = JSON.stringify({ appName, lang, logoUrl, feedbackUrl, liveMotion, answerGlyph });
    return `window.__APP_CONFIG__ = ${config};\n`;
  }

  /**
   * Feuille d'override white-label, **facultative** : un dossier `branding/` monté
   * sans `override.css` répond 204 (rien à surcharger) au lieu de l'`index.html` du
   * fallback SPA, que le navigateur refuserait comme feuille de style. Sert donc
   * elle-même le fichier, puisque la route est exclue du `ServeStaticModule`.
   */
  @Public()
  @Get('branding/override.css')
  @ApiExcludeEndpoint() // asset CSS (chargé via <link>), pas un endpoint d'API
  @Header('Content-Type', 'text/css; charset=utf-8')
  async overrideCss(@Res({ passthrough: true }) res: Response): Promise<string> {
    const dir = settings.get(SETTINGS.CLIENT_DIR);
    try {
      if (dir) return await readFile(join(dir, 'branding', 'override.css'), 'utf8');
    } catch {
      /* absente : on tombe sur le 204 ci-dessous */
    }
    res.status(204);
    return '';
  }

  /**
   * The installed app's manifest (PWA), in the instance's name and language: the
   * built one, renamed — as the nginx image's entrypoint does at start.
   */
  @Public()
  @Get('manifest.webmanifest')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async manifest(): Promise<string> {
    const dir = settings.get(SETTINGS.CLIENT_DIR);
    if (!dir) throw new NotFoundException();
    const built = JSON.parse(await readFile(join(dir, 'manifest.webmanifest'), 'utf8')) as Record<
      string,
      unknown
    >;
    const name = settings.get(SETTINGS.APP_NAME);
    return JSON.stringify({ ...built, name, short_name: name, lang: instanceLanguage() });
  }

  /**
   * The icon, for the tab and the home screen: the operator's
   * `branding/favicon.png` when given, QuizDock's otherwise — as nginx's
   * `try_files` does.
   */
  @Public()
  @Get(ICONS)
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'no-cache')
  async icon(@Req() req: Request, @Res() res: Response): Promise<void> {
    const dir = settings.get(SETTINGS.CLIENT_DIR);
    const name = ICONS.find((icon) => req.path === `/${icon}`);
    if (!dir || !name) throw new NotFoundException();
    const own = join(dir, 'branding', name);
    const path = await access(own).then(
      () => own,
      () => join(dir, 'icons', 'quizdock.png'),
    );
    res.sendFile(path);
  }
}
