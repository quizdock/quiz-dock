import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigControllerConfig } from './api/generated/auth/auth';
import { ApiError, setAuthHeaders } from './api/http';
import { type AuthMode, AuthProvider, bindOidcSession, configureAuth } from './auth/auth-context';
import { getOidc, initOidc } from './auth/oidc';
import { APP_NAME, configureDemo, configureStandalone } from './config';
import { router } from './router';
import './i18n';
import './index.css';

document.title = APP_NAME; // marque runtime (white-label)

// Pas de nouvelle tentative sur une erreur 4xx (401/403/404…) : la réponse ne
// changera pas et l'UI doit l'afficher tout de suite (ex. siège d'hôte pris).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 3,
    },
  },
});

/**
 * Découverte du mode d'auth auprès du backend AVANT le rendu — pour que la garde
 * de route (synchrone) connaisse l'état dès le premier affichage (refresh inclus).
 */
async function bootstrap(): Promise<void> {
  let mode: AuthMode = 'none';
  let initialUser: string | null = null;
  try {
    const { data } = await authConfigControllerConfig();
    mode = data.mode;
    configureDemo(data.demo ?? null);
    configureStandalone(data.standalone === true);
    if (data.mode === 'oidc' && data.oidc) {
      initOidc(data.oidc.authority, data.oidc.clientId);
      bindOidcSession();
      const oidcUser = await getOidc().getUser();
      if (oidcUser && !oidcUser.expired) {
        setAuthHeaders({ Authorization: `Bearer ${oidcUser.access_token}` });
        const p = oidcUser.profile;
        initialUser = p.name ?? p.preferred_username ?? p.sub ?? 'Animateur';
      }
      configureAuth('oidc', initialUser !== null);
    } else {
      configureAuth('none');
    }
  } catch {
    configureAuth('none'); // backend injoignable → repli mode local
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider mode={mode} initialUser={initialUser}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
