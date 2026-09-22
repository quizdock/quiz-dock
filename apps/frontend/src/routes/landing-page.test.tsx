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

  it('lists the guards in demo mode, with the host seat duration', async () => {
    configureDemo({ seatMinutes: 5 });
    mockApi([]);
    renderApp('/');
    expect(await screen.findByText(/Ce que cette démo ne fait pas/i)).toBeInTheDocument();
    expect(screen.getByText(/le siège dure 5 min/i)).toBeInTheDocument();
    expect(screen.getByText(/Aucun envoi de média/i)).toBeInTheDocument();
    expect(screen.getByText(/effacé chaque heure/i)).toBeInTheDocument();
    // Not the all-in-one image: that limitation is not this instance's.
    expect(screen.queryByText(/Image tout-en-un/i)).not.toBeInTheDocument();
    // And the point of the whole block: self-hosting has none of these.
    expect(screen.getByText(/Hébergé chez vous/i)).toBeInTheDocument();
  });

  it('adds the all-in-one image limitation when the backend says so', async () => {
    configureDemo({ seatMinutes: 5 });
    configureStandalone(true);
    mockApi([]);
    renderApp('/');
    expect(await screen.findByText(/Image tout-en-un/i)).toBeInTheDocument();
  });
});
