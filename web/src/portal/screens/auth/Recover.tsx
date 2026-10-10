import { useEffect, useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, Field, Input, InlineAlert, PasswordInput, Select } from "../../../design/components";
import { Link } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { AuthLayout } from "./AuthLayout";

type Method = "link" | "admin" | "recovery" | "owner";
const NEEDS: Record<Method, string[]> = { link: ["email", "telegram"], admin: ["admin"], recovery: ["recovery_code"], owner: ["owner"] };

export function Recover() {
  const [methods, setMethods] = useState<string[]>(["email", "telegram", "admin", "recovery_code", "owner"]);
  const [support, setSupport] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [method, setMethod] = useState<Method>("link");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .get<{ methods: string[]; support: { whatsappUrl: string } | null }>("/portal/recovery/methods", { anonymous: true })
      .then((r) => {
        setMethods(r.methods);
        setSupport(r.support?.whatsappUrl ?? null);
      })
      .catch(() => undefined);
  }, []);

  const options = (Object.keys(NEEDS) as Method[]).filter((m) => NEEDS[m].some((k) => methods.includes(k)));
  const label: Record<Method, string> = { link: t("p.recover.m.link"), admin: t("p.recover.m.admin"), recovery: t("p.recover.m.recovery"), owner: t("p.recover.m.owner") };

  const go = useMutation(async () => {
    setInfo(null);
    const id = identifier.trim();
    if (method === "link") {
      await api.post("/portal/recovery/start", { identifier: id }, { anonymous: true });
      setInfo(t("p.recover.linkSent"));
    } else if (method === "owner") {
      await api.post("/portal/recovery/ask-owner", { identifier: id }, { anonymous: true });
      setInfo(t("p.recover.ownerSent"));
    } else {
      const r = await api.post<{ resetToken: string }>("/portal/recovery/verify", method === "admin" ? { identifier: id, code: code.trim() } : { identifier: id, recoveryCode: code.trim() }, { anonymous: true });
      setTicket(r.resetToken);
    }
  });
  const save = useMutation(async () => {
    await api.post("/portal/recovery/complete", { token: ticket, newPassword: pw }, { anonymous: true });
    setDone(true);
  });

  if (done) {
    return (
      <AuthLayout title={t("p.reset.done")}>
        <p class="pt-muted">{t("p.activate.doneBody")}</p>
        <Link to="/portal/login">{t("p.login.submit")}</Link>
      </AuthLayout>
    );
  }

  if (ticket) {
    return (
      <AuthLayout title={t("p.reset.title")} sub={t("p.recover.codeOk")}>
        <form
          class="pt-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.length >= 6) void save.mutate(undefined);
          }}
        >
          {save.error ? <InlineAlert tone="danger">{save.error.message}</InlineAlert> : null}
          <Field label={t("p.recover.newPassword")} required>
            <PasswordInput value={pw} minLength={6} onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} autocomplete="new-password" autofocus />
          </Field>
          <Button type="submit" block size="lg" loading={save.loading}>
            {t("p.recover.save")}
          </Button>
        </form>
      </AuthLayout>
    );
  }

  const needsCode = method === "admin" || method === "recovery";
  return (
    <AuthLayout
      title={t("p.recover.title")}
      sub={t("p.recover.sub")}
      footer={
        <>
          {support ? (
            <a href={support} target="_blank" rel="noopener noreferrer">
              {t("p.recover.support")}
            </a>
          ) : null}
          <Link to="/portal/login">{t("p.choose.back")}</Link>
        </>
      }
    >
      <form
        class="pt-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (identifier.trim()) void go.mutate(undefined);
        }}
      >
        {go.error ? <InlineAlert tone="danger">{go.error.message}</InlineAlert> : null}
        {info ? <InlineAlert tone="success">{info}</InlineAlert> : null}
        <Field label={t("p.recover.identifier")} required>
          <Input value={identifier} dir="ltr" onInput={(e) => setIdentifier((e.currentTarget as HTMLInputElement).value)} autocomplete="username" />
        </Field>
        <Field label={t("p.recover.method")}>
          <Select value={method} options={options.map((m) => ({ value: m, label: label[m] }))} onChange={(e) => setMethod((e.currentTarget as HTMLSelectElement).value as Method)} />
        </Field>
        {needsCode ? (
          <Field label={t("p.recover.code")} required>
            <Input value={code} dir="ltr" autocomplete="one-time-code" onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
          </Field>
        ) : null}
        <Button type="submit" block size="lg" loading={go.loading}>
          {t("p.recover.go")}
        </Button>
      </form>
    </AuthLayout>
  );
}
