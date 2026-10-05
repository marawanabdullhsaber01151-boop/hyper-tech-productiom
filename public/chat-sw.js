/** @format */
// Service Worker للشات: يعرض إشعارات Web Push المجانية ويفتح المحادثة عند الضغط.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "هايبر تك", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // لو صفحة الشات مفتوحة ومرئية، التحديث الدوري سيعرض الرسالة — لا داعي للإشعار
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.some((w) => w.visibilityState === "visible" && w.url.includes(data.url || "chat"))) return;
      await self.registration.showNotification(data.title || "هايبر تك", {
        body: data.body || "",
        tag: data.tag || "chat",
        renotify: true,
        dir: "rtl",
        lang: "ar",
        data: { url: data.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (w.url === target && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
