import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../../../copy";
import { Button, useToast } from "../../../design/components";
import { Bell } from "../../../design/icons";
import { api } from "../../api";

const supported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;

/** مفتاح VAPID (base64url) → Uint8Array. */
export function b64ToU8(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** زر إشعارات المتصفح (Web Push مجاني). مش بيظهر لو المتصفح مش بيدعم أو السيرفر مش مضبوط عليه VAPID. */
export function ChatPushButton() {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const reg = useRef<ServiceWorkerRegistration | null>(null);
  const key = useRef<string>("");

  const refresh = async () => {
    const sub = await reg.current?.pushManager.getSubscription();
    setOn(!!sub && Notification.permission === "granted");
    setDenied(Notification.permission === "denied");
  };

  useEffect(() => {
    if (!supported()) return;
    let alive = true;
    (async () => {
      try {
        const r = await api.get<{ publicKey: string | null }>("/chat/push-key");
        if (!r.publicKey || !alive) return;
        key.current = r.publicKey;
        reg.current = await navigator.serviceWorker.register("/chat-sw.js");
        const existing = await reg.current.pushManager.getSubscription();
        // تأكيد تسجيل الاشتراك القائم (بيتحمّل تغيّر الحساب على نفس الجهاز)
        if (existing && Notification.permission === "granted") void api.post("/chat/push-subscribe", existing.toJSON()).catch(() => undefined);
        if (!alive) return;
        await refresh();
        setReady(true);
      } catch {
        /* الإشعارات اختيارية: لو فشلت الصفحة تكمّل عادي */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!ready || denied) return null;

  const toggle = async () => {
    const r = reg.current;
    if (!r || busy) return;
    setBusy(true);
    try {
      if (on) {
        const sub = await r.pushManager.getSubscription();
        if (sub) {
          await api.post("/chat/push-unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
          await sub.unsubscribe();
        }
        toast({ tone: "info", message: t("c.push.disabled") });
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast({ tone: "warn", message: t("c.push.refused") });
        } else {
          const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key.current) as BufferSource });
          await api.post("/chat/push-subscribe", sub.toJSON());
          toast({ tone: "success", message: t("c.push.enabled") });
        }
      }
    } catch (e) {
      toast({ tone: "danger", message: (e as Error).message || t("c.push.fail") });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return <Button variant={on ? "secondary" : "primary"} icon={Bell} loading={busy} aria-pressed={on} onClick={() => void toggle()}>{on ? t("c.push.on") : t("c.push.off")}</Button>;
}
