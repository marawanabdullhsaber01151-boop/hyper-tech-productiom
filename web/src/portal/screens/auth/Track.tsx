import { useState } from "preact/hooks";
import { t, type CopyKey } from "../../../copy";
import { Button, Field, Input, InlineAlert, PhoneInput, StatusPill, type Tone } from "../../../design/components";
import { Link } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { AuthLayout } from "./AuthLayout";

const TONE: Record<string, Tone> = { pending: "info", approved: "success", rejected: "danger", needs_info: "warn" };

export function Track() {
  const [ref, setRef] = useState(() => new URLSearchParams(location.search).get("ref") ?? "");
  const [phone, setPhone] = useState("");
  const [res, setRes] = useState<{ status: string; reviewerNote: string | null } | null>(null);
  const go = useMutation(async () => {
    setRes(await api.get("/portal/applications/track", { query: { referenceCode: ref.trim(), phone: phone.trim() }, anonymous: true }));
  });
  const key = res ? (`p.track.status.${res.status}` as CopyKey) : null;
  return (
    <AuthLayout title={t("p.track.title")} footer={<Link to="/portal/login">{t("p.choose.back")}</Link>}>
      <form
        class="pt-form"
        onSubmit={(e) => {
          e.preventDefault();
          setRes(null);
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
      {res && key ? (
        <div class="pt-stack" aria-live="polite">
          <StatusPill tone={TONE[res.status] ?? "neutral"}>{key in { "p.track.status.pending": 1, "p.track.status.approved": 1, "p.track.status.rejected": 1, "p.track.status.needs_info": 1 } ? t(key) : res.status}</StatusPill>
          {res.reviewerNote ? (
            <InlineAlert tone="info" title={t("p.track.note")}>
              {res.reviewerNote}
            </InlineAlert>
          ) : null}
        </div>
      ) : null}
    </AuthLayout>
  );
}
