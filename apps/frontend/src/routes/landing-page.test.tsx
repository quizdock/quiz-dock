import { screen } from '@testing-library/react';
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
    expect(await screen.findByText(/Rejoindre une session/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ce que cette démo ne fait pas/i)).not.toBeInTheDocument();
  });

  it('lists the guards in demo mode, starting with the shared account', async () => {
    configureDemo({ user: 'demo_user' });
    mockApi([]);
    renderApp('/');
    expect(await screen.findByText(/Ce que cette démo ne fait pas/i)).toBeInTheDocument();
    expect(screen.getByText(/chaque visiteur est demo_user/i)).toBeInTheDocument();
    expect(screen.getByText(/modèles France et Taïwan/i)).toBeInTheDocument();
    expect(screen.getByText(/Aucun envoi de média/i)).toBeInTheDocument();
    expect(screen.getByText(/effacé chaque heure : quiz/i)).toBeInTheDocument();
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
