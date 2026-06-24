import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authConfigControllerConfig } from './api/generated/auth/auth';
import { setAuthHeaders } from './api/http';
import { type AuthMode, AuthProvider, configureAuth } from './auth/auth-context';
import { getOidc, initOidc } from './auth/oidc';
import { router } from './router';
import './i18n';
import './index.css';

const queryClient = new QueryClient();

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
    if (data.mode === 'oidc' && data.oidc) {
      initOidc(data.oidc.authority, data.oidc.clientId);
      const oidcUser = await getOidc().getUser();
      if (oidcUser && !oidcUser.expired) {
        setAuthHeaders({ Authorization: `Bearer ${oidcUser.access_token}` });
        const p = oidcUser.profile;
        initialUser = p.name ?? p.preferred_username ?? p.sub ?? 'Formateur';
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
