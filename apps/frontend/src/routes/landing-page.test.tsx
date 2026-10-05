import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { configureDemo, configureStandalone } from '../config';
import { mockApi, renderApp } from '../test/harness';

/**
 * A public demo has to say what it does *not* do, once, where people land —
 * otherwise a guard of that instance reads as a limit of the product.
 */
describe('LandingPage — demo limitations', () => {
  afterEach(() => {
    configureDemo(null);
    configureStandalone(false);
  });

  it('says nothing on an ordinary instance', async () => {
    mockApi([]);
    renderApp('/');
    expect(await screen.findByText(/Rejoindre un salon/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ce que cette démo ne fait pas/i)).not.toBeInTheDocument();
  });

  it('lists the guards in demo mode, starting with the shared account', async () => {
    configureDemo({ user: 'demo_user' });
    mockApi([]);
    renderApp('/');
    expect(await screen.findByText(/Ce que cette démo ne fait pas/i)).toBeInTheDocument();
    expect(screen.getByText(/chaque visiteur est demo_user/i)).toBeInTheDocument();
    // The three samples the backend puts back in the shared bank at each reset.
    expect(screen.getByText(/quiz d’exemple France, Taïwan et Türkiye/i)).toBeInTheDocument();
    expect(screen.getByText(/Aucun envoi de média/i)).toBeInTheDocument();
    // The reset waits for an open room, but not past DEMO_RESET_MAX_DEFER_MS.
    expect(screen.getByText(/effacé chaque heure : quiz.*3 heures au plus/i)).toBeInTheDocument();
    // Not the all-in-one image: that limitation is not this instance's.
    expect(screen.queryByText(/Image tout-en-un/i)).not.toBeInTheDocument();
    // And the point of the whole block: self-hosting has none of these.
    expect(screen.getByText(/Hébergé chez vous/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Héberger la vôtre/i })).toHaveAttribute(
      'href',
      'https://quizdock.github.io',
    );
  });

  it('adds the all-in-one image limitation when the backend says so', async () => {
    configureDemo({ user: 'demo_user' });
    configureStandalone(true);
    mockApi([]);
    renderApp('/');
    expect(await screen.findByText(/Image tout-en-un/i)).toBeInTheDocument();
  });
});

describe('LandingPage — the PIN', () => {
  it('names its field for screen readers, and checks the PIN at its 6th digit (audit F14)', async () => {
    mockApi([]);
    renderApp('/');
    const field = await screen.findByRole('textbox', { name: 'PIN, 6 chiffres' });
    fireEvent.change(field, { target: { value: '77a1' } });
    // Digits only; nothing to join until the PIN is whole.
    expect(field).toHaveValue('771');
    expect(screen.queryByRole('button', { name: 'Continuer' })).toBeNull();
    expect(screen.getByText('Vérifié dès le 6ᵉ chiffre.')).toBeInTheDocument();
  });

  it('offers the host area to one who is not signed in', async () => {
    mockApi([]);
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Se connecter' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});

describe('LandingPage — feedback', () => {
  it('invites bug reports, feature ideas, translation fixes and questions, as filled-in forms, and a star', async () => {
    mockApi([]);
    renderApp('/');
    const bug = await screen.findByRole('link', { name: 'Signaler un bug' });
    expect(bug.getAttribute('href')).toMatch(
      /^https:\/\/github\.com\/quizdock\/quiz-dock\/issues\/new\?template=bug\.yml&version=/,
    );
    expect(bug).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Proposer une fonctionnalité' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Corriger une traduction' }).getAttribute('href'),
    ).toContain('language=Fran%C3%A7ais+%28fr%29');
    expect(screen.getByRole('link', { name: 'Poser une question' })).toHaveAttribute(
      'href',
      'https://github.com/quizdock/quiz-dock/discussions/new?category=q-a',
    );
    expect(screen.getByRole('link', { name: 'Donnez-lui une étoile sur GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/quizdock/quiz-dock',
    );
  });

  it('links to the documentation, in a new tab', async () => {
    mockApi([]);
    renderApp('/');
    const docs = await screen.findByRole('link', { name: 'Documentation' });
    expect(docs).toHaveAttribute('href', 'https://quizdock.github.io/docs/');
    expect(docs).toHaveAttribute('target', '_blank');
  });

  it('links to the documentation on a demo too', async () => {
    configureDemo({ user: 'demo_user' });
    try {
      mockApi([]);
      renderApp('/');
      expect(await screen.findByRole('link', { name: 'Documentation' })).toHaveAttribute(
        'href',
        'https://quizdock.github.io/docs/',
      );
    } finally {
      configureDemo(null);
    }
  });
});
