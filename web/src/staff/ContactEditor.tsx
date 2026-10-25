import { useEffect, useState } from "preact/hooks";
import { api } from "../admin/api";
import { useAct } from "../admin/act";
import { t, type CopyKey } from "../copy";
import { GOVERNORATES } from "../copy/governorates";
import { Button, Dialog, Field, InlineAlert, Input, Select, Textarea } from "../design/components";
import { CONTACT_TYPES, SEGMENTS, draftErrors, draftOf, emptyDraft, toBody, type ContactDraft, type ContactRow, type TypeTab } from "./contactsCore";

const val = (e: Event) => (e.target as HTMLInputElement).value;
interface Match {
  id: number;
  name: string;
  company: string | null;
  phone: string | null;
}

/** إضافة/تعديل جهة اتصال. بيحذّر من التكرار (نفس التليفون بأي صيغة أو نفس الشركة) قبل الحفظ. */
export function ContactEditor({ contact, startTab, onClose, onSaved }: { contact?: ContactRow; startTab: TypeTab; onClose: () => void; onSaved: (id: number) => void }) {
  const editing = !!contact;
  const act = useAct();
  const [d, setD] = useState<ContactDraft>(() => (contact ? draftOf(contact) : emptyDraft(startTab === "supplier" ? "supplier" : "customer")));
  const [tried, setTried] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [ack, setAck] = useState(false);
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const errs = draftErrors(d);
  const invalid = errs.name || errs.phone || errs.email;

  useEffect(() => {
    setAck(false);
    const phone = d.phone.trim();
    const company = d.company.trim();
    if (!phone && !company) {
      setMatches([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<{ matches: Match[] }>("/contacts/duplicate-check", { signal: ctrl.signal, query: { phone, company, excludeId: contact?.id } })
        .then((r) => setMatches(Array.isArray(r.matches) ? r.matches : []))
        .catch(() => undefined); // التحذير مساعد بس، فشله ما يمنعش الحفظ.
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [d.phone, d.company, contact?.id]);

  const save = async () => {
    setTried(true);
    if (invalid) return;
    if (matches.length && !ack) {
      setAck(true);
      return;
    }
    const id = await act.run(
      async () => {
        if (editing) {
          await api.patch(`/contacts/${contact!.id}`, toBody(d));
          return contact!.id;
        }
        const created = await api.post<{ id: number }>("/contacts", toBody(d));
        return created.id;
      },
      t(editing ? "con.ed.updated" : "con.ed.created"),
    );
    if (id !== undefined) onSaved(id);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t("con.ed.title.edit", { name: contact!.name }) : t("con.ed.title.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={act.busy} onClick={() => void save()}>{ack ? t("con.dup.confirm") : t("con.ed.save")}</Button>
        </>
      }
    >
      <div class="con-form">
        <div class="con-grid2">
          <Field label={t("con.ed.type")} required>
            <Select value={d.type} options={CONTACT_TYPES.map((x) => ({ value: x, label: t(`con.type.${x}` as CopyKey) }))} onChange={(e) => set("type", (e.target as HTMLSelectElement).value)} />
          </Field>
          <Field label={t("con.ed.name")} required error={tried && errs.name ? t("con.ed.err.name") : null}>
            <Input value={d.name} onInput={(e) => set("name", val(e))} />
          </Field>
          <Field label={t("con.ed.company")} optional>
            <Input value={d.company} onInput={(e) => set("company", val(e))} />
          </Field>
          <Field label={t("con.ed.phone")} optional error={tried && errs.phone ? t("con.ed.err.phone") : null}>
            <Input type="tel" inputMode="tel" dir="ltr" value={d.phone} onInput={(e) => set("phone", val(e))} />
          </Field>
        </div>
        {matches.length ? (
          <InlineAlert tone="warn" title={t("con.dup.title")}>
            {t("con.dup.body", { names: matches.map((m) => m.name || m.company || m.phone || "").join(" | ") })}
          </InlineAlert>
        ) : null}
        <div class="con-grid2">
          <Field label={t("con.ed.email")} optional error={tried && errs.email ? t("con.ed.err.email") : null}>
            <Input type="email" dir="ltr" value={d.email} onInput={(e) => set("email", val(e))} />
          </Field>
          <Field label={t("con.ed.city")} optional>
            <Select value={d.city} placeholder={t("con.ed.city.pick")} options={GOVERNORATES.map((g) => ({ value: g, label: g }))} onChange={(e) => set("city", (e.target as HTMLSelectElement).value)} />
          </Field>
          {d.type !== "supplier" ? (
            <Field label={t("con.ed.segment")} optional hint={t("con.ed.segment.hint")}>
              <Select value={d.segment} placeholder={t("con.seg.none")} options={SEGMENTS.map((x) => ({ value: x, label: t(`con.seg.${x}` as CopyKey) }))} onChange={(e) => set("segment", (e.target as HTMLSelectElement).value)} />
            </Field>
          ) : null}
        </div>
        <Field label={t("con.ed.address")} optional>
          <Textarea rows={2} value={d.address} onInput={(e) => set("address", val(e))} />
        </Field>
        <Field label={t("con.ed.notes")} optional>
          <Textarea rows={2} value={d.notes} onInput={(e) => set("notes", val(e))} />
        </Field>
      </div>
    </Dialog>
  );
}
