import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('affiche le titre du produit', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Roux-Quizz' })).toBeInTheDocument();
  });

  it('propose de rejoindre une session', () => {
    render(<App />);
    expect(screen.getByLabelText('Rejoindre une session')).toBeInTheDocument();
  });
});
