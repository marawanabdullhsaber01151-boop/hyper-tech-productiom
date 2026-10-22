import { useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, Field, Input, InlineAlert, PhoneInput } from "../../../design/components";
import { Link, navigate } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { AuthLayout } from "./AuthLayout";

/** عميل قديم من غير دخول للبوابة: بيطلب التفعيل (بيظهر للمبيعات في «طلبات التفعيل»). */
export function ActivationRequest() {
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = useMutation(async () => {
    const r = await api.post<{ message: string }>("/portal/activation-requests", { companyName: company.trim(), phone: phone.trim() }, { anonymous: true });
    setDone(r.message);
  });

  if (done) {
    return (
      <AuthLayout title={t("p.oldc.done")}>
        <p class="pt-muted">{done}</p>
        <Button block onClick={() => navigate("/portal/login")}>{t("p.oldc.back")}</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("p.oldc.title")} sub={t("p.oldc.sub")} footer={<Link to="/portal/login">{t("p.oldc.back")}</Link>}>
      <form
        class="pt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (company.trim().length < 2 || phone.replace(/\D/g, "").length < 8) return setHint(t("p.oldc.invalid"));
          setHint(null);
          void send.mutate(undefined);
        }}
      >
        {hint || send.error ? <InlineAlert tone="danger">{hint ?? send.error?.message}</InlineAlert> : null}
        <Field label={t("p.oldc.company")} required>
          <Input value={company} onInput={(e) => setCompany((e.currentTarget as HTMLInputElement).value)} autocomplete="organization" autofocus />
        </Field>
        <Field label={t("p.oldc.phone")} required>
          <PhoneInput value={phone} onChange={(v) => setPhone(v)} />
        </Field>
        <Button type="submit" block size="lg" loading={send.loading}>{t("p.oldc.send")}</Button>
      </form>
    </AuthLayout>
  );
}
