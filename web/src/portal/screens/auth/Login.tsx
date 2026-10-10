import { useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, Checkbox, Field, Input, InlineAlert, PasswordInput } from "../../../design/components";
import { Link, navigate } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { chooseCompany, login } from "../../session";
import type { CompanyChoice } from "../../types";
import { AuthLayout } from "./AuthLayout";

export function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ token: string; companies: CompanyChoice[] } | null>(null);

  const submit = useMutation(async () => {
    const c = await login(identifier.trim(), password, remember);
    if (c) setChoice({ token: c.choiceToken, companies: c.companies });
    else navigate("/portal/home", { replace: true });
  });
  const pick = useMutation(async (companyId: number) => {
    await chooseCompany(choice!.token, companyId);
    navigate("/portal/home", { replace: true });
  });

  if (choice) {
    return (
      <AuthLayout
        title={t("p.choose.title")}
        sub={t("p.choose.sub")}
        footer={
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setChoice(null);
            }}
          >
            {t("p.choose.back")}
          </a>
        }
      >
        {pick.error ? <InlineAlert tone="danger">{pick.error.message}</InlineAlert> : null}
        <div class="pt-stack">
          {choice.companies.map((c) => (
            <Button key={c.companyId} variant="secondary" block loading={pick.loading} onClick={() => void pick.mutate(c.companyId)}>
              {c.companyName} {c.isOwner ? `· ${t("p.choose.owner")}` : `· ${c.roleName}`}
            </Button>
          ))}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("p.login.title")}
      sub={t("p.login.sub")}
      footer={
        <>
          <Link to="/portal/recover">{t("p.login.forgot")}</Link>
          <Link to="/portal/join">{t("p.login.join")}</Link>
          <Link to="/portal/apply">{t("p.login.apply")}</Link>
          <Link to="/portal/track">{t("p.login.track")}</Link>
        </>
      }
    >
      <form
        class="pt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!identifier.trim() || !password) return setHint(t("p.login.required"));
          setHint(null);
          void submit.mutate(undefined);
        }}
      >
        {hint || submit.error ? <InlineAlert tone="danger">{hint ?? submit.error?.message}</InlineAlert> : null}
        <Field label={t("p.login.identifier")} required>
          <Input value={identifier} onInput={(e) => setIdentifier((e.currentTarget as HTMLInputElement).value)} autocomplete="username" inputMode="email" dir="ltr" autofocus />
        </Field>
        <Field label={t("p.login.password")} required>
          <PasswordInput value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Checkbox label={t("p.login.remember")} checked={remember} onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)} />
        <Button type="submit" block size="lg" loading={submit.loading}>
          {t("p.login.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
