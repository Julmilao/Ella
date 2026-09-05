import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Filter, Search, X } from "lucide-react";

export interface ColumnDef<T> {
  key: keyof T | string;
  header: React.ReactNode;
  width?: number;
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
  filterable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  skeletonRows?: number;
  selectable?: boolean;
  canSelect?: (row: T, index: number) => boolean;
  selectedRows?: Set<number>;
  onSelectionChange?: (indices: Set<number>, rows: T[]) => void;
  onRowDoubleClick?: (row: T, index: number) => void;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

type IndexedRow<T> = {
  row: T;
  originalIndex: number;
};

function toSet(value?: Set<number>) {
  return value ? new Set(value) : new Set<number>();
}

function getInitialWidths<T>(columns: ColumnDef<T>[]) {
  const initial: Record<string, number> = {};

  (columns ?? []).forEach((column) => {
    if (!column) return;
    if (column.width !== undefined) {
      initial[String(column.key)] = column.width;
    }
  });

  return initial;
}

function getCellValue<T>(row: T, key: string) {
  return String((row as Record<string, unknown>)[key] ?? "");
}

function getHeaderLabel(header: React.ReactNode, fallback: string) {
  if (typeof header === "string" || typeof header === "number") {
    return String(header);
  }

  return fallback;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  skeletonRows = 5,
  selectable = false,
  canSelect,
  selectedRows,
  onSelectionChange,
  onRowDoubleClick,
  emptyMessage = "Nenhum registro encontrado.",
  emptyAction,
  footer,
  className,
}: DataTableProps<T>) {
  const [colWidths, setColWidths] = React.useState<Record<string, number>>(() => getInitialWidths(columns));
  const [columnFilters, setColumnFilters] = React.useState<Record<string, Set<string>>>({});
  const [draftColumnFilters, setDraftColumnFilters] = React.useState<Record<string, Set<string>>>({});
  const [filterSearch, setFilterSearch] = React.useState<Record<string, string>>({});
  const [openFilterKey, setOpenFilterKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    setColWidths((prev) => {
      const next: Record<string, number> = {};

      (columns ?? []).forEach((column) => {
        if (!column) return;
        const key = String(column.key);

        if (prev[key] !== undefined) {
          next[key] = prev[key];
          return;
        }

        if (column.width !== undefined) {
          next[key] = column.width;
        }
      });

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const sameShape =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key]);

      return sameShape ? prev : next;
    });
  }, [columns]);

  const resizeRef = React.useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const safeColumns = React.useMemo(
    () => (columns ?? []).filter(Boolean) as ColumnDef<T>[],
    [columns],
  );

  const columnMap = React.useMemo(
    () => new Map(safeColumns.map((column) => [String(column.key), column])),
    [safeColumns],
  );

  const filterableColumns = React.useMemo(
    () =>
      safeColumns.filter((column) => {
        const key = String(column.key).trim();
        return column.filterable !== false && key.length > 0;
      }),
    [safeColumns],
  );

  const indexedData = React.useMemo<IndexedRow<T>[]>(
    () => data.map((row, originalIndex) => ({ row, originalIndex })),
    [data],
  );

  const uniqueValues = React.useMemo(() => {
    const result: Record<string, string[]> = {};

    filterableColumns.forEach((column) => {
      const key = String(column.key);
      result[key] = [...new Set(indexedData.map(({ row }) => getCellValue(row, key)))].sort((a, b) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
      );
    });

    return result;
  }, [filterableColumns, indexedData]);

  const filteredRows = React.useMemo(
    () =>
      indexedData.filter(({ row }) =>
        Object.entries(columnFilters).every(([key, selectedValues]) =>
          selectedValues.has(getCellValue(row, key)),
        ),
      ),
    [columnFilters, indexedData],
  );

  const isRowSelectable = React.useCallback(
    (row: T, index: number) => (canSelect ? canSelect(row, index) : true),
    [canSelect],
  );

  const eligibleRows = React.useMemo(
    () =>
      filteredRows.filter(({ row, originalIndex }) =>
        isRowSelectable(row, originalIndex),
      ),
    [filteredRows, isRowSelectable],
  );

  const allSelected =
    selectable &&
    eligibleRows.length > 0 &&
    eligibleRows.every(({ originalIndex }) => selectedRows?.has(originalIndex));

  const someSelected =
    selectable &&
    eligibleRows.some(({ originalIndex }) => selectedRows?.has(originalIndex)) &&
    !allSelected;

  const activeFilterKeys = Object.keys(columnFilters);
  const activeFiltersCount = activeFilterKeys.length;

  const onResizeMouseDown = React.useCallback(
    (event: React.MouseEvent, key: string) => {
      event.preventDefault();
      event.stopPropagation();

      const currentWidth = colWidths[key] ?? 120;
      resizeRef.current = { key, startX: event.clientX, startWidth: currentWidth };

      const onMove = (moveEvent: MouseEvent) => {
        if (!resizeRef.current) return;

        const delta = moveEvent.clientX - resizeRef.current.startX;
        const nextWidth = Math.max(60, resizeRef.current.startWidth + delta);

        setColWidths((prev) => ({ ...prev, [resizeRef.current!.key]: nextWidth }));
      };

      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [colWidths],
  );

  const clearColumnFilter = React.useCallback((key: string) => {
    setColumnFilters((prev) => {
      if (!(key in prev)) return prev;

      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const clearAllFilters = React.useCallback(() => {
    setColumnFilters({});
  }, []);

  const discardDraftFilter = React.useCallback((key: string) => {
    setDraftColumnFilters((prev) => {
      if (!(key in prev)) return prev;

      const next = { ...prev };
      delete next[key];
      return next;
    });

    setFilterSearch((prev) => {
      if (!(key in prev)) return prev;

      const next = { ...prev };
      delete next[key];
      return next;
    });

    setOpenFilterKey((prev) => (prev === key ? null : prev));
  }, []);

  const openDraftFilter = React.useCallback(
    (key: string) => {
      setDraftColumnFilters({
        [key]: new Set(columnFilters[key] ?? uniqueValues[key] ?? []),
      });
      setFilterSearch({ [key]: "" });
      setOpenFilterKey(key);
    },
    [columnFilters, uniqueValues],
  );

  const handleFilterOpenChange = React.useCallback(
    (key: string, open: boolean) => {
      if (open) {
        openDraftFilter(key);
        return;
      }

      discardDraftFilter(key);
    },
    [discardDraftFilter, openDraftFilter],
  );

  const selectAllDraftValues = React.useCallback(
    (key: string) => {
      setDraftColumnFilters((prev) => ({
        ...prev,
        [key]: new Set(uniqueValues[key] ?? []),
      }));
    },
    [uniqueValues],
  );

  const clearDraftValues = React.useCallback((key: string) => {
    setDraftColumnFilters((prev) => ({
      ...prev,
      [key]: new Set<string>(),
    }));
  }, []);

  const toggleDraftFilterValue = React.useCallback(
    (key: string, value: string) => {
      setDraftColumnFilters((prev) => {
        const currentValues = prev[key] ? new Set(prev[key]) : new Set(uniqueValues[key] ?? []);

        if (currentValues.has(value)) currentValues.delete(value);
        else currentValues.add(value);

        return { ...prev, [key]: currentValues };
      });
    },
    [uniqueValues],
  );

  const applyDraftFilter = React.useCallback(
    (key: string) => {
      setColumnFilters((prev) => {
        const totalValues = uniqueValues[key] ?? [];
        const draftValues = new Set(draftColumnFilters[key] ?? totalValues);

        if (draftValues.size === totalValues.length) {
          if (!(key in prev)) return prev;

          const next = { ...prev };
          delete next[key];
          return next;
        }

        return { ...prev, [key]: draftValues };
      });

      discardDraftFilter(key);
    },
    [discardDraftFilter, draftColumnFilters, uniqueValues],
  );

  const isColumnFiltered = React.useCallback((key: string) => key in columnFilters, [columnFilters]);

  const emitSelection = React.useCallback(
    (next: Set<number>) => {
      onSelectionChange?.(next, data.filter((_, index) => next.has(index)));
    },
    [data, onSelectionChange],
  );

  const toggleRow = React.useCallback(
    (index: number) => {
      const next = toSet(selectedRows);

      if (next.has(index)) next.delete(index);
      else next.add(index);

      emitSelection(next);
    },
    [emitSelection, selectedRows],
  );

  const toggleAll = React.useCallback(
    (checked: boolean) => {
      const next = toSet(selectedRows);

      eligibleRows.forEach(({ originalIndex }) => {
        if (checked) next.add(originalIndex);
        else next.delete(originalIndex);
      });

      emitSelection(next);
    },
    [eligibleRows, emitSelection, selectedRows],
  );

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      {activeFiltersCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground">
          <Filter className="h-3 w-3 shrink-0 text-primary" />
          <span className="font-medium text-primary">
            {activeFiltersCount} filtro{activeFiltersCount > 1 ? "s" : ""} ativo
            {activeFiltersCount > 1 ? "s" : ""}
          </span>

          {activeFilterKeys.map((key) => {
            const values = columnFilters[key];
            const valuesList = [...values];
            const preview = valuesList.slice(0, 2).join(", ");
            const remaining = valuesList.length > 2 ? ` +${valuesList.length - 2}` : "";

            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-medium text-primary"
              >
                {getHeaderLabel(columnMap.get(key)?.header, key)}: {preview || "nenhum valor"}
                {remaining}
                <button
                  type="button"
                  onClick={() => clearColumnFilter(key)}
                  className="ml-0.5 transition-colors hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}

          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-auto transition-colors hover:text-destructive"
          >
            Limpar todos
          </button>
        </div>
      )}

      <Table
        style={{
          tableLayout: "fixed",
          width: "max-content",
          minWidth: "100%",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <TableHeader>
          <TableRow className="border-b-2 border-border hover:bg-transparent">
            {selectable && (
              <TableHead className="relative w-12 border-r border-border bg-muted/30 px-3">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) => toggleAll(Boolean(checked))}
                  aria-label="Selecionar todas as linhas"
                />
              </TableHead>
            )}

            {safeColumns.map((column, columnIndex) => {
              const key = String(column.key);
              const width = colWidths[key] ?? column.width ?? 120;
              const canFilter = column.filterable !== false && key.trim().length > 0;
              const isFiltered = isColumnFiltered(key);
              const values = uniqueValues[key] ?? [];
              const search = filterSearch[key] ?? "";
              const visibleValues = search
                ? values.filter((value) =>
                    value.toLowerCase().includes(search.toLowerCase()),
                  )
                : values;
              const draftValues = draftColumnFilters[key] ?? new Set(values);
              const isLast = columnIndex === safeColumns.length - 1;

              return (
                <TableHead
                  key={key}
                  className={cn(
                    "relative select-none bg-muted/30 pr-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    !isLast && "border-r border-border",
                    column.className,
                  )}
                  style={{ width, minWidth: 60 }}
                >
                  <div className="flex items-center gap-1 pr-5">
                    <span className="flex-1 truncate">{column.header}</span>

                    {canFilter && (
                      <Popover
                        open={openFilterKey === key}
                        onOpenChange={(open) => handleFilterOpenChange(key, open)}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                              isFiltered
                                ? "bg-primary/15 text-primary hover:bg-primary/25"
                                : "text-muted-foreground/50 hover:bg-muted/60 hover:text-muted-foreground",
                            )}
                            title={`Filtrar por ${getHeaderLabel(column.header, key)}`}
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <Filter className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>

                        <PopoverContent
                          className="w-64 p-0 shadow-lg"
                          align="start"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                        >
                          <div className="border-b border-border p-2">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {column.header}
                              </span>
                            </div>

                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                              <input
                                value={search}
                                onChange={(event) =>
                                  setFilterSearch((prev) => ({
                                    ...prev,
                                    [key]: event.target.value,
                                  }))
                                }
                                placeholder="Pesquisar valor..."
                                className="w-full rounded-md border border-border bg-background py-1.5 pl-6 pr-2 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                              />
                            </div>

                            <div className="mt-1.5 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => selectAllDraftValues(key)}
                                className="text-[10px] text-primary hover:underline"
                              >
                                Selecionar tudo
                              </button>
                              <span className="text-muted-foreground/40">|</span>
                              <button
                                type="button"
                                onClick={() => clearDraftValues(key)}
                                className="text-[10px] text-muted-foreground hover:underline"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>

                          <div className="max-h-52 overflow-y-auto py-1">
                            {visibleValues.length === 0 ? (
                              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                                Nenhum valor encontrado
                              </p>
                            ) : (
                              visibleValues.map((value) => {
                                const checked = draftValues.has(value);

                                return (
                                  <label
                                    key={value}
                                    className="group flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/50"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleDraftFilterValue(key, value)}
                                      className="h-3.5 w-3.5"
                                    />
                                    <span className="flex-1 truncate text-xs text-foreground">
                                      {value || (
                                        <span className="italic text-muted-foreground">
                                          (vazio)
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                );
                              })
                            )}
                          </div>

                          <div className="flex items-center justify-end gap-2 border-t border-border p-2">
                            {isFiltered && (
                              <button
                                type="button"
                                onClick={() => {
                                  clearColumnFilter(key);
                                  discardDraftFilter(key);
                                }}
                                className="mr-auto text-[10px] text-destructive hover:underline"
                              >
                                Remover filtro
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => discardDraftFilter(key)}
                              className="rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                            >
                              Cancelar
                            </button>

                            <button
                              type="button"
                              onClick={() => applyDraftFilter(key)}
                              className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              OK
                            </button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  <div
                    onMouseDown={(event) => onResizeMouseDown(event, key)}
                    className="group absolute right-0 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center"
                    title="Arrastar para redimensionar"
                  >
                    <div className="h-4 w-[2px] rounded-full bg-border transition-colors group-hover:bg-primary" />
                  </div>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, rowIndex) => (
              <TableRow key={`skeleton-${rowIndex}`} className="border-b border-border">
                {selectable && (
                  <TableCell className="border-r border-border px-3">
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                )}

                {safeColumns.map((column, columnIndex) => (
                  <TableCell
                    key={`${String(column.key)}-${rowIndex}`}
                    className={cn(
                      columnIndex < safeColumns.length - 1 && "border-r border-border",
                    )}
                  >
                    <Skeleton className="h-4 w-full max-w-[180px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}

          {!loading && filteredRows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={safeColumns.length + (selectable ? 1 : 0)}
                className="px-6 py-10 text-center"
              >
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm text-muted-foreground">{emptyMessage}</span>
                  {emptyAction}
                </div>
              </TableCell>
            </TableRow>
          )}

          {!loading &&
            filteredRows.map(({ row, originalIndex }) => {
              const rowSelectable = selectable && isRowSelectable(row, originalIndex);
              const checked = selectedRows?.has(originalIndex) ?? false;

              return (
                <TableRow
                  key={`row-${originalIndex}`}
                  data-state={checked ? "selected" : undefined}
                  className={cn(
                    "border-b border-border",
                    onRowDoubleClick && "cursor-pointer",
                    selectable && rowSelectable && "cursor-pointer",
                    selectable && !rowSelectable && "opacity-60",
                  )}
                  onDoubleClick={() => onRowDoubleClick?.(row, originalIndex)}
                  onClick={() => {
                    if (selectable && rowSelectable) toggleRow(originalIndex);
                  }}
                >
                  {selectable && (
                    <TableCell
                      className="border-r border-border px-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!rowSelectable}
                        onCheckedChange={() => toggleRow(originalIndex)}
                        aria-label={`Selecionar linha ${originalIndex + 1}`}
                      />
                    </TableCell>
                  )}

                  {safeColumns.map((column, columnIndex) => {
                    const key = String(column.key);
                    const width = colWidths[key] ?? column.width ?? 120;
                    const value = (row as Record<string, unknown>)[key];

                    return (
                      <TableCell
                        key={`${key}-${originalIndex}`}
                        className={cn(
                          "overflow-hidden text-sm",
                          columnIndex < safeColumns.length - 1 && "border-r border-border",
                          column.className,
                        )}
                        style={{ width, maxWidth: width }}
                      >
                        <div className="truncate">
                          {column.render ? column.render(value, row, originalIndex) : String(value ?? "")}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
        </TableBody>

        {footer && (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={safeColumns.length + (selectable ? 1 : 0)}>
                {footer}
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
