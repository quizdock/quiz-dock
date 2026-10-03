import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataColumn } from './data-table';

type Row = { id: string; name: string };

/** A cell that keeps state, as a row's dialog does: what it holds is the row it opened on. */
function Opened({ row }: { row: Row }) {
  const [opened, setOpened] = useState<string | null>(null);
  return opened ? (
    <span>{`opened on ${opened}, now ${row.name}`}</span>
  ) : (
    <button onClick={() => setOpened(row.name)}>{`open ${row.name}`}</button>
  );
}

const columns: DataColumn<Row>[] = [
  { id: 'action', header: 'Action', cell: ({ row: { original } }) => <Opened row={original} /> },
];

describe('DataTable', () => {
  it('with row ids, a row keeps its state on its item when the list comes back reordered', () => {
    const a = { id: 'a', name: 'Ada' };
    const b = { id: 'b', name: 'Bea' };
    const { rerender } = render(<DataTable columns={columns} data={[a, b]} rowId={(r) => r.id} />);
    fireEvent.click(screen.getByText('open Ada'));
    rerender(<DataTable columns={columns} data={[b, a]} rowId={(r) => r.id} />);
    expect(screen.getByText('opened on Ada, now Ada')).toBeInTheDocument();
  });
});
