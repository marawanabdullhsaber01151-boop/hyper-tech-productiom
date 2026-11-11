import "../copy/contacts";
import { useMemo, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, Dialog, Field, InlineAlert, Select, StatusPill, Textarea, useToast, type Column } from "../design/components";
import { formatNumber } from "../lib/format";
import { parseDelimited, willCreate, type PreviewRow, type RowStatus } from "./importCore";

interface Preview {
  rows: PreviewRow[];
  summary: { total: number; new: number; invalid: number; fileDuplicate: number; exists: number; similar: number };
  unknownColumns: string[];
}
const TONE: Record<RowStatus, "success" | "danger" | "warn" | "info"> = { new: "success", invalid: "danger", file_duplicate: "warn", exists: "warn", similar: "info" };
const val = (e: Event) => (e.target as HTMLInputElement).value;

/** استيراد عملاء بالجملة: الصق أو ارفع ملف، شوف المعاينة، وبعدين احفظ الجديد بس (والمتشابه اللي توافق عليه). */
export function ContactsImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const toast = useToast();
  const [text, setText] = useState("");
  const [type, setType] = useState("customer");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allowed, setAllowed] = useState<Set<number>>(new Set());
  const [fileErr, setFileErr] = useState("");
  const table = useMemo(() => parseDelimited(text), [text]);

  const load = async (f: File | undefined) => {
    setFileErr("");
    if (!f) return;
    if (f.size > 2_000_000) { setFileErr(t("con.imp.big")); return; }
    setText(await f.text());
    setPreview(null);
  };
  const check = async () => {
    const r = await act.run(() => api.post<Preview>("/contacts/import/preview", { table, type }));
    if (r) { setPreview(r); setAllowed(new Set()); }
  };
  const commit = async () => {
    const r = await act.run(() => api.post<{ created: number; skipped: number }>("/contacts/import/commit", { table, type, allowSimilarLines: [...allowed] }));
    if (r) { toast({ tone: "success", message: t("con.imp.done", { n: formatNumber(r.created), m: formatNumber(r.skipped) }) }); onDone(); }
  };
  const toggle = (line: number) => setAllowed((s) => { const n = new Set(s); if (n.has(line)) n.delete(line); else n.add(line); return n; });

  const cols: Column<PreviewRow>[] = [
    { key: "line", header: t("con.imp.line"), cell: (r) => formatNumber(r.line), mobile: "hide" },
    { key: "name", header: t("con.col.name"), cell: (r) => <span><strong>{r.row.name || "—"}</strong>{r.row.company ? <small class="eng-muted"> {r.row.company}</small> : null}</span>, mobile: "title" },
    { key: "phone", header: t("con.col.phone"), cell: (r) => <span dir="ltr">{r.row.phone || "—"}</span> },
    {
      key: "status",
      header: t("con.imp.status"),
      cell: (r) => (
        <span>
          <StatusPill tone={TONE[r.status]}>{t(`con.imp.st.${r.status}` as CopyKey)}</StatusPill>
          {r.status === "invalid" ? <small class="eng-muted"> {r.issues.map((i) => t(`con.imp.issue.${i}` as CopyKey)).join(" - ")}</small> : null}
          {r.status === "file_duplicate" ? <small class="eng-muted"> {t("con.imp.sameAs", { n: formatNumber(r.duplicateOfLine ?? 0) })}</small> : null}
          {r.matches[0] ? <small class="eng-muted"> {t(`con.imp.why.${r.matches[0].reason}` as CopyKey, { name: r.matches[0].name })}</small> : null}
        </span>
      ),
    },
    {
      key: "allow",
      header: t("con.imp.allow"),
      cell: (r) => (r.status === "similar" ? <input type="checkbox" checked={allowed.has(r.line)} aria-label={t("con.imp.allowAria", { n: formatNumber(r.line) })} onChange={() => toggle(r.line)} /> : null),
    },
  ];
  const n = preview ? willCreate(preview.rows, allowed) : 0;
  return (
    <Dialog open onClose={onClose} title={t("con.imp.title")} description={t("con.imp.desc")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="secondary" loading={act.busy} disabled={table.length < 2} onClick={() => void check()}>{t("con.imp.check")}</Button>
        <Button loading={act.busy} disabled={!preview || n === 0} onClick={() => void commit()}>{t("con.imp.save", { n: formatNumber(n) })}</Button>
      </>}>
      <div class="eng-form">
        <Field label={t("con.imp.file")} hint={t("con.imp.fileHint")}>
          <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={(e) => void load((e.target as HTMLInputElement).files?.[0])} />
        </Field>
        {fileErr ? <InlineAlert tone="danger">{fileErr}</InlineAlert> : null}
        <Field label={t("con.imp.paste")} hint={t("con.imp.pasteHint")}>
          <Textarea value={text} rows={6} dir="auto" onInput={(e) => { setText(val(e)); setPreview(null); }} />
        </Field>
        <Field label={t("con.imp.type")}>
          <Select value={type} onChange={(e) => { setType(val(e)); setPreview(null); }} options={[{ value: "customer", label: t("con.type.customer") }, { value: "supplier", label: t("con.type.supplier") }, { value: "both", label: t("con.type.both") }]} />
        </Field>
        {preview ? (
          <>
            <p>{t("con.imp.summary", { total: formatNumber(preview.summary.total), n: formatNumber(preview.summary.new), s: formatNumber(preview.summary.similar), d: formatNumber(preview.summary.exists + preview.summary.fileDuplicate), x: formatNumber(preview.summary.invalid) })}</p>
            {preview.unknownColumns.length ? <InlineAlert tone="info">{t("con.imp.unknown", { cols: preview.unknownColumns.join(" - ") })}</InlineAlert> : null}
            {preview.summary.similar > 0 ? <InlineAlert tone="info">{t("con.imp.similarHelp")}</InlineAlert> : null}
            <DataTable columns={cols} rows={preview.rows} rowKey={(r) => r.line} caption={t("con.imp.caption")} />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
