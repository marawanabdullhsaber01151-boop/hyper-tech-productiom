/** @format */
// زر الشات العائم لصفحات البوابة: يفتح portal-chat.html ويعرض عدد الرسائل غير المقروءة.
// استعلام خفيف كل 30 ثانية (ويتوقف والتبويب مخفي). لا يعمل إذا لم يكن العميل مسجّل الدخول.
(function () {
  "use strict";
  const KEY = "hyper_erp_portal_session";
  const token = () => {
    for (const st of [localStorage, sessionStorage]) {
      try {
        const s = JSON.parse(st.getItem(KEY) || "null");
        if (s?.token) return s.token;
      } catch {}
    }
    return null;
  };
  if (!token() || location.pathname.endsWith("portal-chat.html")) return;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "CSS/chat.css";
  document.head.appendChild(css);
  const a = document.createElement("a");
  a.className = "chat-fab";
  a.href = "portal-chat.html";
  a.setAttribute("aria-label", "تواصل مع مسؤول حسابك");
  a.innerHTML = '💬<span class="badge" id="chat-fab-badge"></span>';
  document.body.appendChild(a);
  const badge = a.querySelector(".badge");
  async function refresh() {
    if (document.hidden || !token()) return;
    try {
      const res = await fetch("/api/v1/portal/chat/summary", { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return;
      const body = await res.json();
      const n = (body.data ?? body).unread || 0;
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.toggle("show", n > 0);
    } catch {}
  }
  refresh();
  setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", refresh);
})();
