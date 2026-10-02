import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../test/harness';
import { AdminQuizzesPage } from './admin-quizzes-page';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const result = (data: unknown) => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});

const search = {
  total: 2,
  items: [
    {
      id: 'q1',
      title: 'Capitales',
      status: 'ready',
      questionCount: 10,
      updatedAt: new Date().toISOString(),
      owner: { id: 'u1', name: 'Claire', subject: 'local:claire', reachable: true },
      livePin: '123456',
    },
    {
      id: 'q2',
      title: 'Fleuves',
      status: 'draft',
      questionCount: 3,
      updatedAt: new Date().toISOString(),
      owner: { id: 'u2', name: 'Marc', subject: 'local:marc', reachable: false },
      livePin: null,
    },
  ],
  owners: [
    { id: 'u1', name: 'Claire', subject: 'local:claire', quizzes: 1 },
    { id: 'u2', name: 'Marc', subject: 'local:marc', quizzes: 1 },
  ],
};

function renderPage() {
  const fetchMock = mockApi([
    { method: 'POST', path: '/admin/operations/quizzes.search', body: result(search) },
    { method: 'GET', path: '/admin/operations', body: { operations: [] } },
    { method: 'POST', path: '/admin/operations/quizzes.archive', body: result({ quiz: 'q2' }) },
  ]);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AdminQuizzesPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof mockApi>, id: string) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith(`/admin/operations/${id}`))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).params);

describe('AdminQuizzesPage', () => {
  it("lists every quiz with its owner, flags what is played or out of its owner's reach", async () => {
    renderPage();
    const row = (await screen.findByText('Capitales')).closest('tr')!;
    expect(within(row).getByText('Claire')).toBeInTheDocument();
    expect(within(row).getByText(/123456/)).toBeInTheDocument();
    const other = screen.getByText('Fleuves').closest('tr')!;
    expect(within(other).getByText('local:marc')).toBeInTheDocument();
    expect(other.textContent).not.toContain('123456');
  });

  it('searches and filters on the server, back to the first page', async () => {
    const fetchMock = renderPage();
    await screen.findByText('Capitales');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cap' } });
    await waitFor(() =>
      expect(calls(fetchMock, 'quizzes.search').at(-1)).toMatchObject({ q: 'cap', offset: 0 }),
    );
  });

  it("archives someone's quiz from its row", async () => {
    const fetchMock = renderPage();
    const row = (await screen.findByText('Fleuves')).closest('tr')!;
    fireEvent.click(within(row).getAllByRole('button').at(-1)!);
    fireEvent.click(await screen.findByRole('button', { name: /Archiver/ }));
    await waitFor(() => expect(calls(fetchMock, 'quizzes.archive')).toEqual([{ quiz: 'q2' }]));
  });
});
