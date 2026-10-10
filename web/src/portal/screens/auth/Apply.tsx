import { useEffect, useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, Field, Input, InlineAlert, PhoneInput, StepWizard, Textarea } from "../../../design/components";
import { Link, navigate } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { AuthLayout } from "./AuthLayout";

const KEY = "ht-apply-draft";
interface Draft {
  companyName: string;
  city: string;
  address: string;
  expectedMonthlyVolume: string;
  fullName: string;
  phone: string;
  email: string;
  notes: string;
}
const EMPTY: Draft = { companyName: "", city: "", address: "", expectedMonthlyVolume: "", fullName: "", phone: "", email: "", notes: "" };

function loadDraft(): Draft {
  try {
    return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(KEY) || "{}") };
  } catch {
    return EMPTY;
  }
}

export function Apply() {
  const [d, setD] = useState<Draft>(loadDraft);
  const [step, setStep] = useState(0);
  const [ref, setRef] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: Event) => setD((x) => ({ ...x, [k]: (e.currentTarget as HTMLInputElement).value }));

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      /* ممنوع التخزين: عادي */
    }
  }, [d]);

  const send = useMutation(async () => {
    const body = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v.trim()]));
    const r = await api.post<{ referenceCode: string }>("/portal/applications", body, { anonymous: true });
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setRef(r.referenceCode);
  });

  if (ref) {
    return (
      <AuthLayout title={t("p.apply.done.title")}>
        <p class="pt-muted">{t("p.apply.done.body")}</p>
        <div class="pt-center pt-stack">
          <span class="pt-muted">{t("p.apply.done.ref")}</span>
          <span class="pt-ref">{ref}</span>
        </div>
        <Button block onClick={() => navigate(`/portal/track?ref=${encodeURIComponent(ref)}`)}>
          {t("p.apply.done.track")}
        </Button>
      </AuthLayout>
    );
  }

  const companyOk = d.companyName.trim().length >= 2;
  const contactOk = d.fullName.trim().length >= 2 && d.phone.replace(/\D/g, "").length >= 8;
  return (
    <AuthLayout title={t("p.apply.title")} sub={t("p.apply.sub")} footer={<Link to="/portal/login">{t("p.choose.back")}</Link>}>
      {send.error ? <InlineAlert tone="danger">{send.error.message}</InlineAlert> : null}
      <StepWizard
        current={step}
        onChange={setStep}
        onFinish={() => (companyOk && contactOk ? void send.mutate(undefined) : undefined)}
        finishing={send.loading}
        finishLabel={t("p.apply.send")}
        steps={[
          {
            id: "company",
            title: t("p.apply.step.company"),
            valid: companyOk,
            content: (
              <div class="pt-form">
                <Field label={t("p.apply.companyName")} required>
                  <Input value={d.companyName} onInput={set("companyName")} autocomplete="organization" />
                </Field>
                <Field label={t("p.apply.city")} optional>
                  <Input value={d.city} onInput={set("city")} />
                </Field>
                <Field label={t("p.apply.address")} optional>
                  <Input value={d.address} onInput={set("address")} autocomplete="street-address" />
                </Field>
                <Field label={t("p.apply.volume")} hint={t("p.apply.volumeHint")} optional>
                  <Input value={d.expectedMonthlyVolume} onInput={set("expectedMonthlyVolume")} />
                </Field>
              </div>
            ),
          },
          {
            id: "contact",
            title: t("p.apply.step.contact"),
            valid: contactOk,
            content: (
              <div class="pt-form">
                <Field label={t("p.apply.fullName")} required>
                  <Input value={d.fullName} onInput={set("fullName")} autocomplete="name" />
                </Field>
                <Field label={t("p.apply.phone")} required>
                  <PhoneInput value={d.phone} onChange={(v) => setD((x) => ({ ...x, phone: v }))} />
                </Field>
                <Field label={t("p.apply.email")} optional>
                  <Input type="email" dir="ltr" value={d.email} onInput={set("email")} autocomplete="email" />
                </Field>
              </div>
            ),
          },
          {
            id: "review",
            title: t("p.apply.step.review"),
            valid: companyOk && contactOk,
            content: (
              <div class="pt-form">
                <dl class="pt-dl">
                  <dt>{t("p.apply.companyName")}</dt>
                  <dd>{d.companyName}</dd>
                  <dt>{t("p.apply.fullName")}</dt>
                  <dd>{d.fullName}</dd>
                  <dt>{t("p.apply.phone")}</dt>
                  <dd class="pt-ltr">{d.phone}</dd>
                </dl>
                <Field label={t("p.apply.notes")} optional>
                  <Textarea value={d.notes} onInput={set("notes")} />
                </Field>
                <p class="pt-muted">{companyOk && contactOk ? t("p.apply.draft") : t("p.apply.fixFirst")}</p>
              </div>
            ),
          },
        ]}
      />
    </AuthLayout>
  );
}
