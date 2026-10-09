import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../../copy";
import { formatNumber } from "../../lib/format";
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListFilter, Search, X } from "../icons";
import { Button, IconButton } from "./Button";
import { Drawer } from "./Overlays";
import { EmptyState, Skeleton } from "./Display";
import { Icon } from "./Icon";
import { Input } from "./Inputs";
import { cx } from "./util";

/* ---------- media query hook ---------- */
export function useMediaQuery(q: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    h();
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, [q]);
  return m;
}

/* ---------- DataTable ---------- */
export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ComponentChildren;
  sortable?: boolean;
  /** في الكروت (موبايل): "title" بيبقى عنوان الكارت، "hide" مخفي. */
  mobile?: "title" | "hide";
  align?: "start" | "end" | "center";
  numeric?: boolean;
}
export type SortState = { key: string; dir: "asc" | "desc" } | null;

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string | number;
  caption: string;
  loading?: boolean;
  empty?: ComponentChildren;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  onRowClick?: (r: T) => void;
  rowActions?: (r: T) => ComponentChildren;
}

export function DataTable<T>({ columns, rows, rowKey, caption, loading, empty, sort, onSort, onRowClick, rowActions }: DataTableProps<T>) {
  const narrow = useMediaQuery("(max-width: 767px)");

  if (loading && !rows.length) {
    return (
      <div class="ht-table-skel" aria-busy="true" aria-label={t("common.loading")}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height={44} radius="var(--r-sm)" />
        ))}
      </div>
    );
  }
  if (!rows.length) return <>{empty ?? <EmptyState title={t("table.empty")} />}</>;

  const toggleSort = (c: Column<T>) => {
    if (!c.sortable || !onSort) return;
    onSort(!sort || sort.key !== c.key ? { key: c.key, dir: "asc" } : sort.dir === "asc" ? { key: c.key, dir: "desc" } : null);
  };

  if (narrow) {
    const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0]!;
    const rest = columns.filter((c) => c !== titleCol && c.mobile !== "hide");
    return (
      <ul class="ht-cards" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} class={cx("ht-rowcard", onRowClick && "is-click")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            <div class="ht-rowcard__head">
              <div class="ht-rowcard__title">{titleCol.cell(r)}</div>
              {rowActions ? <div onClick={(e: Event) => e.stopPropagation()}>{rowActions(r)}</div> : null}
            </div>
            <dl class="ht-rowcard__list">
              {rest.map((c) => (
                <div key={c.key} class="ht-rowcard__item">
                  <dt>{c.header}</dt>
                  <dd>{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div class="ht-tablewrap" tabIndex={0} role="region" aria-label={caption}>
      <table class="ht-table">
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" class={cx(c.align && `is-${c.align}`, c.numeric && "is-num")} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined}>
                  {c.sortable ? (
                    <button type="button" class="ht-table__sort" onClick={() => toggleSort(c)} title={t("table.sort", { name: c.header })}>
                      {c.header}
                      <Icon icon={active ? (sort!.dir === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown} size={14} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {rowActions ? <th scope="col" class="is-end"><span class="sr-only">{t("common.actions")}</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} class={cx(onRowClick && "is-click")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} class={cx(c.align && `is-${c.align}`, c.numeric && "is-num num")}>
                  {c.cell(r)}
                </td>
              ))}
              {rowActions ? (
                <td class="is-end" onClick={(e: Event) => e.stopPropagation()}>
                  {rowActions(r)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Pagination ---------- */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav class="ht-pager" aria-label={t("pager.label")}>
      <span class="ht-pager__info num">{t("table.rowsOf", { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}</span>
      <div class="ht-pager__btns">
        <IconButton icon={ChevronRight} label={t("table.prev")} variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span class="ht-pager__page num" aria-current="page">
          {t("table.page", { n: formatNumber(page) })}
        </span>
        <IconButton icon={ChevronLeft} label={t("table.next")} variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

/* ---------- FilterBar ---------- */
export function FilterBar({ search, onSearch, searchLabel = t("common.search"), activeCount = 0, onClear, children }: { search?: string; onSearch?: (v: string) => void; searchLabel?: string; activeCount?: number; onClear?: () => void; children?: ComponentChildren }) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(search ?? "");
  useEffect(() => setLocal(search ?? ""), [search]);
  // debounce 300ms
  useEffect(() => {
    if (!onSearch || local === (search ?? "")) return;
    const id = setTimeout(() => onSearch(local), 300);
    return () => clearTimeout(id);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = activeCount > 0 && onClear ? (
    <Button variant="ghost" size="sm" icon={X} onClick={onClear}>
      {t("common.clearFilters")}
    </Button>
  ) : null;

  return (
    <div class="ht-filterbar" role="search">
      {onSearch ? (
        <span class="ht-affix ht-affix--lead ht-filterbar__search">
          <span class="ht-affix__tag" aria-hidden="true">
            <Icon icon={Search} size={18} />
          </span>
          <Input type="search" aria-label={searchLabel} placeholder={searchLabel} value={local} onInput={(e) => setLocal((e.currentTarget as HTMLInputElement).value)} />
        </span>
      ) : null}
      {children ? (
        narrow ? (
          <>
            <Button variant="secondary" icon={ListFilter} onClick={() => setOpen(true)}>
              {t("common.filters")}
              {activeCount ? ` (${formatNumber(activeCount)})` : ""}
            </Button>
            <Drawer open={open} onClose={() => setOpen(false)} title={t("common.filters")} footer={<><Button variant="ghost" onClick={() => onClear?.()}>{t("common.clearFilters")}</Button><Button onClick={() => setOpen(false)}>{t("common.done")}</Button></>}>
              <div class="ht-filterbar__stack">{children}</div>
            </Drawer>
          </>
        ) : (
          <div class="ht-filterbar__group">
            {children}
            {clear}
          </div>
        )
      ) : (
        clear
      )}
    </div>
  );
}
