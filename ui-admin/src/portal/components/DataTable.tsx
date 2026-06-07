import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Fragment, useState, type FC, type ReactNode } from "react";

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  globalFilterPlaceholder?: string;
  empty?: ReactNode;
  initialSort?: SortingState;
  rowKey: (row: T) => string | number;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  density?: "compact" | "cozy";
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  data,
  columns,
  globalFilterPlaceholder = "Search…",
  empty,
  initialSort = [],
  rowKey,
  toolbarLeft,
  toolbarRight,
  density = "cozy",
  onRowClick
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState("");

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

  const rowPadding = density === "compact" ? "py-1.5" : "py-2.5";
  const rows = table.getRowModel().rows;

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
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-[#08080a]/80">
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
              rows.map((row) => (
                <tr
                  key={rowKey(row.original)}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={`border-b border-white/5 last:border-b-0 ${rowPadding} ${
                    onRowClick ? "cursor-pointer transition hover:bg-white/[0.04]" : ""
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`whitespace-nowrap px-3 align-middle ${cell.column.columnDef.meta?.cellClassName ?? ""}`}
                    >
                      <Fragment>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Fragment>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { ColumnDef };

export const TableShell: FC<{ children: ReactNode }> = ({ children }) => <Fragment>{children}</Fragment>;
