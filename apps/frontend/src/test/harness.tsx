import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/auth-context';
import { routeTree } from '../router';

export interface ApiHandler {
  method?: string;
  /** Sous-chaîne ou regex testée contre l'URL. */
  path: string | RegExp;
  status?: number;
  body?: unknown;
}

/**
 * Mocke `fetch` (utilisé par le mutator Orval) à partir d'une table de handlers.
 * Renvoie le premier handler dont méthode + chemin correspondent.
 */
export function mockApi(handlers: ApiHandler[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, opts?: RequestInit) => {
    const method = (opts?.method ?? 'GET').toUpperCase();
    const handler = handlers.find(
      (h) =>
        (h.method ?? 'GET').toUpperCase() === method &&
        (typeof h.path === 'string' ? url.includes(h.path) : h.path.test(url)),
    );
    const status = handler?.status ?? (handler ? 200 : 404);
    const body = handler?.body === undefined ? '' : JSON.stringify(handler.body);
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Rend l'application complète sur une route donnée (router en mémoire). */
export function renderApp(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router as never} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient, ...utils };
}
