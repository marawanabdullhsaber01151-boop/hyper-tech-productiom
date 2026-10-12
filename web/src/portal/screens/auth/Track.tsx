import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../../copy";
import { Button, Field, Input, InlineAlert, PhoneInput, StatusPill, Textarea, type Tone } from "../../../design/components";
import { Link } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { AuthLayout } from "./AuthLayout";

const TONE: Record<string, Tone> = { pending: "info", approved: "success", rejected: "danger", needs_info: "warn" };
const FIELD_KEYS = ["fullName", "companyName", "email", "address", "city", "commercialRegisterNo", "taxId", "expectedMonthlyVolume", "notes"] as const;
const KNOWN: Record<string, 1> = { "p.track.status.pending": 1, "p.track.status.approved": 1, "p.track.status.rejected": 1, "p.track.status.needs_info": 1 };

interface TrackResult {
  status: string;
  stage?: string;
  reviewerNote: string | null;
  canEdit?: boolean;
  fields?: Record<string, string> | null;
}

export function Track() {
  const [ref, setRef] = useState(() => new URLSearchParams(location.search).get("ref") ?? "");
  const [phone, setPhone] = useState("");
  const [res, setRes] = useState<TrackResult | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);

  const go = useMutation(async () => {
    const r = await api.get<TrackResult>("/portal/applications/track", { query: { referenceCode: ref.trim(), phone: phone.trim() }, anonymous: true });
    setForm(r.fields ?? {});
    setRes(r);
  });
  const send = useMutation(async () => {
    const body: Record<string, string> = { phone: phone.trim() };
    for (const k of FIELD_KEYS) if (form[k] !== undefined) body[k] = form[k]!.trim();
    if (reply.trim()) body.reply = reply.trim();
    await api.patch(`/portal/applications/${encodeURIComponent(ref.trim())}`, body, { anonymous: true });
    setSent(true);
    setRes(null);
  });
  const key = res ? (`p.track.status.${res.status}` as CopyKey) : null;
  return (
    <AuthLayout title={t("p.track.title")} footer={<Link to="/portal/login">{t("p.choose.back")}</Link>}>
      <form
        class="pt-form"
        onSubmit={(e) => {
          e.preventDefault();
          setRes(null);
          setSent(false);
          void go.mutate(undefined);
        }}
      >
        {go.error ? <InlineAlert tone="danger">{go.error.message}</InlineAlert> : null}
        <Field label={t("p.track.ref")} required>
          <Input value={ref} dir="ltr" onInput={(e) => setRef((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field label={t("p.track.phone")} required>
          <PhoneInput value={phone} onChange={(v) => setPhone(v)} />
        </Field>
        <Button type="submit" block loading={go.loading}>
          {t("p.track.submit")}
        </Button>
      </form>
      {sent ? <InlineAlert tone="success">{t("p.track.reply.done")}</InlineAlert> : null}
      {res && key ? (
        <div class="pt-stack" aria-live="polite">
          <StatusPill tone={TONE[res.status] ?? "neutral"}>{key in KNOWN ? t(key) : res.status}</StatusPill>
          {res.stage === "ready" ? <p class="pt-muted">{t("p.track.ready")}</p> : null}
          {res.reviewerNote ? (
            <InlineAlert tone="info" title={t("p.track.note")}>
              {res.reviewerNote}
            </InlineAlert>
          ) : null}
          {res.canEdit && res.fields ? (
            <form
              class="pt-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send.mutate(undefined);
              }}
            >
              <strong>{t("p.track.reply.title")}</strong>
              <p class="pt-muted">{t("p.track.reply.sub")}</p>
              {send.error ? <InlineAlert tone="danger">{send.error.message}</InlineAlert> : null}
              {FIELD_KEYS.filter((k) => k in (res.fields ?? {})).map((k) => (
                <Field key={k} label={t(`p.track.f.${k}` as CopyKey)}>
                  {k === "notes" ? (
                    <Textarea rows={3} value={form[k] ?? ""} onInput={(e) => setForm({ ...form, [k]: (e.currentTarget as HTMLTextAreaElement).value })} />
                  ) : (
                    <Input value={form[k] ?? ""} dir={k === "email" ? "ltr" : undefined} onInput={(e) => setForm({ ...form, [k]: (e.currentTarget as HTMLInputElement).value })} />
                  )}
                </Field>
              ))}
              <Field label={t("p.track.reply.message")}>
                <Textarea rows={2} value={reply} onInput={(e) => setReply((e.currentTarget as HTMLTextAreaElement).value)} />
              </Field>
              <Button type="submit" block loading={send.loading}>{t("p.track.reply.send")}</Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </AuthLayout>
  );
}
