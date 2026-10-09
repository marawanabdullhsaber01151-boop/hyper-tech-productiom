import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../../copy";
import { copyText } from "../../lib/clipboard";
import { formatCompanyCode, formatPartialCode, normalizeCompanyCode } from "../../lib/companyCode";
import { whatsappLink } from "../../lib/phone";
import { qrSvg } from "../../lib/qr";
import { Check, Copy, MessageCircle, QrCode } from "../icons";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { useFieldCtx } from "./Field";
import { cx } from "./util";

/** لوحة معدن محفور (nameplate) تعرض قيمة وتنسخها بضغطة. للأكواد والروابط. */
export function CopyField({ value, label, mono = true, ltr = true, class: cls }: { value: string; label: string; mono?: boolean; ltr?: boolean; class?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const doCopy = async () => {
    const ok = await copyText(value);
    setState(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  };
  return (
    <div class={cx("ht-plate", cls)}>
      <span class="ht-plate__label">{label}</span>
      <div class="ht-plate__row">
        <output class={cx("ht-plate__value", mono && "is-mono")} dir={ltr ? "ltr" : undefined} aria-label={label} onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>
          {value}
        </output>
        <Button variant="secondary" size="sm" icon={state === "ok" ? Check : Copy} onClick={doCopy}>
          {state === "ok" ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      <span class="sr-only" role="status" aria-live="polite">
        {state === "ok" ? t("common.copied") : state === "fail" ? t("common.copyFailed") : ""}
      </span>
      {state === "fail" ? <span class="ht-plate__fail">{t("common.copyFailed")}</span> : null}
    </div>
  );
}

export interface ShareLinkCardProps {
  url: string;
  title: string;
  /** لو متبعت: زر واتساب بنص جاهز. */
  whatsappPhone?: string;
  whatsappText?: string;
  qr?: boolean;
}

export function ShareLinkCard({ url, title, whatsappPhone, whatsappText, qr = true }: ShareLinkCardProps) {
  const [showQr, setShowQr] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!showQr || svg) return;
    let alive = true;
    qrSvg(url).then((s) => alive && setSvg(s)).catch(() => alive && setShowQr(false));
    return () => {
      alive = false;
    };
  }, [showQr, svg, url]);
  const wa = whatsappPhone ? whatsappLink(whatsappPhone, whatsappText ?? url) : null;
  return (
    <div class="ht-share">
      <h3 class="ht-share__title">{title}</h3>
      <CopyField value={url} label={t("share.link")} />
      <div class="ht-share__actions">
        {qr ? (
          <Button variant="ghost" size="sm" icon={QrCode} onClick={() => setShowQr((s) => !s)} aria-expanded={showQr}>
            {showQr ? t("share.hideQr") : t("share.showQr")}
          </Button>
        ) : null}
        {wa ? (
          <a class="ht-btn ht-btn--ghost ht-btn--sm" href={wa} target="_blank" rel="noopener noreferrer">
            <Icon icon={MessageCircle} size={18} />
            <span class="ht-btn__label">{t("share.whatsapp")}</span>
          </a>
        ) : null}
      </div>
      {showQr && svg ? <div class="ht-share__qr" role="img" aria-label={t("share.qrAlt")} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
    </div>
  );
}

/**
 * إدخال كود الشركة HT-XXXX-XXXX: خانة واحدة بتنسّق وإنت بتكتب، بتقبل اللصق،
 * وبتتأكد من حرف الفحص (بدون ما تكلّم السيرفر).
 */
export function CodeInput({ value, onChange, onComplete, invalid, id, disabled }: { value: string; onChange: (formatted: string, raw: string | null) => void; onComplete?: (raw: string) => void; invalid?: boolean; id?: string; disabled?: boolean }) {
  const f = useFieldCtx();
  const handle = (txt: string) => {
    const formatted = formatPartialCode(txt);
    const raw = normalizeCompanyCode(formatted);
    onChange(formatted, raw);
    if (raw) onComplete?.(raw);
  };
  const bad = (invalid ?? f?.invalid) || (value.replace(/[^0-9A-Z]/g, "").length >= 10 && !normalizeCompanyCode(value));
  return (
    <input
      id={id ?? f?.id}
      aria-describedby={f?.describedBy}
      aria-invalid={bad ? "true" : undefined}
      disabled={disabled ?? f?.disabled}
      class={cx("ht-control ht-control--code", bad && "is-bad")}
      dir="ltr"
      inputMode="text"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck={false}
      maxLength={12}
      placeholder="HT-XXXX-XXXX"
      value={value}
      onInput={(e) => handle((e.currentTarget as HTMLInputElement).value)}
      onPaste={(e) => {
        const txt = e.clipboardData?.getData("text");
        if (txt) {
          e.preventDefault();
          handle(txt);
        }
      }}
    />
  );
}

export { formatCompanyCode };
