import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './display';

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; className?: string; hideOnMobile?: boolean };

/** Clean tabular layout with loading skeleton rows and an empty slot. */
export function DataTable<T>({ columns, rows, loading, empty, rowKey, onRowClick }: {
  columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; empty?: ReactNode; rowKey: (r: T) => string | number;
  onRowClick?: (r: T) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas/60 text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
            {columns.map((c) => <th key={c.key} scope="col" className={cn('px-4 py-2.5 font-medium', c.hideOnMobile && 'hidden md:table-cell', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {loading && !rows?.length
            ? Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key} className={cn('px-4 py-3.5', c.hideOnMobile && 'hidden md:table-cell')}><Skeleton className="h-4 w-full max-w-[160px]" /></td>)}</tr>
            ))
            : rows?.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('text-ink', onRowClick && 'cursor-pointer hover:bg-canvas/70')}>
                {columns.map((c) => <td key={c.key} className={cn('px-4 py-3', c.hideOnMobile && 'hidden md:table-cell', c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && empty}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-muted">
      <span>{total.toLocaleString()} result{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <span>Page {page} of {pages}</span>
        <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}
