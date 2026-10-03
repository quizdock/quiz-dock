import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/harness';
import { JoinAddressPicker } from './join-address-picker';

const renderPicker = (current: string, onChange = vi.fn(), room?: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <JoinAddressPicker current={current} onChange={onChange} room={room} />
    </QueryClientProvider>,
  );
  return Object.assign(onChange, { unmount: view.unmount });
};

describe('JoinAddressPicker', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('offers the public URL, the LAN addresses and this page; prefers a LAN address over localhost', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/join-addresses',
        body: { publicUrl: null, lanIps: ['192.168.1.103'], lanSource: 'detected' },
      },
    ]);
    const onChange = renderPicker(window.location.origin);
    // jsdom's origin is http://localhost → the LAN address is proposed automatically.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        `http://192.168.1.103${window.location.port ? `:${window.location.port}` : ''}`,
      ),
    );
    const select = (await screen.findByLabelText('Adresse pour rejoindre')) as HTMLSelectElement;
    const port = window.location.port ? `:${window.location.port}` : '';
    expect([...select.options].map((o) => o.value)).toEqual([
      `http://192.168.1.103${port}`,
      window.location.origin,
      '__custom__',
    ]);
  });

  it('on a server (not localhost) keeps the origin the proxy resolved, whatever the browser remembers', async () => {
    localStorage.setItem('live.joinBaseUrl', 'http://192.168.0.3:15173');
    mockApi([
      {
        method: 'GET',
        path: '/games/join-addresses',
        body: { publicUrl: null, lanIps: ['192.168.0.3'], lanSource: 'configured' },
      },
    ]);
    // jsdom's origin is localhost: pretend the page was reached through https://quiz.example.org.
    vi.stubGlobal('location', {
      ...window.location,
      origin: 'https://quiz.example.org',
      protocol: 'https:',
      port: '',
    });
    const onChange = renderPicker('https://quiz.example.org');
    await screen.findByLabelText('Adresse pour rejoindre');
    await new Promise((r) => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('prefers APP_PUBLIC_URL when the deployment declares one', async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/join-addresses',
        body: { publicUrl: 'https://quiz.example.org', lanIps: [], lanSource: 'hidden' },
      },
    ]);
    const onChange = renderPicker(window.location.origin);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://quiz.example.org'));
  });

  it('lets the host type any address and remembers the session’s choice', async () => {
    mockApi([{ method: 'GET', path: '/games/join-addresses', body: { publicUrl: null, lan: [] } }]);
    const onChange = renderPicker('http://quiz.example.org');
    const select = (await screen.findByLabelText('Adresse pour rejoindre')) as HTMLSelectElement;
    expect(select.value).toBe('__custom__'); // not among the candidates → custom
    fireEvent.change(screen.getByLabelText('Autre adresse…'), {
      target: { value: '10.0.0.7:18081' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onChange).toHaveBeenCalledWith('10.0.0.7:18081');
    await waitFor(() =>
      expect(localStorage.getItem('live.joinBaseUrl')).toBe('http://quiz.example.org'),
    );
  });

  it("reopened, it keeps the host's choice for the room: the address is settled once", async () => {
    mockApi([
      {
        method: 'GET',
        path: '/games/join-addresses',
        body: { publicUrl: 'https://quiz.example.org', lanIps: [], lanSource: 'detected' },
      },
    ]);
    const first = renderPicker(window.location.origin, vi.fn(), '424242');
    await waitFor(() => expect(first).toHaveBeenCalledWith('https://quiz.example.org'));
    first.unmount();
    // The host chose this page's address meanwhile; the picker opens again.
    const again = renderPicker(window.location.origin, vi.fn(), '424242');
    await screen.findByLabelText('Adresse pour rejoindre');
    await new Promise((r) => setTimeout(r, 20));
    expect(again).not.toHaveBeenCalled();
  });
});
