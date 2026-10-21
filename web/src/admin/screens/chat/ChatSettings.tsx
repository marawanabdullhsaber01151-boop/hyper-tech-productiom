import { useEffect, useState } from "preact/hooks";
import { t, type CopyKey } from "../../../copy";
import { Button, Checkbox, Field, InlineAlert, Input, Section, Skeleton, Switch, Textarea } from "../../../design/components";
import { Plus, X } from "../../../design/icons";
import { useQuery } from "../../../api/hooks";
import { toLatinDigits } from "../../../lib/phone";
import { api } from "../../api";
import { useAct } from "../../act";

export interface ChatSettingsData {
  openDays: number[];
  openMinute: number;
  closeMinute: number;
  escalationMinutes: number;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  holidays: string[];
  whatsappNumber: string | null;
}

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (s: string, fallback: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** نفس قواعد السيرفر (validateChatConfig) عشان الخطأ يظهر قبل الإرسال. */
export function validateSettings(s: ChatSettingsData, wa: string): Partial<Record<"days" | "hours" | "esc" | "wa", string>> {
  const e: Partial<Record<"days" | "hours" | "esc" | "wa", string>> = {};
  if (!s.openDays.length) e.days = t("c.s.v.days");
  if (s.closeMinute <= s.openMinute) e.hours = t("c.s.v.hours");
  if (!Number.isInteger(s.escalationMinutes) || s.escalationMinutes < 1 || s.escalationMinutes > 1440) e.esc = t("c.s.v.esc");
  if (wa && !/^\d{8,15}$/.test(wa)) e.wa = t("c.s.v.wa");
  return e;
}

/** إعدادات الشات (للمدير): ساعات الشغل، الإجازات، التأخير، الرد التلقائي، واتساب. */
export function ChatSettings() {
  const q = useQuery((signal) => api.get<ChatSettingsData>("/chat/settings", { signal }), []);
  const { run, busy } = useAct();
  const [s, setS] = useState<ChatSettingsData | null>(null);
  const [wa, setWa] = useState("");
  const [holiday, setHoliday] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (q.data) {
      setS(q.data);
      setWa(q.data.whatsappNumber ?? "");
    }
  }, [q.data]);

  if (q.error && !s) return <InlineAlert tone="danger" title={t("c.s.err")} action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t("common.retry")}</Button>}>{q.error.message}</InlineAlert>;
  if (!s) return <Skeleton height={240} />;

  const set = (patch: Partial<ChatSettingsData>) => setS({ ...s, ...patch });
  const waClean = toLatinDigits(wa).replace(/[\s+\-]/g, "");
  const errs = validateSettings(s, waClean);
  const toggleDay = (d: number, on: boolean) => set({ openDays: on ? [...new Set([...s.openDays, d])].sort() : s.openDays.filter((x) => x !== d) });
  const addHoliday = () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(holiday) && !s.holidays.includes(holiday)) set({ holidays: [...s.holidays, holiday].sort() });
    setHoliday("");
  };

  const save = async () => {
    setTried(true);
    if (Object.keys(errs).length) return;
    const body: ChatSettingsData = { ...s, whatsappNumber: waClean || null, autoReplyText: s.autoReplyText.trim() };
    const r = await run(() => api.put<ChatSettingsData>("/chat/settings", body), t("c.s.saved"));
    if (r) {
      setS(r);
      setWa(r.whatsappNumber ?? "");
      setTried(false);
    }
  };
  const show = (k: keyof typeof errs) => (tried ? errs[k] : undefined);

  return (
    <div class="ad-stack cc-settings">
      <div>
        <h2 class="cc-h2">{t("c.s.title")}</h2>
        <p class="ad-muted">{t("c.s.sub")}</p>
      </div>

      <Section title={t("c.s.hours")}>
        <div class="cc-form">
          <Field label={t("c.s.days")} error={show("days")}>
            <div class="cc-days" role="group" aria-label={t("c.s.days")}>
              {DAYS.map((d) => (
                <Checkbox key={d} label={t(`c.s.day.${d}` as CopyKey)} checked={s.openDays.includes(d)} onChange={(e) => toggleDay(d, (e.currentTarget as HTMLInputElement).checked)} />
              ))}
            </div>
          </Field>
          <div class="cc-times">
            <Field label={t("c.s.open")} error={show("hours")}>
              <Input type="time" value={toTime(s.openMinute)} onInput={(e) => set({ openMinute: fromTime((e.currentTarget as HTMLInputElement).value, s.openMinute) })} />
            </Field>
            <Field label={t("c.s.close")}>
              <Input type="time" value={toTime(s.closeMinute)} onInput={(e) => set({ closeMinute: fromTime((e.currentTarget as HTMLInputElement).value, s.closeMinute) })} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title={t("c.s.holidays")}>
        <div class="cc-form">
          <div class="cc-holiday-add">
            <Field label={t("c.s.holiday.date")}>
              <Input type="date" value={holiday} onInput={(e) => setHoliday((e.currentTarget as HTMLInputElement).value)} />
            </Field>
            <Button variant="secondary" icon={Plus} disabled={!holiday} onClick={addHoliday}>{t("c.s.holiday.add")}</Button>
          </div>
          {s.holidays.length ? (
            <ul class="cc-chips">
              {s.holidays.map((h) => (
                <li key={h} class="cc-chip">
                  <bdi>{h}</bdi>
                  <button type="button" class="cc-chip__x" aria-label={t("c.s.holiday.remove", { date: h })} onClick={() => set({ holidays: s.holidays.filter((x) => x !== h) })}><X size={14} /></button>
                </li>
              ))}
            </ul>
          ) : <p class="ad-muted">{t("c.s.holiday.none")}</p>}
        </div>
      </Section>

      <Section title={t("c.s.esc")}>
        <Field label={t("c.s.esc.field")} hint={t("c.s.esc.hint")} error={show("esc")}>
          <Input type="number" inputMode="numeric" min={1} max={1440} value={String(s.escalationMinutes)} onInput={(e) => set({ escalationMinutes: Number((e.currentTarget as HTMLInputElement).value) })} />
        </Field>
      </Section>

      <Section title={t("c.s.auto")}>
        <div class="cc-form">
          <Switch label={t("c.s.auto.on")} hint={t("c.s.auto.hint")} checked={s.autoReplyEnabled} onChange={(v) => set({ autoReplyEnabled: v })} />
          <Field label={t("c.s.auto.text")}>
            <Textarea rows={3} maxLength={500} value={s.autoReplyText} onInput={(e) => set({ autoReplyText: (e.currentTarget as HTMLTextAreaElement).value })} />
          </Field>
        </div>
      </Section>

      <Section title={t("c.s.wa")}>
        <Field label={t("c.s.wa.field")} hint={t("c.s.wa.hint")} error={show("wa")}>
          <Input dir="ltr" inputMode="numeric" placeholder="201001234567" value={wa} onInput={(e) => setWa((e.currentTarget as HTMLInputElement).value)} />
        </Field>
      </Section>

      <div class="cc-savebar">
        <Button loading={busy} onClick={() => void save()}>{t("c.s.save")}</Button>
      </div>
    </div>
  );
}
