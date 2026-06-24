import { type ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import type { ServerToClientEvents } from '@roux-quizz/contracts';
import type { Socket } from 'socket.io';
import { toErrorResponse } from '../common/error-response';

/**
 * Convertit toute exception levée dans un handler WS en event **`error` typé**
 * (`{ code, params? }`, conforme à `@roux-quizz/contracts`) plutôt que l'event
 * générique `exception` de Nest. **Token uniquement** : on émet le code domaine
 * (ex. `session.not_found`), jamais de texte — le client résout via i18n (ADR 0001).
 */
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly log = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const socket = host.switchToWs().getClient<Socket<never, ServerToClientEvents>>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) this.log.error(`WS ${status} (${body.code})`, exception as Error);
    socket.emit('error', { code: body.code, params: body.params });
  }
}
