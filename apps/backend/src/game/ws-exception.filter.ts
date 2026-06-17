import { type ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import type { ServerToClientEvents } from '@roux-quizz/contracts';
import type { Socket } from 'socket.io';

/** Codes d'erreur HTTP → codes « fil » stables consommés par le client (contrat §9). */
const STATUS_CODE: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  503: 'unavailable',
};

/**
 * Convertit toute exception levée dans un handler WS en event **`error` typé**
 * (`{ code, message }`, conforme à `@roux-quizz/contracts`) plutôt que l'event
 * générique `exception` de Nest — ainsi les clients catchent les erreurs contre
 * le contrat partagé.
 */
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  private readonly log = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const socket = host.switchToWs().getClient<Socket<never, ServerToClientEvents>>();
    const { code, message } = this.normalize(exception);
    socket.emit('error', { code, message });
  }

  private normalize(exception: unknown): { code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { code: STATUS_CODE[status] ?? 'error', message: exception.message };
    }
    if (exception instanceof WsException) {
      return { code: 'error', message: exception.message };
    }
    this.log.error(`Exception WS non gérée: ${String(exception)}`);
    return { code: 'internal', message: 'Erreur interne.' };
  }
}
