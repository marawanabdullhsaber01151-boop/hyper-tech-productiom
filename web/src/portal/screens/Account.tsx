import { useState } from "preact/hooks";
import { t } from "../../copy";
import { Button, Card, Dialog, Field, Icon, Input, InlineAlert, PasswordInput, Section, Tabs, useToast } from "../../design/components";
import { LogOut, Mail, Send, ShieldCheck, Smartphone } from "../../design/icons";
import { navigate, usePath } from "../../app/router";
import { useMutation, useQuery } from "../../api/hooks";
import { copyText } from "../../lib/clipboard";
import { formatNumber, formatRelative } from "../../lib/format";
import { BRAND_PRESETS, accentLabel, applyTheme, readCachedTheme, type ThemeSettings } from "../../design/theme-runtime";
import { api } from "../api";
import { logout, useAuth } from "../session";
import type { ChannelsInfo, PortalSessionInfo } from "../types";
import { ListSkeleton, LoadError } from "./shared";

function Profile() {
  const { customer, member } = useAuth();
  return (
    <Card class="pt-stack" pad>
      <dl class="pt-dl">
        <dt>{t("p.account.name")}</dt>
        <dd>{customer?.fullName}</dd>
        <dt>{t("p.account.phone")}</dt>
        <dd class="pt-ltr">{customer?.phone}</dd>
        <dt>{t("p.account.email")}</dt>
        <dd>{customer?.email ?? t("p.account.none")}</dd>
        <dt>{t("p.account.company")}</dt>
        <dd>{customer?.companyName}</dd>
        <dt>{t("p.account.role")}</dt>
        <dd>{member?.isOwner ? t("p.account.owner") : (member?.roleName ?? member?.roleKey)}</dd>
      </dl>
      <p class="pt-muted">{t("p.account.profileNote")}</p>
      <Button variant="secondary" icon={LogOut} onClick={() => void logout().then(() => navigate("/portal/login", { replace: true }))}>
        {t("p.account.logout")}
      </Button>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [nw2, setNw2] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const m = useMutation(async () => {
    await api.post("/portal/change-password", { currentPassword: cur, newPassword: nw });
    toast({ tone: "success", message: t("p.sec.changed") });
    setCur("");
    setNw("");
    setNw2("");
  });
  return (
    <Section title={t("p.sec.password")}>
      <Card pad>
        <form
          class="pt-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (nw.length < 6) return setHint(t("p.activate.short"));
            if (nw !== nw2) return setHint(t("p.activate.mismatch"));
            setHint(null);
            void m.mutate(undefined);
          }}
        >
          {hint || m.error ? <InlineAlert tone="danger">{hint ?? m.error?.message}</InlineAlert> : null}
          <Field label={t("p.sec.current")} required>
            <PasswordInput value={cur} onInput={(e) => setCur((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("p.sec.new")} required>
            <PasswordInput value={nw} autocomplete="new-password" onInput={(e) => setNw((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Field label={t("p.sec.confirm")} required>
            <PasswordInput value={nw2} autocomplete="new-password" onInput={(e) => setNw2((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Button type="submit" loading={m.loading}>
            {t("p.sec.change")}
          </Button>
        </form>
      </Card>
    </Section>
  );
}

function Sessions() {
  const toast = useToast();
  const q = useQuery((signal) => api.get<PortalSessionInfo[]>("/portal/sessions", { signal }), []);
  const revoke = useMutation(async (id: number) => {
    await api.delete(`/portal/sessions/${id}`);
    toast({ tone: "success", message: t("p.sec.revoked") });
    await q.refetch();
  });
  const others = useMutation(async () => {
    await api.post("/portal/sessions/revoke-others");
    toast({ tone: "success", message: t("p.sec.revokedOthers") });
    await q.refetch();
  });
  return (
    <Section title={t("p.sec.sessions")} actions={q.data && q.data.length > 1 ? <Button size="sm" variant="secondary" loading={others.loading} onClick={() => void others.mutate(undefined)}>{t("p.sec.revokeOthers")}</Button> : undefined}>
      <Card pad>
        {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.loading && !q.data ? <ListSkeleton rows={2} /> : null}
        {q.data?.map((s) => (
          <div key={s.id} class="pt-device">
            <div>
              <div>
                <Icon icon={Smartphone} size={16} /> <strong>{s.deviceLabel}</strong> {s.current ? <span class="ht-pill ht-pill--brand">{t("p.sec.thisDevice")}</span> : null}
              </div>
              <div class="pt-muted">{t("p.sec.lastActive", { when: formatRelative(s.lastActiveAt) })}</div>
            </div>
            {!s.current ? (
              <Button size="sm" variant="danger" onClick={() => void revoke.mutate(s.id)}>
                {t("p.sec.revoke")}
              </Button>
            ) : null}
          </div>
        ))}
      </Card>
    </Section>
  );
}

function CodesDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const m = useMutation(async () => {
    const r = await api.post<{ codes: string[] }>("/portal/me/recovery-codes/regenerate", { currentPassword: pw });
    setCodes(r.codes);
    setPw("");
    onDone();
  });
  const close = () => {
    setCodes(null);
    setPw("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={codes ? t("p.sec.codesMade") : t("p.sec.newCodes")} description={codes ? t("p.codes.body") : t("p.sec.newCodesBody")}>
      {codes ? (
        <div class="pt-stack">
          <div class="pt-codes">
            {codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void copyText(codes.join("\n"))}>
            {t("p.codes.copy")}
          </Button>
        </div>
      ) : (
        <form
          class="pt-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw) void m.mutate(undefined);
          }}
        >
          {m.error ? <InlineAlert tone="danger">{m.error.message}</InlineAlert> : null}
          <Field label={t("p.sec.current")} required>
            <PasswordInput value={pw} onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          <Button type="submit" loading={m.loading}>
            {t("p.sec.newCodes")}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

function Channels() {
  const toast = useToast();
  const q = useQuery((signal) => api.get<ChannelsInfo>("/portal/me/channels", { signal }), []);
  const [email, setEmail] = useState("");
  const [asked, setAsked] = useState(false);
  const [code, setCode] = useState("");
  const [codesOpen, setCodesOpen] = useState(false);
  const [tgUrl, setTgUrl] = useState<string | null>(null);

  const add = useMutation(async () => {
    const r = await api.post<{ sent: boolean }>("/portal/me/channels/email", { email: email.trim() });
    if (r.sent) setAsked(true);
    toast({ tone: r.sent ? "success" : "danger", message: r.sent ? t("p.sec.emailSent") : t("p.sec.emailFail") });
  });
  const verify = useMutation(async () => {
    await api.post("/portal/me/channels/email/verify", { code: code.trim() });
    toast({ tone: "success", message: t("p.sec.emailAdded") });
    setAsked(false);
    setEmail("");
    setCode("");
    await q.refetch();
  });
  const tg = useMutation(async () => {
    const r = await api.post<{ url: string }>("/portal/me/channels/telegram/link");
    setTgUrl(r.url);
  });
  const remove = useMutation(async (id: number) => {
    await api.delete(`/portal/me/channels/${id}`);
    toast({ tone: "success", message: t("p.sec.channelRemoved") });
    await q.refetch();
  });

  return (
    <Section title={t("p.sec.channels")} description={t("p.sec.channelsBody")}>
      <Card class="pt-stack" pad>
        {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data && q.data.channels.length === 0 ? <p class="pt-muted">{t("p.sec.noChannels")}</p> : null}
        {q.data?.channels.map((c) => (
          <div key={c.id} class="pt-device">
            <span>
              <Icon icon={c.type === "email" ? Mail : Send} size={16} /> {c.type === "email" ? t("p.sec.email") : t("p.sec.telegram")} <span class="pt-muted pt-ltr">{c.type === "email" ? c.masked : ""}</span> {c.verified ? <span class="ht-pill ht-pill--success">{t("p.sec.verified")}</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void remove.mutate(c.id)}>
              {t("p.sec.removeChannel")}
            </Button>
          </div>
        ))}
        {!asked ? (
          <form
            class="pt-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void add.mutate(undefined);
            }}
          >
            <Field label={t("p.sec.addEmail")}>
              <Input type="email" dir="ltr" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} autocomplete="email" />
            </Field>
            <Button type="submit" variant="secondary" loading={add.loading}>
              {t("p.sec.addEmail")}
            </Button>
          </form>
        ) : (
          <form
            class="pt-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void verify.mutate(undefined);
            }}
          >
            {verify.error ? <InlineAlert tone="danger">{verify.error.message}</InlineAlert> : null}
            <Field label={t("p.sec.emailCode")}>
              <Input dir="ltr" inputMode="numeric" value={code} autocomplete="one-time-code" onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
            </Field>
            <Button type="submit" loading={verify.loading}>
              {t("p.sec.verify")}
            </Button>
          </form>
        )}
        {q.data?.telegramBot ? (
          tgUrl ? (
            <a class="ht-btn ht-btn--secondary" href={tgUrl} target="_blank" rel="noopener noreferrer">
              {t("p.sec.telegramOpen")}
            </a>
          ) : (
            <Button variant="secondary" icon={Send} loading={tg.loading} onClick={() => void tg.mutate(undefined)}>
              {t("p.sec.linkTelegram")}
            </Button>
          )
        ) : (
          <p class="pt-muted">{t("p.sec.telegramNone")}</p>
        )}
        {add.error ? <InlineAlert tone="danger">{add.error.message}</InlineAlert> : null}
        <div class="pt-row pt-row--between">
          <span class="pt-muted">
            <Icon icon={ShieldCheck} size={16} /> {q.data && q.data.recoveryCodesLeft > 0 ? t("p.sec.codesLeft", { n: formatNumber(q.data.recoveryCodesLeft) }) : t("p.sec.codesNone")}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setCodesOpen(true)}>
            {t("p.sec.newCodes")}
          </Button>
        </div>
      </Card>
      <CodesDialog open={codesOpen} onClose={() => setCodesOpen(false)} onDone={() => void q.refetch()} />
    </Section>
  );
}

function Prefs() {
  const [th, setTh] = useState<Partial<ThemeSettings>>(() => readCachedTheme());
  const set = (p: Partial<ThemeSettings>) => {
    setTh((x) => ({ ...x, ...p }));
    applyTheme(p);
  };
  const accent = th.accent ?? "blue";
  return (
    <Card class="pt-stack" pad>
      <Field label={t("p.prefs.mode")}>
        <div class="pt-seg" role="group" aria-label={t("p.prefs.mode")}>
          {(["system", "light", "dark"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={(th.mode ?? "system") === m} onClick={() => set({ mode: m })}>
              {t(`theme.mode.${m}`)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t("p.prefs.accent")}>
        <div class="pt-swatches" role="group" aria-label={t("p.prefs.accent")}>
          {Object.keys(BRAND_PRESETS).map((k) => (
            <button key={k} type="button" class="pt-swatch" title={accentLabel(k)} aria-label={accentLabel(k)} aria-pressed={accent === k} style={{ "--sw": `oklch(0.55 ${BRAND_PRESETS[k]!.c} ${BRAND_PRESETS[k]!.h})` } as never} onClick={() => set({ accent: k })} />
          ))}
        </div>
      </Field>
      <Field label={t("p.prefs.density")}>
        <div class="pt-seg" role="group" aria-label={t("p.prefs.density")}>
          {(["cozy", "compact"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={(th.density ?? "cozy") === d} onClick={() => set({ density: d })}>
              {t(d === "cozy" ? "p.prefs.cozy" : "p.prefs.compact")}
            </button>
          ))}
        </div>
      </Field>
    </Card>
  );
}

export function Account() {
  usePath();
  const tab = new URLSearchParams(location.search).get("tab") ?? "profile";
  const go = (id: string) => navigate(`/portal/account${id === "profile" ? "" : `?tab=${id}`}`);
  return (
    <>
      <h1 class="pt-page-title">{t("p.account.title")}</h1>
      <Tabs
        value={tab}
        onChange={go}
        tabs={[
          { id: "profile", label: t("p.account.tab.profile"), panel: <Profile /> },
          {
            id: "security",
            label: t("p.account.tab.security"),
            panel: (
              <div class="pt-stack">
                <PasswordCard />
                <Channels />
                <Sessions />
              </div>
            ),
          },
          { id: "prefs", label: t("p.account.tab.prefs"), panel: <Prefs /> },
        ]}
      />
    </>
  );
}
