import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorText, customFetch, setAuthHeaders } from './http';

describe('customFetch', () => {
  afterEach(() => {
    setAuthHeaders({});
    vi.restoreAllMocks();
  });

  it('renvoie le format { data, status, headers } attendu par Orval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
    );
    const res = await customFetch<{ data: unknown; status: number }>('/x', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: 1 });
  });

  it('injecte les en-têtes d’auth configurés', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    setAuthHeaders({ 'X-Local-User': 'Marc' });
    await customFetch('/x', { method: 'GET' });
    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Local-User']).toBe('Marc');
  });

  it('lève ApiError et résout le code tokenisé en texte i18n (statut ≥ 400)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 'quiz.not_found' }), { status: 404 }),
        ),
    );
    const err = await customFetch('/x', { method: 'POST' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect(apiErrorText(err)).toBe('Quiz introuvable.');
  });
});
