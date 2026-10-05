/** @format */
// تفعيل إشعارات Web Push (مجانية). يظهر الزر فقط لو المتصفح يدعم والسيرفر مضبوط عليه VAPID.
(function () {
  "use strict";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function b64ToU8(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function init({ api, prefix, button, onMessage }) {
    if (!supported || !button) return;
    let publicKey = null;
    try {
      publicKey = (await api(`${prefix}/push-key`)).publicKey;
    } catch {
      return;
    }
    if (!publicKey) return; // السيرفر لم يُضبط عليه VAPID
    const reg = await navigator.serviceWorker.register("/chat-sw.js");
    const existing = await reg.pushManager.getSubscription();
    const refresh = async () => {
      const sub = await reg.pushManager.getSubscription();
      const on = !!sub && Notification.permission === "granted";
      button.style.display = Notification.permission === "denied" ? "none" : "";
      button.textContent = on ? "🔔 الإشعارات مفعّلة (إيقاف)" : "🔔 فعّل الإشعارات";
      button.dataset.on = on ? "1" : "";
    };
    // تأكيد تسجيل الاشتراك القائم في السيرفر (يتحمّل تغيّر الحساب على نفس الجهاز)
    if (existing && Notification.permission === "granted") {
      api(`${prefix}/push-subscribe`, { method: "POST", body: JSON.stringify(existing.toJSON()) }).catch(() => {});
    }
    button.addEventListener("click", async () => {
      try {
        if (button.dataset.on) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await api(`${prefix}/push-unsubscribe`, { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
            await sub.unsubscribe();
          }
        } else {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") return onMessage && onMessage("لم يتم السماح بالإشعارات من المتصفح");
          const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
          await api(`${prefix}/push-subscribe`, { method: "POST", body: JSON.stringify(sub.toJSON()) });
          onMessage && onMessage("تم تفعيل الإشعارات ✅");
        }
      } catch (e) {
        onMessage && onMessage(e.message || "تعذّر تفعيل الإشعارات");
      }
      refresh();
    });
    refresh();
  }
  window.ChatPush = { init, supported };
})();
