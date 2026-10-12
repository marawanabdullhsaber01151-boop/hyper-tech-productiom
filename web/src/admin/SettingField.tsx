import { useEffect, useState } from "preact/hooks";
import { ar, t, type CopyKey } from "../copy";
import { Button, Checkbox, Field, Input, InlineAlert, Select, Switch, Textarea } from "../design/components";
import { Plus, Trash, Undo2 } from "../design/icons";
import type { SettingShape } from "./types";

export const optLabel = (v: string) => {
  const k = `a.opt.${v}`;
  return k in ar ? t(k as CopyKey) : v;
};

interface WaRow {
  label: string;
  phone: string;
  enabled: boolean;
  isDefault: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** محرّر إعداد واحد، بيتولّد من شكل الإعداد اللي جاي من السيرفر (من غير تعديل واجهة لكل إعداد جديد). */
export function SettingField({ label, description, shape, value, inherited, onSave, onReset, saving, error }: { label: string; description: string; shape: SettingShape; value: unknown; inherited?: boolean; onSave: (v: unknown) => void; onReset?: () => void; saving?: boolean; error?: string | null }) {
  const [draft, setDraft] = useState<unknown>(value);
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  useEffect(() => setDraft(value), [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !same(draft, value);

  const save = () => {
    if (shape.kind === "json" && typeof draft === "string") {
      try {
        onSave(JSON.parse(draft));
        setJsonErr(null);
      } catch {
        setJsonErr(t("a.set.badJson"));
      }
      return;
    }
    onSave(draft);
  };

  let editor;
  switch (shape.kind) {
    case "boolean":
      editor = <Switch label={label} checked={draft === true} onChange={(v) => onSave(v)} disabled={saving} />;
      break;
    case "number":
      editor = (
        <Input
          type="number"
          inputMode="numeric"
          min={shape.min}
          max={shape.max}
          value={draft === null || draft === undefined ? "" : String(draft)}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            setDraft(v === "" ? (shape.nullable ? null : "") : Number(v));
          }}
        />
      );
      break;
    case "text":
      editor = <Input value={(draft as string | null) ?? ""} onInput={(e) => { const v = (e.currentTarget as HTMLInputElement).value; setDraft(v === "" && shape.nullable ? null : v); }} />;
      break;
    case "choice":
      editor = (
        <Select
          value={String(draft ?? "")}
          options={[...(shape.nullable ? [{ value: "", label: t("a.set.none") }] : []), ...(shape.options ?? []).map((o) => ({ value: o, label: optLabel(o) }))]}
          onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; setDraft(v === "" ? null : v); }}
        />
      );
      break;
    case "multi": {
      const cur = new Set((draft as string[]) ?? []);
      editor = (
        <div class="ad-checks">
          {(shape.options ?? []).map((o) => (
            <Checkbox
              key={o}
              label={optLabel(o)}
              checked={cur.has(o)}
              onChange={(e) => {
                const n = new Set(cur);
                if ((e.currentTarget as HTMLInputElement).checked) n.add(o);
                else n.delete(o);
                setDraft((shape.options ?? []).filter((x) => n.has(x)));
              }}
            />
          ))}
        </div>
      );
      break;
    }
    case "whatsapp": {
      const rows = (draft as WaRow[]) ?? [];
      const upd = (i: number, patch: Partial<WaRow>) =>
        setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : patch.isDefault ? { ...r, isDefault: false } : r)));
      editor = (
        <div class="ad-stack">
          {rows.map((r, i) => (
            <div class="ad-wa" key={i}>
              <Input aria-label={t("a.set.wa.label")} placeholder={t("a.set.wa.label")} value={r.label} onInput={(e) => upd(i, { label: (e.currentTarget as HTMLInputElement).value })} />
              <Input aria-label={t("a.set.wa.phone")} placeholder={t("a.set.wa.phone")} dir="ltr" inputMode="tel" value={r.phone} onInput={(e) => upd(i, { phone: (e.currentTarget as HTMLInputElement).value })} />
              <Switch label={t("a.set.wa.on")} checked={r.enabled} onChange={(v) => upd(i, { enabled: v })} />
              <Switch label={t("a.set.wa.default")} checked={r.isDefault} onChange={(v) => upd(i, { isDefault: v })} />
              <Button variant="ghost" size="sm" icon={Trash} onClick={() => setDraft(rows.filter((_, j) => j !== i))}>{t("common.delete")}</Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setDraft([...rows, { label: "", phone: "", enabled: true, isDefault: rows.length === 0 }])}>{t("a.set.wa.add")}</Button>
          </div>
        </div>
      );
      break;
    }
    case "list":
      editor = (
        <Textarea
          rows={5}
          value={((draft as string[]) ?? []).join("\n")}
          onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean))}
        />
      );
      break;
    default:
      editor = <Textarea dir="ltr" rows={4} value={typeof draft === "string" ? draft : JSON.stringify(draft, null, 2)} onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)} />;
  }

  return (
    <div class="ad-setting">
      {shape.kind === "boolean" ? (
        <div class="ad-setting__head">
          {editor}
          {description ? <p class="ad-muted">{description}</p> : null}
        </div>
      ) : (
        <Field label={label} hint={description} error={error ?? jsonErr}>
          {editor}
        </Field>
      )}
      <div class="ad-setting__foot">
        {inherited !== undefined ? <span class="ad-muted">{inherited ? t("a.set.inherited") : t("a.set.custom")}</span> : null}
        {shape.kind !== "boolean" && dirty ? <Button size="sm" loading={saving} onClick={save}>{t("common.save")}</Button> : null}
        {onReset && inherited === false ? (
          <Button size="sm" variant="ghost" icon={Undo2} disabled={saving} onClick={onReset}>{t("a.set.reset")}</Button>
        ) : null}
      </div>
      {error && shape.kind === "boolean" ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </div>
  );
}
