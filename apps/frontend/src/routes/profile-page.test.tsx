import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAnonymousParticipants } from '../config';
import { mockApi, renderApp } from '../test/harness';

const me = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'Marc',
  email: 'marc@ex.io',
  roles: ['host'],
  subject: 'local:marc',
  ...over,
});

/**
 * La page dit d'où vient chaque chose plutôt que de laisser croire qu'elle se
 * change ici : le nom vient de la connexion, le rôle d'un octroi d'opérateur.
 */
describe('ProfilePage', () => {
  beforeEach(() => localStorage.setItem('live.localUser', 'Marc'));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('montre identité, sujet du compte et rôle d’animateur', async () => {
    mockApi([{ method: 'GET', path: '/me', body: me() }]);
    renderApp('/profile');

    // On attend un élément propre à la page : « Marc » est aussi dans la barre.
    expect(await screen.findByText('Animateur')).toBeInTheDocument();
    expect(screen.getByText('marc@ex.io')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mon compte' })).toBeInTheDocument();
    // Le sujet est ce qu'un opérateur tape dans `user:set-role`.
    expect(screen.getByText('local:marc')).toBeInTheDocument();
    expect(screen.getByText(/créer, éditer et présenter des quiz/i)).toBeInTheDocument();
  });

  it('dit au gestionnaire que gérer n’est pas animer (RG-14)', async () => {
    mockApi([{ method: 'GET', path: '/me', body: me({ roles: ['admin'], email: null }) }]);
    renderApp('/profile');

    expect(await screen.findByText('Gestionnaire')).toBeInTheDocument();
    expect(screen.getByText(/Gérer n’est pas animer/i)).toBeInTheDocument();
    expect(screen.getByText('aucun')).toBeInTheDocument();
  });

  it('montre les deux rôles d’un compte qui gère et anime (RG-14)', async () => {
    mockApi([{ method: 'GET', path: '/me', body: me({ roles: ['admin', 'host'] }) }]);
    renderApp('/profile');

    expect(await screen.findByText('Gestionnaire')).toBeInTheDocument();
    expect(screen.getByText('Animateur')).toBeInTheDocument();
  });

  describe('preferences (#57)', () => {
    afterEach(() => configureAnonymousParticipants(false));

    it('changes the participant access used at launch, back to asking too', async () => {
      configureAnonymousParticipants(true);
      const api = mockApi([
        { method: 'GET', path: '/me/preferences', body: { participantAccess: 'open' } },
        { method: 'PATCH', path: '/me/preferences', body: {} },
        { method: 'GET', path: '/me', body: me({ subject: 'kc-sub' }) },
      ]);
      renderApp('/profile', 'oidc', true);

      const select = await screen.findByLabelText('Accès des participants au lancement');
      await waitFor(() => expect(select).toHaveValue('open'));
      fireEvent.change(select, { target: { value: 'ask' } });
      await waitFor(() =>
        expect(
          api.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === 'PATCH')?.[1],
        ).toMatchObject({ body: JSON.stringify({ participantAccess: null }) }),
      );
    });

    it('shows no preference when open access is not offered', async () => {
      mockApi([{ method: 'GET', path: '/me', body: me() }]);
      renderApp('/profile');
      expect(await screen.findByText('Animateur')).toBeInTheDocument();
      expect(screen.queryByText('Préférences')).toBeNull();
    });
  });
});
