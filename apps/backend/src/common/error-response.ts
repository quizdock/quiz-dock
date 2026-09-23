import { HttpException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ZodValidationException } from 'nestjs-zod';
import { uploadCeiling } from '../media/media.config';

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

/** A domain error code: dotted lowercase words (`media.video_with_audio`). */
const DOMAIN_CODE = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

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
      (
        exception.getResponse() as {
          errors?: { code: string; message?: string; path: (string | number)[] }[];
        }
      ).errors ?? [];
    // A rule of the domain written as a refinement (`media.video_with_audio`)
    // carries its own code: it says more than a generic `custom` field error.
    const domain = issues.find((i) => i.code === 'custom' && DOMAIN_CODE.test(i.message ?? ''));
    if (domain) {
      return { status: exception.getStatus(), body: { code: domain.message as string } };
    }
    return {
      status: exception.getStatus(),
      body: {
        code: 'validation',
        errors: issues.map((i) => ({ field: i.path.join('.') || '_', code: i.code })),
      },
    };
  }
  if (exception instanceof HttpException) {
    const body = fromPayload(exception.getResponse());
    // Multer stops a stream past the largest limit with its own English message.
    if (exception instanceof PayloadTooLargeException && body.code === 'File too large') {
      const max = uploadCeiling();
      return {
        status: exception.getStatus(),
        body: { code: 'media.file_too_large', params: { max, maxMb: Math.floor(max / 1048576) } },
      };
    }
    return { status: exception.getStatus(), body };
  }
  if (exception instanceof WsException) {
    return { status: HttpStatus.BAD_REQUEST, body: fromPayload(exception.getError()) };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: 'internal' } };
}
