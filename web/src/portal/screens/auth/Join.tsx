import { useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, CodeInput, Field, Input, InlineAlert, PasswordInput, PhoneInput } from "../../../design/components";
import { Link, navigate } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { AuthLayout } from "./AuthLayout";

export function Join() {
  const [code, setCode] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: "joined" | "pending"; companyName: string } | null>(null);

  const send = useMutation(async () => {
    const r = await api.post<{ status: "joined" | "pending"; companyName: string }>(
      "/portal/join",
      { code: code.trim(), fullName: name.trim(), phone: phone.trim(), email: email.trim() || null, password },
      { anonymous: true },
    );
    setDone(r);
  });

  if (done) {
    const joined = done.status === "joined";
    return (
      <AuthLayout title={joined ? t("p.join.done.joined", { company: done.companyName }) : t("p.join.done.pending")}>
        <p class="pt-muted">{joined ? t("p.join.done.joinedBody") : t("p.join.done.pendingBody", { company: done.companyName })}</p>
        <Button block onClick={() => navigate("/portal/login")}>
          {t("p.join.goLogin")}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("p.join.title")} sub={t("p.join.sub")} footer={<Link to="/portal/login">{t("p.choose.back")}</Link>}>
      <form
        class="pt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!raw) return setHint(t("p.join.codeFirst"));
          setHint(null);
          void send.mutate(undefined);
        }}
      >
        {hint || send.error ? <InlineAlert tone="danger">{hint ?? send.error?.message}</InlineAlert> : null}
        <Field label={t("p.join.code")} required>
          <CodeInput
            value={code}
            onChange={(f, r) => {
              setCode(f);
              setRaw(r);
            }}
          />
        </Field>
        <Field label={t("p.join.name")} required>
          <Input value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} autocomplete="name" />
        </Field>
        <Field label={t("p.join.phone")} required>
          <PhoneInput value={phone} onChange={(v) => setPhone(v)} />
        </Field>
        <Field label={t("p.join.email")} optional>
          <Input type="email" dir="ltr" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} autocomplete="email" />
        </Field>
        <Field label={t("p.join.password")} hint={t("p.join.passwordHint")} required>
          <PasswordInput value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} autocomplete="new-password" />
        </Field>
        <Button type="submit" block size="lg" loading={send.loading}>
          {t("p.join.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
