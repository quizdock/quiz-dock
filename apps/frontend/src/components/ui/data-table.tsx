import {
  type ColumnDef,
  type RowData,
  type SortingState,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatPercent } from '@/lib/format';

/** What every table of the app can do: sort by a column (UI system §1.7). */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime },
  columnMeta: {} as { align?: 'left' | 'right' | 'center'; className?: string },
});

export type DataColumn<TData extends RowData> = ColumnDef<typeof features, TData, unknown>;

/**
 * A table whose columns sort by a click on their header (asc, desc, back), with
 * `aria-sort` for screen readers. `onRowClick` makes a whole row lead somewhere; its
 * first link stays the keyboard's way there.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  initialSort = [],
  onRowClick,
  className,
  footer,
  caption,
  rowId,
}: {
  columns: DataColumn<TData>[];
  data: TData[];
  /**
   * What a row is, whatever its place: a row that holds state (an open dialog)
   * keeps it on the same item when the list is refetched in another order.
   */
  rowId?: (row: TData) => string;
  initialSort?: SortingState;
  onRowClick?: (row: TData) => void;
  className?: string;
  footer?: ReactNode;
  /** What the table lists, as its title: read first by a screen reader too. */
  caption?: ReactNode;
}) {
  const table = useTable({
    features,
    columns,
    data,
    ...(rowId ? { getRowId: (row: TData) => rowId(row) } : {}),
    initialState: { sorting: initialSort },
  });
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        {caption ? (
          <caption className="pb-2 text-left text-sm font-medium">{caption}</caption>
        ) : null}
        <thead className="text-muted-foreground border-b text-left">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const label = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                    className={cn(
                      'py-2 pr-2 font-medium',
                      meta?.align === 'right' && 'text-right',
                      meta?.align === 'center' && 'text-center',
                      meta?.className,
                    )}
                  >
                    {canSort && label ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'hover:text-foreground inline-flex items-center gap-1',
                          sorted && 'text-foreground',
                          meta?.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {label}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'border-b last:border-0',
                onRowClick && 'hover:bg-accent/40 cursor-pointer',
              )}
            >
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <td
                    key={cell.id}
                    className={cn(
                      'py-2 pr-2 align-middle',
                      meta?.align === 'right' && 'text-right tabular-nums',
                      meta?.align === 'center' && 'text-center',
                      meta?.className,
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

/** A share (0..1) as a bar and its percentage: how a success reads at a glance. */
export function ShareBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="bg-muted inline-block h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
        <span className="bg-success block h-full rounded-full" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-10 text-right tabular-nums">{formatPercent(value)}</span>
    </span>
  );
}
