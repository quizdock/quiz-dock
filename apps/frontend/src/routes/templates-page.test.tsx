import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  author: { name: 'Alice', subject: 'local:alice' },
  revision: 2,
  sharedAt: '2026-09-23T08:00:00.000Z',
};

/** #39 — taking a template must read as "a copy lands in my bank", never as sharing access. */
describe('TemplatesPage', () => {
  it('lists the catalogue with its author, revision and licence', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([{ method: 'GET', path: '/store', body: [ENTRY] }]);
    renderApp('/templates');

    expect(await screen.findByText('Ports du monde')).toBeInTheDocument();
    expect(screen.getByText(/par Alice/)).toBeInTheDocument();
    expect(screen.getByText(/révision 2/)).toBeInTheDocument();
    expect(screen.getByText(/CC-BY-4.0/)).toBeInTheDocument();
    expect(screen.getByText('10 questions')).toBeInTheDocument();
    localStorage.clear();
  });

  it('taking a copy opens the new draft in the editor', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    const fetchMock = mockApi([
      { method: 'GET', path: '/store', body: [ENTRY] },
      { method: 'POST', path: `/store/${ENTRY.id}/take`, body: { id: 'new-draft' } },
      {
        method: 'GET',
        path: '/quizzes/new-draft',
        body: {
          id: 'new-draft',
          title: 'Ports du monde',
          status: 'draft',
          questions: [],
          slides: [],
        },
      },
      { method: 'GET', path: '/quizzes', body: [] },
    ]);
    renderApp('/templates');

    fireEvent.click(await screen.findByRole('button', { name: /Prendre une copie/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, opts]) =>
            String(url).includes(`/store/${ENTRY.id}/take`) &&
            (opts as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
    localStorage.clear();
  });

  it('says so when nothing has been shared yet', async () => {
    localStorage.setItem('live.localUser', 'Marc');
    mockApi([{ method: 'GET', path: '/store', body: [] }]);
    renderApp('/templates');
    expect(await screen.findByText(/Aucun modèle n’a encore été partagé/)).toBeInTheDocument();
    localStorage.clear();
    vi.unstubAllGlobals();
  });
});
