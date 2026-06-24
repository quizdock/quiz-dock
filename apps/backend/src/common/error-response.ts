import { HttpException, HttpStatus } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ZodValidationException } from 'nestjs-zod';

/**
 * Corps d'erreur **tokenisé** (ADR 0001) : le backend n'expose que des codes
 * domaine stables, jamais de texte destiné à l'utilisateur. Le client résout le
 * libellé via son dictionnaire i18n.
 *
 * - `code` : code domaine (`session.not_found`, `quiz.transition_forbidden`, `validation`…).
 * - `params` : valeurs d'interpolation pour les codes paramétrés.
 * - `errors` : détail par champ pour le code `validation` (codes Zod génériques).
 */
export interface ErrorBody {
  code: string;
  params?: Record<string, string | number>;
  errors?: { field: string; code: string }[];
}

/** Lit le code (+ params) porté par le payload d'une exception applicative. */
function fromPayload(payload: unknown): ErrorBody {
  if (typeof payload === 'string') return { code: payload };
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    // Forme paramétrée : throw new BadRequestException({ code, params })
    if (typeof o.code === 'string') {
      return { code: o.code, params: o.params as ErrorBody['params'] };
    }
    // Forme Nest par défaut { statusCode, message, error } : le code voyage dans `message`.
    if (typeof o.message === 'string') return { code: o.message };
  }
  return { code: 'error' };
}

/**
 * Normalise n'importe quelle exception (HTTP, WS, validation Zod) en
 * `{ status, body }` tokenisé, consommé par les filtres REST et WebSocket.
 */
export function toErrorResponse(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof ZodValidationException) {
    const issues =
      (exception.getResponse() as { errors?: { code: string; path: (string | number)[] }[] })
        .errors ?? [];
    return {
      status: exception.getStatus(),
      body: {
        code: 'validation',
        errors: issues.map((i) => ({ field: i.path.join('.') || '_', code: i.code })),
      },
    };
  }
  if (exception instanceof HttpException) {
    return { status: exception.getStatus(), body: fromPayload(exception.getResponse()) };
  }
  if (exception instanceof WsException) {
    return { status: HttpStatus.BAD_REQUEST, body: fromPayload(exception.getError()) };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: 'internal' } };
}
