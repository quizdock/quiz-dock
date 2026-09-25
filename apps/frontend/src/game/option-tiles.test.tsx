import { OptionColor, OptionShape, type PublicOption } from '@quiz-dock/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OptionTiles } from './live-components';

const options = (count: number): PublicOption[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `o${i}`,
    text: `Answer ${i}`,
    color: OptionColor.Red,
    shape: OptionShape.Triangle,
  }));

describe('OptionTiles', () => {
  // Up to four answers share one row; past that, two balanced rows.
  it.each([
    [2, 'grid-cols-2'],
    [4, 'grid-cols-4'],
    [5, 'grid-cols-3'],
    [6, 'grid-cols-3'],
    [8, 'grid-cols-4'],
  ])('lays %i answers out with %s', (count, columns) => {
    render(<OptionTiles options={options(count)} onPick={() => {}} />);
    const tiles = screen.getAllByRole('button');
    expect(tiles).toHaveLength(count);
    expect(tiles[0].parentElement).toHaveClass(columns);
  });
});
