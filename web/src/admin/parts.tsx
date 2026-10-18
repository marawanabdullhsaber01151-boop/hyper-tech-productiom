import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Dialog, Field, Input, StatusPill, type Tone } from "../design/components";
import type { CompanyStatus, HealthLevel } from "./types";

const STATUS_TONE: Record<CompanyStatus, Tone> = { active: "success", not_activated: "info", suspended: "danger", archived: "neutral" };
const HEALTH_TONE: Record<HealthLevel, Tone> = { healthy: "success", new: "info", warning: "warn", critical: "danger" };

export const statusLabel = (s: CompanyStatus) => t(`a.status.${s}` as CopyKey);
export const StatusBadge = ({ status }: { status: CompanyStatus }) => <StatusPill tone={STATUS_TONE[status]}>{statusLabel(status)}</StatusPill>;
export const HealthBadge = ({ level, label }: { level: HealthLevel; label: string }) => <StatusPill tone={HEALTH_TONE[level]}>{label}</StatusPill>;

export const memberStatusTone = (s: string): Tone => (s === "active" ? "success" : s === "suspended" ? "danger" : s === "pending_approval" ? "warn" : "neutral");
export const memberStatusLabel = (s: string) => t(`a.mstatus.${s}` as CopyKey);

/** تأكيد بكتابة اسم الشركة — للإجراءات اللي ممكن توجع. */
export function TypeToConfirm({ open, onClose, onConfirm, title, description, phrase, confirmLabel, loading }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; description: string; phrase: string; confirmLabel: string; loading?: boolean }) {
  const [v, setV] = useState("");
  const ok = v.trim() === phrase.trim();
  const close = () => {
    setV("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={!ok} loading={loading} onClick={async () => { await onConfirm(); setV(""); }}>{confirmLabel}</Button>
        </>
      }
    >
      <Field label={t("a.typeToConfirm", { phrase })}>
        <Input value={v} onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)} autoComplete="off" />
      </Field>
    </Dialog>
  );
}

export function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="ad-kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
