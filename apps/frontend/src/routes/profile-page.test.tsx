import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const me = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  displayName: 'Marc',
  email: 'marc@ex.io',
  role: 'host',
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
    mockApi([{ method: 'GET', path: '/me', body: me({ role: 'admin', email: null }) }]);
    renderApp('/profile');

    expect(await screen.findByText('Gestionnaire')).toBeInTheDocument();
    expect(screen.getByText(/Gérer n’est pas animer/i)).toBeInTheDocument();
    expect(screen.getByText('aucun')).toBeInTheDocument();
  });
});
