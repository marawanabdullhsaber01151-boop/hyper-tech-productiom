import "../copy/eInvoice";
import { useState } from "preact/hooks";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, DataTable, EmptyState, Field, InlineAlert, Input, type Column } from "../design/components";
import { formatDate, formatMoney } from "../lib/format";
import { shortList, type Integrity, type InvoiceListRow } from "./invoiceCore";
import "./Engineering.css";

interface ListRes { items: InvoiceListRow[]; sealKeyConfigured: boolean }

/** نص نتيجة الفحص: سطر لكل نوع مشكلة. بيرجّع [] لو مفيش. */
export function integrityLines(r: Integrity): string[] {
  const out: string[] = [];
  if (r.gaps.missing.length) out.push(t("ei.check.missing", { list: shortList(r.gaps.missing) }));
  if (r.gaps.duplicates.length) out.push(t("ei.check.dup", { list: shortList(r.gaps.duplicates) }));
  if (r.gaps.malformed.length) out.push(t("ei.check.malformed", { list: shortList(r.gaps.malformed) }));
  if (r.badSeals.length) out.push(t("ei.check.seals", { list: shortList(r.badSeals) }));
  if (r.otherKey.length) out.push(t("ei.check.otherKey", { list: shortList(r.otherKey) }));
  return out;
}

/** تبويب «الفواتير» في الدفتر: كل الفواتير الصادرة + فحص السلامة (الترقيم والأختام). */
export function InvoicesPanel() {
  const [q, setQ] = useState("");
  const list = useQuery((signal) => api.get<ListRes>("/invoices", { signal, query: q.trim() ? { q: q.trim() } : undefined }), [q]);
  const [check, setCheck] = useState<Integrity | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setChecking(true);
    setFailed(false);
    try {
      setCheck(await api.get<Integrity>("/invoices/integrity"));
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };
  const cols: Column<InvoiceListRow>[] = [
    { key: "n", header: t("ei.c.number"), cell: (r) => <span class="num" dir="ltr">{r.invoiceNumber}</span>, mobile: "title" },
    { key: "o", header: t("ei.c.order"), cell: (r) => <span dir="ltr">{r.orderNumber}</span> },
    { key: "c", header: t("ei.c.customer"), cell: (r) => r.customerName },
    { key: "d", header: t("ei.c.date"), cell: (r) => formatDate(r.issueDate) },
    { key: "t", header: t("ei.c.total"), cell: (r) => formatMoney(Number(r.total)) },
    { key: "u", header: t("ei.c.by"), cell: (r) => r.issuedByName },
  ];
  const lines = check ? integrityLines(check) : [];
  return (
    <div class="ad-stack">
      <p class="eng-muted">{t("ei.hint")}</p>
      {list.data && !list.data.sealKeyConfigured ? <InlineAlert tone="warn">{t("ei.keyOff")}</InlineAlert> : null}
      <div>
        <Button variant="secondary" loading={checking} onClick={() => void run()}>{t("ei.check")}</Button>
      </div>
      {failed ? <InlineAlert tone="danger">{t("ei.check.err")}</InlineAlert> : null}
      {check && !failed ? (
        check.ok ? (
          <InlineAlert tone="success">{t("ei.check.ok", { n: check.total })}</InlineAlert>
        ) : (
          <InlineAlert tone="danger" title={check.keyConfigured ? t("ei.check.bad") : t("ei.check.noKey")}>
            {lines.length ? <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul> : null}
          </InlineAlert>
        )
      ) : null}
      <Field label={t("ei.search")}>
        <Input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </Field>
      {list.error ? <InlineAlert tone="danger">{t("ei.err")}</InlineAlert> : <DataTable columns={cols} rows={list.data?.items ?? []} rowKey={(r) => r.id} caption={t("ei.caption")} empty={<EmptyState compact title={t("ei.empty")} />} />}
    </div>
  );
}
