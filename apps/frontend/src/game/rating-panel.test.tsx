import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RatingPanel } from './rating-panel';

describe('RatingPanel', () => {
  afterEach(() => localStorage.clear());

  it('émet player:rate avec la note + commentaire, puis confirme à l’ack', () => {
    // emit(event, payload, ack) — on rappelle l'ack avec ok:true comme le serveur.
    const emit = vi.fn((_event: string, _payload: unknown, ack?: (r: { ok: boolean }) => void) =>
      ack?.({ ok: true }),
    );
    const socket = { emit } as never;
    render(<RatingPanel pin="482913" socket={socket} />);

    fireEvent.click(screen.getByLabelText('4 étoiles'));
    fireEvent.change(screen.getByPlaceholderText(/commentaire/i), { target: { value: 'Super !' } });
    fireEvent.click(screen.getByRole('button', { name: /Envoyer mon avis/ }));

    expect(emit).toHaveBeenCalledWith(
      'player:rate',
      { pin: '482913', rating: 4, comment: 'Super !' },
      expect.any(Function),
    );
    // L'ack ok:true bascule sur le remerciement (et mémorise localement).
    expect(screen.getByText(/Merci pour ton avis/)).toBeInTheDocument();
    expect(localStorage.getItem('live.rated.482913')).toBe('1');
  });

  it('désactive l’envoi tant qu’aucune étoile n’est choisie', () => {
    const socket = { emit: vi.fn() } as never;
    render(<RatingPanel pin="000000" socket={socket} />);
    expect(screen.getByRole('button', { name: /Envoyer mon avis/ })).toBeDisabled();
  });

  it('ne reste pas bloqué sur « Envoi… » si l’accusé n’arrive jamais', () => {
    vi.useFakeTimers();
    try {
      const socket = { emit: vi.fn() } as never; // n'appelle jamais l'ack
      render(<RatingPanel pin="222222" socket={socket} />);
      fireEvent.click(screen.getByLabelText('3 étoiles'));
      fireEvent.click(screen.getByRole('button', { name: /Envoyer mon avis/ }));
      expect(screen.getByRole('button', { name: /Envoi…/ })).toBeDisabled();

      act(() => void vi.advanceTimersByTime(8000)); // expiration du garde-fou
      expect(screen.getByRole('button', { name: /Envoyer mon avis/ })).toBeEnabled();
      expect(screen.getByText(/Envoi impossible/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne re-sollicite pas un joueur ayant déjà noté (dédoublonnage local)', () => {
    localStorage.setItem('live.rated.111111', '1');
    const socket = { emit: vi.fn() } as never;
    render(<RatingPanel pin="111111" socket={socket} />);
    expect(screen.queryByRole('button', { name: /Envoyer mon avis/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Merci pour ton avis/)).toBeInTheDocument();
  });
});
