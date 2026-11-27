import "../copy/eInvoice";
import { useEffect, useState } from "preact/hooks";
import { createApiClient } from "../api/client";
import { t, type CopyKey } from "../copy";
import { InlineAlert, Skeleton } from "../design/components";
import { formatDate, formatMoney } from "../lib/format";
import { VERIFY_STATES, type VerifyState } from "./invoiceCore";
import "./Verify.css";

interface Res { state: VerifyState; invoice?: { invoiceNumber: string; issueDate: string; total: string; taxAmount: string } }
const client = createApiClient();
const TONE: Record<VerifyState, "success" | "danger" | "warn"> = { valid: "success", tampered: "danger", wrong_token: "warn", unknown: "warn", unverifiable: "warn" };

/** صفحة التحقق العامة (من الـQR): من غير تسجيل دخول، بتوري الحكم وبيانات محدودة بس (الرقم والتاريخ والإجمالي). */
export function Verify() {
  const [res, setRes] = useState<Res | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const n = p.get("n") ?? "";
    const tok = p.get("t") ?? "";
    let alive = true;
    client.get<Res>("/public/invoices/verify", { query: { n, t: tok } }).then((r) => alive && setRes(r), () => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  const state = res && (VERIFY_STATES as readonly string[]).includes(res.state) ? res.state : null;
  return (
    <div class="ev-page">
      <h1 class="ev-title">{t("ei.v.title")}</h1>
      {failed ? <InlineAlert tone="danger">{t("ei.v.err")}</InlineAlert> : null}
      {!res && !failed ? <Skeleton lines={3} /> : null}
      {state ? <InlineAlert tone={TONE[state]}>{t(`ei.v.${state}` as CopyKey)}</InlineAlert> : null}
      {res?.state === "valid" && res.invoice ? (
        <dl class="ev-facts">
          <div><dt>{t("ei.v.number")}</dt><dd dir="ltr">{res.invoice.invoiceNumber}</dd></div>
          <div><dt>{t("ei.v.date")}</dt><dd>{formatDate(res.invoice.issueDate)}</dd></div>
          <div><dt>{t("ei.v.total")}</dt><dd>{formatMoney(Number(res.invoice.total))}</dd></div>
          {Number(res.invoice.taxAmount) > 0 ? <div><dt>{t("ei.v.vat")}</dt><dd>{formatMoney(Number(res.invoice.taxAmount))}</dd></div> : null}
        </dl>
      ) : null}
    </div>
  );
}
