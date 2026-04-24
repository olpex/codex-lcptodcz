import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortAccessor?: (row: T) => string | number | null | undefined;
  className?: string;
  headerClassName?: string;
};

type DataTableSearchConfig<T> = {
  placeholder?: string;
  getSearchText: (row: T) => string;
  emptyResultText?: string;
};

type DataTableProps<T> = {
  data: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string | number;
  rowClassName?: (row: T) => string | undefined;
  isLoading?: boolean;
  errorText?: string | null;
  onRetry?: (() => void) | null;
  retryLabel?: string;
  emptyText?: string;
  pageSizeOptions?: number[];
  initialPageSize?: number;
  search?: DataTableSearchConfig<T>;
  className?: string;
};

type SortDirection = "asc" | "desc";

type SortState = {
  columnKey: string;
  direction: SortDirection;
} | null;

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), "uk-UA", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  rowClassName,
  isLoading = false,
  errorText = null,
  onRetry = null,
  retryLabel = "Повторити",
  emptyText = "Дані відсутні",
  pageSizeOptions = [10, 20, 50],
  initialPageSize = 10,
  search,
  className
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sortState, setSortState] = useState<SortState>(null);

  const sortableColumns = useMemo(
    () => columns.filter((column) => typeof column.sortAccessor === "function").map((column) => column.key),
    [columns]
  );

  const filteredData = useMemo(() => {
    if (!search || !query.trim()) return data;
    const normalized = query.trim().toLocaleLowerCase("uk-UA");
    return data.filter((row) => search.getSearchText(row).toLocaleLowerCase("uk-UA").includes(normalized));
  }, [data, query, search]);

  const sortedData = useMemo(() => {
    if (!sortState) return filteredData;
    const column = columns.find((item) => item.key === sortState.columnKey);
    if (!column?.sortAccessor) return filteredData;

    return [...filteredData].sort((left, right) => {
      const leftValue = column.sortAccessor?.(left);
      const rightValue = column.sortAccessor?.(right);
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      return compareValues(leftValue, rightValue, sortState.direction);
    });
  }, [columns, filteredData, sortState]);

  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const paginatedData = useMemo(() => {
    const from = (page - 1) * pageSize;
    return sortedData.slice(from, from + pageSize);
  }, [page, pageSize, sortedData]);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize, data.length]);

  useEffect(() => {
    if (!sortableColumns.length) {
      setSortState(null);
      return;
    }
    if (sortState && sortableColumns.includes(sortState.columnKey)) {
      return;
    }
    setSortState({ columnKey: sortableColumns[0], direction: "asc" });
  }, [sortableColumns]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const toggleSort = (columnKey: string) => {
    if (!sortableColumns.includes(columnKey)) return;
    setSortState((current) => {
      if (!current || current.columnKey !== columnKey) {
        return { columnKey, direction: "asc" };
      }
      return { columnKey, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  };

  const emptyLabel = query && search?.emptyResultText ? search.emptyResultText : emptyText;

  return (
    <div className={clsx("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {search ? (
          <input
            className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={search.placeholder || "Пошук"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : (
          <div />
        )}
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-600">
            Записів: <span className="font-semibold text-ink">{sortedData.length}</span>
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            На сторінці
            <select
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {errorText && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">{errorText}</p>
          {onRetry && (
            <button
              type="button"
              className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700"
              onClick={onRetry}
            >
              {retryLabel}
            </button>
          )}
        </div>
      )}

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              {columns.map((column) => {
                const isSortable = sortableColumns.includes(column.key);
                const isActive = sortState?.columnKey === column.key;
                const direction = isActive ? sortState?.direction : null;
                return (
                  <th key={column.key} className={clsx("px-2 py-2", column.headerClassName)}>
                    {isSortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-ink"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.header}
                        <span className="text-[10px]">{direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕"}</span>
                      </button>
                    ) : (
                      <span className="font-semibold">{column.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-2 py-3 text-sm text-slate-600" colSpan={columns.length}>
                  Завантаження даних...
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-sm text-slate-600" colSpan={columns.length}>
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              paginatedData.map((row) => (
                <tr key={rowKey(row)} className={clsx("border-b border-slate-100", rowClassName?.(row))}>
                  {columns.map((column) => (
                    <td key={column.key} className={clsx("px-2 py-2", column.className)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600">
          Сторінка {page} з {pageCount}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || isLoading}
          >
            Попередня
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page >= pageCount || isLoading}
          >
            Наступна
          </button>
        </div>
      </div>
    </div>
  );
}
