import { OptionColor, OptionShape, type PublicOption } from '@quiz-dock/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OptionGrid, OptionTiles } from './live-components';

const options = (count: number): PublicOption[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `o${i}`,
    text: `Answer ${i}`,
    color: OptionColor.Red,
    shape: OptionShape.Triangle,
  }));

describe('OptionTiles', () => {
  // Two columns whatever the count, as on the projection: an answer sits at the same place (#92).
  it.each([2, 3, 4, 5, 6, 8])('lays %i answers out in two columns', (count) => {
    render(<OptionTiles options={options(count)} onPick={() => {}} />);
    const tiles = screen.getAllByRole('button');
    expect(tiles).toHaveLength(count);
    expect(tiles[0].parentElement).toHaveClass('grid-cols-2');
  });

  it('centres an odd last answer on its own row, at the width of the others', () => {
    render(<OptionTiles options={options(5)} onPick={() => {}} />);
    const tiles = screen.getAllByRole('button');
    expect(tiles[4]).toHaveClass('col-span-2', 'justify-self-center');
    expect(tiles[3]).not.toHaveClass('col-span-2');
  });
});

describe('OptionGrid', () => {
  it('puts the text in the tiles, in the same two columns, and takes a pick', async () => {
    const picked: string[] = [];
    render(
      <OptionGrid options={options(3)} onPick={(id) => picked.push(id)} selectedIds={['o1']} />,
    );
    const tiles = screen.getAllByRole('button');
    expect(tiles[0].parentElement).toHaveClass('grid-cols-2');
    expect(tiles[0]).toHaveTextContent('Answer 0');
    expect(tiles[1]).toHaveAttribute('aria-pressed', 'true');
    expect(tiles[2]).toHaveClass('col-span-2');
    tiles[2].click();
    expect(picked).toEqual(['o2']);
  });
});
