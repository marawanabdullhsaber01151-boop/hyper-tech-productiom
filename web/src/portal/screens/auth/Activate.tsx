import { useEffect, useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, Field, InlineAlert, PasswordInput } from "../../../design/components";
import { navigate } from "../../../app/router";
import { useMutation } from "../../../api/hooks";
import { api } from "../../api";
import { copyText } from "../../../lib/clipboard";
import { AuthLayout } from "./AuthLayout";

interface Preview {
  purpose: string;
  name: string;
}

export function Activate() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token") ?? "";
  const isReset = params.get("mode") === "reset";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [bad, setBad] = useState<string | null>(token ? null : t("p.activate.noToken"));
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .post<Preview>("/portal/activate/preview", { token }, { anonymous: true })
      .then(setPreview)
      .catch((e: Error) => setBad(e.message || t("p.activate.badLink")));
  }, [token]);

  const submit = useMutation(async () => {
    if (isReset) {
      await api.post("/portal/recovery/complete", { token, newPassword: pw }, { anonymous: true });
      setDone(true);
    } else {
      const r = await api.post<{ recoveryCodes?: string[] }>("/portal/activate", { token, password: pw, confirmPassword: pw2 }, { anonymous: true });
      if (r.recoveryCodes?.length) setCodes(r.recoveryCodes);
      else setDone(true);
    }
  });

  const title = isReset ? t("p.reset.title") : t("p.activate.title");

  if (codes && !done) {
    const text = codes.join("\n");
    return (
      <AuthLayout title={t("p.codes.title")} sub={t("p.codes.body")}>
        <div class="pt-codes" role="list">
          {codes.map((c) => (
            <span key={c} role="listitem">
              {c}
            </span>
          ))}
        </div>
        <div class="pt-row">
          <Button
            variant="secondary"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = t("p.codes.file");
              a.click();
              URL.revokeObjectURL(url);
              setSaved(true);
            }}
          >
            {t("p.codes.download")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void copyText(text).then((ok) => ok && setSaved(true));
            }}
          >
            {t("p.codes.copy")}
          </Button>
        </div>
        {!saved ? <p class="pt-muted">{t("p.codes.confirm")}</p> : null}
        <Button block disabled={!saved} onClick={() => setDone(true)}>
          {t("p.codes.saved")}
        </Button>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title={isReset ? t("p.reset.done") : t("p.activate.done")}>
        <p class="pt-muted">{t("p.activate.doneBody")}</p>
        <Button block onClick={() => navigate("/portal/login")}>
          {t("p.login.submit")}
        </Button>
      </AuthLayout>
    );
  }

  if (bad) {
    return (
      <AuthLayout title={title}>
        <InlineAlert tone="danger">{bad}</InlineAlert>
        <Button variant="secondary" block onClick={() => navigate("/portal/recover")}>
          {t("p.login.forgot")}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} sub={isReset ? t("p.reset.sub") : t("p.activate.sub")}>
      {preview?.name ? <p class="pt-muted">{t("p.activate.hello", { name: preview.name })}</p> : null}
      <form
        class="pt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length < 6) return setHint(t("p.activate.short"));
          if (!isReset && pw !== pw2) return setHint(t("p.activate.mismatch"));
          setHint(null);
          void submit.mutate(undefined);
        }}
      >
        {hint || submit.error ? <InlineAlert tone="danger">{hint ?? submit.error?.message}</InlineAlert> : null}
        <Field label={t("p.activate.password")} required>
          <PasswordInput value={pw} onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} autocomplete="new-password" autofocus />
        </Field>
        {!isReset ? (
          <Field label={t("p.activate.confirm")} required>
            <PasswordInput value={pw2} onInput={(e) => setPw2((e.currentTarget as HTMLInputElement).value)} autocomplete="new-password" />
          </Field>
        ) : null}
        <Button type="submit" block size="lg" loading={submit.loading}>
          {isReset ? t("p.reset.submit") : t("p.activate.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
