import "../copy/settings";
import { useEffect, useState } from "preact/hooks";
import { useAct } from "../admin/act";
import { api } from "../admin/api";
import { useQuery } from "../api/hooks";
import { t, type CopyKey } from "../copy";
import { Button, DataTable, EmptyState, Field, InlineAlert, Input, Select, Tabs, type Column } from "../design/components";
import { formatDateTime, formatNumber } from "../lib/format";
import { changedPayload, defsOf, dirtyKeys, displayValue, validateDraft, type HistoryRow, type SettingDef, type SettingValues } from "./settingsCore";
import "./Activity.css";

const val = (e: Event) => (e.target as HTMLInputElement).value;
interface Center { defs: SettingDef[]; values: SettingValues }

/** مركز الإعدادات: بيانات الشركة + التشغيل والمواعيد + سجل «مين غيّر إيه». الشاشة بتتبني من تعريف الإعدادات اللي جاي من السيرفر. */
export function Settings() {
  const [tab, setTab] = useState("company");
  const center = useQuery((signal) => api.get<{ data: Center }>("/settings/center", { signal }), []);
  const history = useQuery((signal) => api.get<{ data: HistoryRow[] }>("/settings/center/history?limit=100", { signal }), []);
  const c = center.data?.data;
  const hist = Array.isArray(history.data?.data) ? history.data!.data : [];
  const saved = async () => { await center.refetch(); await history.refetch(); };

  const histCols: Column<HistoryRow>[] = [
    { key: "w", header: t("set.hist.when"), cell: (r) => formatDateTime(r.createdAt), mobile: "title" },
    { key: "u", header: t("set.hist.who"), cell: (r) => r.actor },
    { key: "k", header: t("set.hist.what"), cell: (r) => r.label },
    { key: "c", header: t("set.hist.change"), cell: (r) => { const d = c?.defs.find((x) => x.key === r.key); return t("set.hist.arrow", { before: displayValue(d, r.before), after: displayValue(d, r.after) }); } },
    { key: "r", header: t("set.hist.reason"), cell: (r) => r.reason || "—", mobile: "hide" },
  ];
  return (
    <div class="ad-page">
      <div>
        <h1 class="ad-title">{t("set.title")}</h1>
        <p class="st-login__sub">{t("set.subtitle")}</p>
      </div>
      {center.error ? <InlineAlert tone="warn">{t("set.loadFail")}</InlineAlert> : null}
      {c ? (
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "company", label: t("set.tab.company"), panel: <SettingsForm intro={t("set.company.intro")} defs={defsOf(c.defs, "company")} values={c.values} onSaved={saved} /> },
          { id: "security", label: t("set.tab.security"), panel: <SettingsForm intro={t("set.sec.intro")} defs={defsOf(c.defs, "security")} values={c.values} onSaved={saved} /> },
          { id: "operations", label: t("set.tab.operations"), panel: <SettingsForm intro={t("set.ops.intro")} defs={defsOf(c.defs, "operations")} values={c.values} onSaved={saved} /> },
          { id: "history", label: t("set.tab.history"), panel: <DataTable columns={histCols} rows={hist} rowKey={(r) => r.id} caption={t("set.hist.caption")} loading={history.loading} empty={<EmptyState title={t("set.hist.empty")} compact />} /> },
        ]} />
      ) : null}
      <InlineAlert tone="info">
        <strong>{t("set.legacy.title")}</strong> — {t("set.legacy.body")} <a href="/settings.html">{t("set.legacy.open")}</a>
      </InlineAlert>
    </div>
  );
}

function SettingsForm({ intro, defs, values, onSaved }: { intro: string; defs: SettingDef[]; values: SettingValues; onSaved: () => Promise<void> }) {
  const act = useAct();
  const [draft, setDraft] = useState<SettingValues>(values);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => { setDraft(values); }, [values]);
  const dirty = dirtyKeys(defs, values, draft);
  const errors = validateDraft(defs, draft);
  const submit = async () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    if (!dirty.length) return;
    const ok = await act.run(async () => { await api.put<unknown>("/settings/center", { values: changedPayload(dirty, draft), ...(reason.trim() ? { reason: reason.trim() } : {}) }); return true; }, t("set.saved", { n: formatNumber(dirty.length) }));
    if (ok) { setReason(""); setTried(false); await onSaved(); }
  };
  const hint = (d: SettingDef) => [d.hint, d.type === "int" && d.min !== undefined && d.max !== undefined ? t("set.range", { min: formatNumber(d.min), max: formatNumber(d.max) }) : null, d.type !== "text" && d.type !== "email" ? t("set.default", { value: displayValue(d, d.default) }) : null].filter(Boolean).join(" — ");
  return (
    <div class="act-list">
      <p class="st-login__sub">{intro}</p>
      {defs.map((d) => {
        const err = tried ? errors[d.key] : undefined;
        const set = (e: Event) => setDraft({ ...draft, [d.key]: val(e) });
        const label = d.unit && d.type === "int" ? `${d.label} (${d.unit})` : d.label;
        return (
          <Field key={d.key} label={label} hint={hint(d) || undefined} error={err ? t(`set.err.${err}` as CopyKey) : undefined}>
            {d.type === "select" ? <Select value={draft[d.key] ?? ""} options={d.options ?? []} onChange={set} />
              : <Input inputMode={d.type === "int" ? "numeric" : undefined} type={d.type === "email" ? "email" : "text"} value={draft[d.key] ?? ""} maxLength={d.maxLength} onInput={set} />}
          </Field>
        );
      })}
      <Field label={t("set.reason")}><Input value={reason} maxLength={300} onInput={(e) => setReason(val(e))} /></Field>
      <div class="act-toolbar">
        <Button loading={act.busy} disabled={!dirty.length} onClick={() => void submit()}>{t("set.save")}</Button>
        <Button variant="ghost" disabled={!dirty.length} onClick={() => { setDraft(values); setTried(false); }}>{t("set.reset")}</Button>
        {!dirty.length ? <span class="st-login__sub">{t("set.nothing")}</span> : null}
      </div>
    </div>
  );
}
