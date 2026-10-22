import { useEffect, useState } from "preact/hooks";
import { t } from "../../copy";
import { GOVERNORATES } from "../../copy/governorates";
import { Button, Dialog, Field, Input, InlineAlert, PasswordInput, Select, Textarea, useToast } from "../../design/components";
import { useMutation } from "../../api/hooks";
import { api } from "../api";
import { updateCustomer } from "../session";
import type { PortalCustomer } from "../types";

interface Form {
  fullName: string;
  phone: string;
  email: string;
  companyName: string;
  city: string;
  address: string;
  currentPassword: string;
}

/** نفس شروط السيرفر (updatePortalProfileSchema) عشان الخطأ يظهر قبل الإرسال. */
export function profileProblem(f: Form): boolean {
  return f.fullName.trim().length < 2 || f.companyName.trim().length < 2 || f.phone.replace(/\D/g, "").length < 8 || !f.currentPassword || (f.email.trim() !== "" && !/^\S+@\S+\.\S+$/.test(f.email.trim()));
}

/** تعديل بيانات الحساب والشركة (لمن عنده صلاحية «يعدّل بيانات الشركة»). */
export function ProfileEdit({ customer, open, onClose }: { customer: PortalCustomer; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const init = (): Form => ({
    fullName: customer.fullName,
    phone: customer.phone,
    email: customer.email ?? "",
    companyName: customer.companyName,
    city: customer.city ?? "",
    address: customer.address ?? "",
    currentPassword: "",
  });
  const [f, setF] = useState<Form>(init);
  const [hint, setHint] = useState<string | null>(null);
  // كل مرة النافذة تفتح نبدأ من بياناتك الحالية (مش من تعديل اتلغى قبل كده)
  useEffect(() => {
    if (open) {
      setF(init());
      setHint(null);
    }
  }, [open]);
  const set = (k: keyof Form) => (e: Event) => setF((x) => ({ ...x, [k]: (e.currentTarget as HTMLInputElement).value }));

  const save = useMutation(async () => {
    const r = await api.patch<{ fullName: string; phone: string; email: string | null; companyName: string; city: string | null; address: string | null }>("/portal/me", {
      currentPassword: f.currentPassword,
      fullName: f.fullName.trim(),
      phone: f.phone.trim(),
      email: f.email.trim() || null,
      companyName: f.companyName.trim(),
      city: f.city || null,
      address: f.address.trim() || null,
    });
    updateCustomer({ fullName: r.fullName, phone: r.phone, email: r.email, companyName: r.companyName, city: r.city, address: r.address });
    toast({ tone: "success", message: t("p.prof.saved") });
    setF((x) => ({ ...x, currentPassword: "" }));
    onClose();
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("p.prof.title")}
      description={t("p.prof.sub")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            loading={save.loading}
            onClick={() => {
              if (profileProblem(f)) return setHint(t("p.prof.invalid"));
              setHint(null);
              void save.mutate(undefined);
            }}
          >
            {t("p.prof.save")}
          </Button>
        </>
      }
    >
      <div class="pt-form">
        {hint || save.error ? <InlineAlert tone="danger">{hint ?? save.error?.message}</InlineAlert> : null}
        <Field label={t("p.prof.name")} required>
          <Input value={f.fullName} onInput={set("fullName")} autocomplete="name" />
        </Field>
        <Field label={t("p.prof.phone")} required>
          <Input type="tel" dir="ltr" inputMode="tel" value={f.phone} onInput={set("phone")} autocomplete="tel" />
        </Field>
        <Field label={t("p.prof.email")}>
          <Input type="email" dir="ltr" value={f.email} onInput={set("email")} autocomplete="email" />
        </Field>
        <Field label={t("p.prof.company")} required>
          <Input value={f.companyName} onInput={set("companyName")} autocomplete="organization" />
        </Field>
        <Field label={t("p.prof.city")}>
          <Select value={f.city} placeholder={t("p.prof.city.pick")} options={GOVERNORATES.map((g) => ({ value: g, label: g }))} onChange={(e) => setF((x) => ({ ...x, city: (e.currentTarget as HTMLSelectElement).value }))} />
        </Field>
        <Field label={t("p.prof.address")}>
          <Textarea rows={3} maxLength={500} value={f.address} onInput={set("address")} autocomplete="street-address" />
        </Field>
        <Field label={t("p.prof.password")} required>
          <PasswordInput value={f.currentPassword} onInput={set("currentPassword")} autocomplete="current-password" />
        </Field>
      </div>
    </Dialog>
  );
}
