import "../copy/eInvoice";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { t } from "../copy";
import { Button, ConfirmDialog, InlineAlert, StatusPill, useToast } from "../design/components";
import { Printer } from "../design/icons";
import { formatDate } from "../lib/format";
import { FINANCE_PAGE_ROLES } from "./staffRoles";
import type { Invoice } from "./invoiceCore";
import { printOfficialInvoice } from "./invoicePrint";

export interface InvoiceInfo { invoice: Invoice | null; sealKeyConfigured: boolean }

/** صندوق «الفاتورة الرسمية» في تفاصيل أمر البيع: إصدار (للإدارة) أو عرض وطباعة. */
export function InvoiceBox({ orderId, orderNumber, role, info, onIssued }: { orderId: number; orderNumber: string; role: string; info: InvoiceInfo; onIssued: () => void }) {
  const act = useAct();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const canIssue = (FINANCE_PAGE_ROLES as readonly string[]).includes(role);
  const inv = info.invoice;

  const issue = async () => {
    const r = await act.run(() => api.post<Invoice>(`/sales/${orderId}/invoice`, {}));
    if (!r) return;
    toast({ tone: "success", message: t("ei.issued", { n: r.invoiceNumber }) });
    setConfirm(false);
    onIssued();
  };
  const print = async () => {
    if (inv && !(await printOfficialInvoice(inv))) toast({ tone: "warn", message: t("ei.print.blocked") });
  };

  return (
    <section class="sales-invoice" aria-label={t("ei.box.title")}>
      <h3 class="sales-h">{t("ei.box.title")}</h3>
      {inv ? (
        <>
          <dl class="sales-facts">
            <div><dt>{t("ei.number")}</dt><dd dir="ltr">{inv.invoiceNumber}</dd></div>
            <div><dt>{t("ei.date")}</dt><dd>{formatDate(inv.issueDate)}</dd></div>
          </dl>
          <div class="sales-detail__pills"><StatusPill tone="success">{t("ei.sealed")}</StatusPill></div>
          <InlineAlert tone="info">{t("ei.locked")}</InlineAlert>
          <Button variant="secondary" icon={Printer} onClick={() => void print()}>{t("ei.print")}</Button>
        </>
      ) : (
        <>
          <p class="sales-muted">{canIssue ? t("ei.none") : t("ei.noneSales")}</p>
          {canIssue && !info.sealKeyConfigured ? <InlineAlert tone="warn">{t("ei.keyMissing")}</InlineAlert> : null}
          {canIssue ? <Button variant="secondary" disabled={!info.sealKeyConfigured} onClick={() => setConfirm(true)}>{t("ei.issue")}</Button> : null}
        </>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={issue} loading={act.busy} title={t("ei.issue.title", { n: orderNumber })} description={t("ei.issue.desc")} confirmLabel={t("ei.issue")} />
    </section>
  );
}
