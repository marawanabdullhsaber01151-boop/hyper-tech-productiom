import { useMemo, useState } from "preact/hooks";
import { t } from "../../copy";
import { Button, Column, DataTable, Dialog, EmptyState, Field, InlineAlert, Input } from "../../design/components";
import type { QueryState } from "../../api/hooks";
import { formatMoney, formatNumber, formatRelative } from "../../lib/format";
import { api } from "../api";
import { useAct } from "../act";
import type { PriceInquiryRow } from "../types";

/** السعر لازم يبقى رقم موجب بحد أقصى خانتين عشريتين (نفس قاعدة السيرفر). فاضي = قبول المقترح. */
export const PRICE_PATTERN = /^[0-9]{1,10}(?:\.[0-9]{1,2})?$/;

/** بيفلتر بالاسم أو الشركة أو المنتج أو التليفون. */
export function matchInquiry(r: PriceInquiryRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${r.customerName} ${r.customerCompany ?? ""} ${r.customerPhone} ${r.productName}`.toLowerCase().includes(s);
}

/** طلبات الأسعار: العميل بيسأل عن سعر منتج وكمية، والمبيعات بترد بالسعر المقترح أو بسعر معدّل. */
export function PriceInquiries({ list, search }: { list: QueryState<PriceInquiryRow[]>; search: string }) {
  const { run, busy } = useAct();
  const [target, setTarget] = useState<PriceInquiryRow | null>(null);
  const [price, setPrice] = useState("");

  const rows = useMemo(() => (list.data ?? []).filter((r) => matchInquiry(r, search)), [list.data, search]);
  const priceOk = price.trim() === "" ? target?.suggestedPrice != null : PRICE_PATTERN.test(price.trim());

  const close = () => {
    setTarget(null);
    setPrice("");
  };
  const send = async () => {
    if (!target) return;
    const body = price.trim() === "" ? {} : { finalPrice: price.trim() };
    const res = await run(() => api.post(`/price-inquiries/${target.id}/answer`, body), t("a.pi.answer.done"));
    if (res !== undefined) {
      close();
      await list.refetch();
    }
  };

  const columns: Column<PriceInquiryRow>[] = useMemo(
    () => [
      { key: "customer", header: t("a.pi.col.customer"), mobile: "title", cell: (r) => (
        <div>
          <strong>{r.customerName}</strong>
          {r.customerCompany ? <div class="ad-muted">{r.customerCompany}</div> : null}
          <div class="ad-muted"><bdi dir="ltr">{r.customerPhone}</bdi></div>
        </div>
      ) },
      { key: "product", header: t("a.pi.col.product"), cell: (r) => r.productName },
      { key: "qty", header: t("a.pi.col.qty"), numeric: true, cell: (r) => t("a.pi.qty", { n: formatNumber(Number(r.requestedQty)) }) },
      { key: "suggested", header: t("a.pi.col.suggested"), numeric: true, cell: (r) => (r.suggestedPrice != null ? formatMoney(Number(r.suggestedPrice)) : <span class="ad-muted">{t("a.pi.noSuggested")}</span>) },
      { key: "sales", header: t("a.pi.col.sales"), mobile: "hide", cell: (r) => r.assignedSales?.name ?? <span class="ad-muted">{t("a.col.salesNone")}</span> },
      { key: "age", header: t("a.pi.col.age"), mobile: "hide", cell: (r) => formatRelative(r.createdAt) },
    ],
    [],
  );

  return (
    <>
      {list.error ? (
        <InlineAlert tone="danger" title={t("a.pi.err")} action={<Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>}>
          {list.error.message}
        </InlineAlert>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption={t("a.pi.caption")}
        loading={list.loading}
        rowActions={(r) => <Button size="sm" onClick={() => { setPrice(""); setTarget(r); }}>{t("a.pi.answer")}</Button>}
        empty={<EmptyState title={search ? t("a.pi.empty.filtered") : t("a.pi.empty")} />}
      />
      <Dialog
        open={!!target}
        onClose={close}
        title={t("a.pi.answer.title")}
        description={target ? t("a.pi.answer.about", { customer: target.customerName, product: target.productName, qty: formatNumber(Number(target.requestedQty)) }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={close}>{t("common.cancel")}</Button>
            <Button loading={busy} disabled={!priceOk} onClick={() => void send()}>{t("a.pi.answer.send")}</Button>
          </>
        }
      >
        <Field label={t("a.pi.answer.price")} hint={target?.suggestedPrice != null ? t("a.pi.answer.hintSuggested", { price: formatMoney(Number(target.suggestedPrice)) }) : t("a.pi.answer.hintNone")} error={price.trim() !== "" && !PRICE_PATTERN.test(price.trim()) ? t("a.pi.answer.invalid") : undefined}>
          <Input inputMode="decimal" dir="ltr" value={price} onInput={(e) => setPrice((e.currentTarget as HTMLInputElement).value)} />
        </Field>
      </Dialog>
    </>
  );
}
