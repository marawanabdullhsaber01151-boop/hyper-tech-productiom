import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { navigate } from "../app/router";
import { staffUser } from "../admin/session";
import { t, type CopyKey } from "../copy";
import { formatMoney } from "../lib/format";
import { Dialog, Input } from "../design/components";
import { emptyState, hasSalesPage, navHrefs, pageItems, pushRecent, readRecent, recordItems, salesItems, search, type CmdItem, type CustomerRow, type SaleRow } from "./commands";
import { isKnownStatus, type InvItem, type WorkflowOrder } from "./dashboardCore";
import { resolveHref, type NavResponse } from "./nav";
import { getShared } from "./sharedData";

/** فتح رابط من لوحة الأوامر: داخل التطبيق أو صفحة قديمة بتحميل كامل. */
export function openHref(href: string) {
  const r = resolveHref(href);
  if (r.kind === "spa") navigate(r.to);
  else location.assign(r.href);
}

/**
 * لوحة الأوامر (Ctrl+K): بحث واحد في صفحات القايمة والأوامر السريعة وأوامر الإنتاج والأصناف.
 * الصفحات والأوامر فورية. السجلات بتتحمّل أول مرة بس (من الكاش المشترك) وبحسب صلاحية الدور،
 * ومفيش نتيجة بتتعرض من غير صفحة في قايمة المستخدم تفتحها.
 */
export function CommandPalette({ open, onClose, nav, extra }: { open: boolean; onClose: () => void; nav: NavResponse | undefined; extra: CmdItem[] }) {
  const uid = staffUser()?.id ?? 0;
  const base = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readRecent(uid));
  const [records, setRecords] = useState<CmdItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const go = (href: string) => {
    onClose();
    openHref(href);
  };
  const hrefs = useMemo(() => navHrefs(nav), [nav]);
  const pages = useMemo(() => pageItems(nav, go), [nav]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setRecent(readRecent(uid));
    if (records !== null || loading || !nav) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      let can: Record<string, boolean> = {};
      try {
        can = (await getShared<{ can: Record<string, boolean> }>("/me/access", 300_000)).can ?? {};
      } catch {
        /* من غير صلاحيات معروفة: صفحات وأوامر بس */
      }
      const withSales = hasSalesPage(hrefs);
      const [o, i, s, c] = await Promise.allSettled([
        can.productionWorkflowRead ? getShared<WorkflowOrder[]>("/production-workflow") : Promise.resolve([] as WorkflowOrder[]),
        can.inventoryRead ? getShared<InvItem[]>("/inventory") : Promise.resolve([] as InvItem[]),
        withSales ? getShared<{ items?: SaleRow[] }>("/sales?page=1&page_size=100") : Promise.resolve({} as { items?: SaleRow[] }),
        withSales ? getShared<CustomerRow[]>("/contacts") : Promise.resolve([] as CustomerRow[]),
      ]);
      if (!alive) return;
      const sales = s.status === "fulfilled" && Array.isArray(s.value?.items) ? s.value.items : [];
      const customers = c.status === "fulfilled" && Array.isArray(c.value) ? c.value : [];
      const orders = o.status === "fulfilled" && Array.isArray(o.value) ? o.value : [];
      const items = i.status === "fulfilled" && Array.isArray(i.value) ? i.value : [];
      setRecords([
        ...salesItems(sales, customers, hrefs, go, {
          status: (st) => (/^(draft|pending_approval|confirmed|shipped|paid|cancelled)$/.test(st) ? t(`sales.status.${st}` as CopyKey) : st),
          money: (v) => formatMoney(Number(v) || 0),
        }),
        ...recordItems(orders, items, hrefs, go, {
          status: (st) => (isKnownStatus(st) ? t(`staff.dash.st.${st}` as CopyKey) : st),
          unit: (x) => x.unit ?? "",
        }),
      ]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all = useMemo(() => [...pages, ...extra, ...(records ?? [])], [pages, extra, records]);
  const results = useMemo(() => (query.trim() ? search(all, query, recent) : emptyState(all, recent)), [all, query, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`${base}-o${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const choose = (c: CmdItem | undefined) => {
    if (!c) return;
    setRecent(pushRecent(uid, c.id));
    c.run();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("staff.cmd.title")} size="md" initialFocus="[data-cmd-input]">
      <div class="st-cmd">
        <Input
          data-cmd-input=""
          role="combobox"
          aria-expanded="true"
          aria-controls={`${base}-list`}
          aria-activedescendant={results.length ? `${base}-o${active}` : undefined}
          aria-autocomplete="list"
          aria-label={t("staff.cmd.title")}
          placeholder={t("staff.cmd.placeholder")}
          value={query}
          autocomplete="off"
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={onKey}
        />
        <ul id={`${base}-list`} ref={listRef} role="listbox" aria-label={t("staff.cmd.listLabel")} class="st-cmd__list">
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${base}-o${i}`}
              role="option"
              aria-selected={i === active}
              class={`st-cmd__opt${i === active ? " st-cmd__opt--on" : ""}`}
              onMouseMove={() => active !== i && setActive(i)}
              onClick={() => choose(c)}
            >
              <span class="st-cmd__main">
                <span class="st-cmd__title">{c.title}</span>
                {c.hint ? <span class="st-cmd__hint">{c.hint}</span> : null}
              </span>
              <span class="st-cmd__kind">{!query.trim() && recent.includes(c.id) ? t("staff.cmd.recent") : t(`staff.cmd.kind.${c.kind}` as CopyKey)}</span>
            </li>
          ))}
        </ul>
        {query.trim() && results.length === 0 ? (
          <p class="st-cmd__note" role="status">
            {t("staff.cmd.empty", { q: query.trim() })}
            <span class="st-cmd__hint">{t("staff.cmd.emptyHint")}</span>
          </p>
        ) : null}
        {loading ? <p class="st-cmd__note" role="status">{t("staff.cmd.loading")}</p> : null}
        <p class="st-cmd__keys" aria-hidden="true">{t("staff.cmd.keys")}</p>
      </div>
    </Dialog>
  );
}
