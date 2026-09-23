import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/harness';

const ENTRY = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  title: 'Ports du monde',
  description: 'Les grands ports',
  language: 'fr',
  tags: ['geo'],
  questionCount: 10,
  license: 'CC-BY-4.0',
  coverUrl: null,
  author: { name: 'Alice', subject: 'local:alice' },
  revision: 2,
  sharedAt: '2026-09-23T08:00:00.000Z',
};

/** #39 — taking a template must read as "a copy lands in my bank", never as sharing access. */
describe('TemplatesPage (galerie)', () => {
  it('montre une carte par modèle, avec sa vignette et son auteur', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([{ method: 'GET', path: '/store', body: [ENTRY] }]);
    renderApp('/templates');

    expect(await screen.findByText('Ports du monde')).toBeInTheDocument();
    expect(screen.getByText(/partagé par Alice/)).toBeInTheDocument();
    expect(screen.getByText('10 questions')).toBeInTheDocument();
    // La carte mène à l'aperçu : c'est là qu'on décide.
    expect(screen.getByRole('link', { name: /Ports du monde/ })).toHaveAttribute(
      'href',
      `/templates/${ENTRY.id}`,
    );
    localStorage.clear();
  });

  it('permet de créer depuis la carte, sans ouvrir le modèle', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([
      {
        method: 'GET',
        path: '/me',
        body: {
          id: 'u1',
          displayName: 'Marc',
          email: null,
          roles: ['host'],
          subject: 'local:marc',
        },
      },
      { method: 'GET', path: '/store', body: [ENTRY] },
    ]);
    renderApp('/templates');

    expect(await screen.findByRole('button', { name: /Créer à partir/ })).toBeInTheDocument();
    localStorage.clear();
  });

  it('dit quand rien n’a encore été partagé', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([{ method: 'GET', path: '/store', body: [] }]);
    renderApp('/templates');
    expect(await screen.findByText(/Aucun modèle n’a encore été partagé/)).toBeInTheDocument();
    localStorage.clear();
    vi.unstubAllGlobals();
  });
});

describe('TemplatePage (aperçu)', () => {
  const PREVIEW = {
    ...ENTRY,
    coverUrl: null,
    slideCount: 1,
    items: [
      {
        kind: 'question',
        text: 'Quel est le plus grand port d’Europe ?',
        type: 'single_choice',
        timeLimitS: 20,
        mediaUrl: null,
        mediaAlt: null,
        options: [
          { text: 'Rotterdam', color: 'red', shape: 'triangle' },
          { text: 'Anvers', color: 'blue', shape: 'diamond' },
        ],
      },
      {
        kind: 'slide',
        text: 'Bienvenue',
        type: null,
        timeLimitS: null,
        mediaUrl: null,
        mediaAlt: null,
        options: [],
      },
    ],
  };

  it('montre ce que le modèle contient avant d’en prendre une copie', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([
      {
        method: 'GET',
        path: '/me',
        body: {
          id: 'u1',
          displayName: 'Marc',
          email: null,
          roles: ['host'],
          subject: 'local:marc',
        },
      },
      { method: 'GET', path: `/store/${ENTRY.id}`, body: PREVIEW },
    ]);
    renderApp(`/templates/${ENTRY.id}`);

    expect(await screen.findByText(/plus grand port d’Europe/)).toBeInTheDocument();
    expect(screen.getByText('Rotterdam')).toBeInTheDocument();
    expect(screen.getByText('Bienvenue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer à partir de ce modèle/ })).toBeInTheDocument();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('explique à un non-animateur pourquoi il ne peut pas prendre de copie', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([
      {
        method: 'GET',
        path: '/me',
        body: { id: 'u1', displayName: 'Marc', email: null, roles: [], subject: 'local:marc' },
      },
      { method: 'GET', path: `/store/${ENTRY.id}`, body: PREVIEW },
    ]);
    renderApp(`/templates/${ENTRY.id}`);

    expect(await screen.findByText(/action d’animateur/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Créer à partir/ })).toBeNull();
    localStorage.clear();
    vi.unstubAllGlobals();
  });
});
