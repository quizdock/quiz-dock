import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { instanceLanguage } from '../common/instance-language';

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
    const appName = process.env.APP_NAME ?? 'QuizDock';
    const lang = instanceLanguage();
    const esc = (s: string): string => s.replace(/[\\"]/g, '\\$&');
    // Vide (le défaut) = le SPA cherche le logo dans `branding/`, tous formats web.
    const logoUrl = process.env.APP_LOGO_URL ?? '';
    // The home page's feedback links: empty = the QuizDock repository, `none` = hidden.
    const feedbackUrl = process.env.APP_FEEDBACK_URL ?? '';
    return `window.__APP_CONFIG__ = { appName: "${esc(appName)}", lang: "${esc(lang)}", logoUrl: "${esc(logoUrl)}", feedbackUrl: "${esc(feedbackUrl)}" };\n`;
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
    const dir = process.env.CLIENT_DIR;
    try {
      if (dir) return await readFile(join(dir, 'branding', 'override.css'), 'utf8');
    } catch {
      /* absente : on tombe sur le 204 ci-dessous */
    }
    res.status(204);
    return '';
  }
}
