import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useRef, useState, type FC, type ReactNode } from "react";

interface VirtualDataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  rowKey: (row: T) => string | number;
  rowHeight?: number;
  globalFilterPlaceholder?: string;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  initialSort?: SortingState;
  empty?: ReactNode;
}

export function VirtualDataTable<T>({
  data,
  columns,
  rowKey,
  rowHeight = 38,
  globalFilterPlaceholder = "Search…",
  toolbarLeft,
  toolbarRight,
  initialSort = [],
  empty
}: VirtualDataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState("");
  const parentRef = useRef<HTMLDivElement | null>(null);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue ?? "").toLowerCase().trim();
      if (q.length === 0) return true;
      const haystack = JSON.stringify(row.original).toLowerCase();
      return haystack.includes(q);
    }
  });

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          {toolbarLeft}
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={globalFilterPlaceholder}
              className="w-full rounded-md border border-white/10 bg-black/30 py-1.5 pl-7 pr-3 text-xs text-white outline-none placeholder:text-white/35 focus:border-emerald-300/40"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {toolbarRight}
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/55">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
        </div>
      </div>
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-[#08080a]/80"
      >
        <table className="w-full border-collapse text-left text-xs text-white/85">
          <thead className="sticky top-0 z-10 bg-[#0d0d10]/95 backdrop-blur">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-white/10">
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/55 ${
                        header.column.columnDef.meta?.className ?? ""
                      }`}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 transition hover:text-white"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 text-white/30" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-white/45">
                  {empty ?? "No matching records."}
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr>
                    <td colSpan={columns.length} style={{ height: paddingTop }} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <tr
                      key={rowKey(row.original)}
                      className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.04]"
                      style={{ height: rowHeight }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={`whitespace-nowrap px-3 align-middle ${cell.column.columnDef.meta?.cellClassName ?? ""}`}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr>
                    <td colSpan={columns.length} style={{ height: paddingBottom }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { ColumnDef };

export const VirtualTableShell: FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;
