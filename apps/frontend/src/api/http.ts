/**
 * Mutator fetch pour le client Orval. Injecte les en-têtes d'authentification
 * (mode local : `X-Local-User` ; mode OIDC : `Authorization: Bearer`) et reproduit
 * le format de réponse attendu par le code généré (`{ data, status, headers }`).
 */

let authHeaders: Record<string, string> = {};

/** Mis à jour par le contexte d'auth (login/logout). */
export function setAuthHeaders(headers: Record<string, string>): void {
  authHeaders = headers;
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

/** Message lisible extrait d'une ApiError (format ZodValidationPipe NestJS). */
export function apiErrorMessage(err: unknown, fallback = 'Erreur.'): string {
  if (err instanceof ApiError && err.data && typeof err.data === 'object') {
    const d = err.data as { message?: unknown };
    if (typeof d.message === 'string') return d.message;
    if (Array.isArray(d.message)) return d.message.join(', ');
  }
  return fallback;
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
    throw new ApiError(res.status, data);
  }
  return { data, status: res.status, headers: res.headers } as T;
};
