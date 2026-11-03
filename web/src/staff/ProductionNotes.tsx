import "../copy/production";
import { useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, Field, InlineAlert, Select, StatusPill, Textarea } from "../design/components";
import { formatDateTime } from "../lib/format";
import { NOTE_KINDS, canWriteNotes, noteError, notePayload, noteTone, type OrderNote } from "./oversightCore";

const val = (e: Event) => (e.target as HTMLInputElement).value;
const k = (key: string) => key as CopyKey;

/** ملاحظات المشرف على أمر إنتاج: سجل إضافة فقط، الأحدث الأول. */
export function OrderNotes({ orderId, role }: { orderId: number; role: string }) {
  const q = useQuery((signal) => api.get<OrderNote[]>(`/production-oversight/orders/${orderId}/notes`, { signal }), [orderId]);
  const act = useAct();
  const [kind, setKind] = useState("observation");
  const [body, setBody] = useState("");
  const rows = Array.isArray(q.data) ? q.data : [];
  const add = async () => {
    const ok = await act.run(async () => { await api.post<unknown>(`/production-oversight/orders/${orderId}/notes`, notePayload(kind, body)); return true; }, t("prd.note.done"));
    if (ok) { setBody(""); await q.refetch(); }
  };
  return (
    <div class="prd-form">
      <h3 class="prd-h">{t("prd.note.title")}</h3>
      {q.error ? <InlineAlert tone="warn">{t("prd.note.loadFail")}</InlineAlert> : null}
      {!q.loading && !q.error && !rows.length ? <p class="prd-muted">{t("prd.note.empty")}</p> : null}
      {rows.length ? (
        <ol class="prd-list">
          {rows.map((n) => (
            <li key={n.id}>
              <StatusPill tone={noteTone(n.kind)}>{t(k(`prd.note.kind.${n.kind}`))}</StatusPill> {n.body}
              <small class="prd-muted"> | {formatDateTime(n.createdAt)}{n.createdByName ? ` | ${t("prd.note.by", { name: n.createdByName })}` : ""}</small>
            </li>
          ))}
        </ol>
      ) : null}
      {canWriteNotes(role) ? (
        <>
          <Field label={t("prd.note.kind")}><Select value={kind} onChange={(e) => setKind(val(e))} options={NOTE_KINDS.map((x) => ({ value: x, label: t(k(`prd.note.kind.${x}`)) }))} /></Field>
          <Field label={t("prd.note.body")} hint={t("prd.note.hint")} error={body.length > 0 && noteError(body) ? t("prd.note.err") : undefined}><Textarea value={body} maxLength={1000} onInput={(e) => setBody(val(e))} /></Field>
          <div><Button size="sm" loading={act.busy} disabled={noteError(body) !== null} onClick={() => void add()}>{t("prd.note.add")}</Button></div>
        </>
      ) : null}
    </div>
  );
}
