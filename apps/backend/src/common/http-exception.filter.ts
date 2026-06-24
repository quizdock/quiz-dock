import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toErrorResponse } from './error-response';

/**
 * Filtre REST global : sérialise toute exception en corps **tokenisé**
 * `{ code, params? }` (ou `{ code: 'validation', errors }`) au lieu du
 * `{ statusCode, message, error }` par défaut de Nest — aucun texte FR ne fuit
 * (ADR 0001). Le statut HTTP d'origine est préservé.
 *
 * Le contexte WebSocket est couvert séparément par `WsExceptionFilter` (posé au
 * niveau de la gateway), donc ce filtre ne traite que le HTTP.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception; // laisse le filtre WS gérer
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) this.log.error(`HTTP ${status} (${body.code})`, exception as Error);
    res.status(status).json(body);
  }
}
