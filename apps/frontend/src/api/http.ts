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
  return { data, status: res.status, headers: res.headers } as T;
};
