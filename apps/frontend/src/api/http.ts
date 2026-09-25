/**
 * Mutator fetch pour le client Orval. Injecte les en-têtes d'authentification
 * (mode local : `X-Local-User` ; en OIDC, rien : la session est un cookie
 * `httpOnly` que le navigateur joint lui-même) et reproduit le format de réponse
 * attendu par le code généré (`{ data, status, headers }`).
 */

import { errorText, validationFieldErrors } from './error-text';

let authHeaders: Record<string, string> = {};
let onUnauthorized: (() => void) | null = null;
/** OIDC: signed in through the session cookie (nothing in the headers to tell). */
let sessionAuthed = false;

/** Mis à jour par le contexte d'auth (login/logout). */
export function setAuthHeaders(headers: Record<string, string>): void {
  authHeaders = headers;
}

/** Pour les requêtes hors client généré (téléchargement binaire). */
export function getAuthHeaders(): Record<string, string> {
  return authHeaders;
}

/** OIDC: whether a session cookie authenticates the requests (a 401 then means it ended). */
export function setSessionAuthed(authed: boolean): void {
  sessionAuthed = authed;
}

/**
 * Réaction à un 401 sur une requête **authentifiée** (session expirée / jeton
 * rejeté) : posé par le contexte d'auth (mode OIDC → retour à la connexion).
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Erreur HTTP (statut ≥ 400) portant le corps parsé (messages de validation). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * Texte lisible d'une ApiError : le backend ne renvoie qu'un **code** tokenisé
 * (`{ code, params? }`, ADR 0001), résolu ici via le dictionnaire i18n `errors`.
 * `fallback` est utilisé si le corps ne porte aucun code (ex. erreur réseau).
 */
export function apiErrorText(err: unknown, fallback?: string): string {
  if (err instanceof ApiError && err.data && typeof err.data === 'object') {
    const d = err.data as {
      code?: unknown;
      params?: Record<string, unknown>;
      errors?: { field: string; code: string }[];
    };
    // Validation : on traduit chaque code de champ (ADR 0001), agrégés en une ligne.
    if (d.code === 'validation' && Array.isArray(d.errors) && d.errors.length > 0) {
      return [...new Set(validationFieldErrors(d.errors).map((e) => e.message))].join(' ');
    }
    if (typeof d.code === 'string') return errorText(d.code, d.params);
  }
  return fallback ?? errorText('error');
}

export const customFetch = async <T>(url: string, options: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
      ...authHeaders,
    },
  });

  const body = [204, 205, 304].includes(res.status) ? null : await res.text();
  const data = body ? JSON.parse(body) : {};
  // Non-2xx → on lève, pour que react-query expose l'erreur (et son corps).
  if (!res.ok) {
    if (res.status === 401 && (sessionAuthed || Object.keys(authHeaders).length > 0)) {
      onUnauthorized?.();
    }
    throw new ApiError(res.status, data);
  }
  return { data, status: res.status, headers: res.headers } as T;
};
