/** @format */
/**
 * شاشة محادثة العميل مع مسؤول حسابه.
 * - رسالة واحدة دائمة (thread) لكل عميل؛ الإغلاق حالة متابعة وليس محادثة جديدة.
 * - إرسال آمن ضد التكرار: clientMsgId يتولد مرة واحدة لكل رسالة ويُعاد استخدامه عند إعادة المحاولة.
 * - تحديث تكيّفي عبر ChatUI.createPoller (لا sockets على Vercel).
 */
(function () {
  "use strict";
  const { esc, newId, fmtTime, fmtDay, tickHTML, tickStatus, createPoller, compressImage, loadProtectedImage, EVENT_ICONS, TOPIC_LABELS } = window.ChatUI;

  const SESSION_KEY = "hyper_erp_portal_session";
  const RATED_KEY = "hyper_chat_rated_";
  const $ = (id) => document.getElementById(id);

  /* ───── api ───── */
  function getSession() {
    for (const st of [localStorage, sessionStorage]) {
      try {
        const raw = st.getItem(SESSION_KEY);
        if (raw) return JSON.parse(raw);
      } catch {}
    }
    return null;
  }
  const authHeaders = () => {
    const s = getSession();
    return s?.token ? { Authorization: `Bearer ${s.token}` } : {};
  };
  function redirectToLogin() {
    location.href = "portal-login.html";
  }
  async function api(path, options = {}) {
    let res;
    try {
      res = await fetch(`/api/v1${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) },
      });
    } catch {
      const e = new Error("تعذّر الاتصال بالخادم");
      e.network = true;
      throw e;
    }
    if (res.status === 401) {
      redirectToLogin();
      throw Object.assign(new Error("انتهت الجلسة"), { status: 401 });
    }
    let body = null;
    try {
      body = await res.json();
    } catch {}
    if (!res.ok) {
      throw Object.assign(new Error(body?.error?.message || `خطأ (${res.status})`), { status: res.status });
    }
    return body && Object.prototype.hasOwnProperty.call(body, "data") && Object.keys(body).length <= 2 ? body.data : body;
  }
  async function fetchBlob(url) {
    const res = await fetch(`/api/v1${url}`, { headers: authHeaders() });
    if (!res.ok) throw Object.assign(new Error("img"), { status: res.status });
    return res.blob();
  }
  const asList = (x) => {
    let v = x;
    for (let i = 0; i < 3 && v && !Array.isArray(v); i += 1) v = v.data ?? v.items ?? null;
    return Array.isArray(v) ? v : [];
  };

  /* ───── state ───── */
  const state = {
    lastId: 0,
    oldestId: null,
    hasMore: false,
    meta: { staffDeliveredUpTo: 0, staffReadUpTo: 0, status: "open" },
    topic: null,
    context: null, // {type,id,label}
    image: null, // dataURL
    sending: false,
    closureId: null,
    pending: new Map(), // clientMsgId -> {el, payload}
    seenIds: new Set(),
    lastDay: null,
  };

  const box = $("messages");
  function toast(msg, bad) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.toggle("bad", !!bad);
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  /* ───── rendering ───── */
  function nearBottom() {
    return box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  }
  function scrollBottom() {
    box.scrollTop = box.scrollHeight;
  }

  function daySep(iso) {
    const label = fmtDay(iso);
    if (state.lastDay === label) return null;
    state.lastDay = label;
    const el = document.createElement("div");
    el.className = "day-sep";
    el.textContent = label;
    return el;
  }

  function messageEl(m) {
    if (m.kind === "system" || m.senderType === "system") {
      const el = document.createElement("div");
      el.className = "sys-event";
      el.dataset.id = m.id;
      el.textContent = `${EVENT_ICONS[m.event] || "ℹ️"} ${m.body}`;
      return el;
    }
    const mine = m.senderType === "customer";
    const el = document.createElement("div");
    el.className = `msg ${mine ? "mine" : "theirs"}${m.hidden ? " hidden-msg" : ""}`;
    el.dataset.id = m.id;
    let inner = "";
    if (!mine && m.senderName) inner += `<div class="sender">${esc(m.senderName)}</div>`;
    inner += '<div class="bubble">';
    if (m.context?.label) inner += `<div class="ctx-chip">📎 ${esc(m.context.label)}</div><br>`;
    if (m.attachment) {
      inner += m.attachment.expired
        ? '<span class="img-expired">انتهت صلاحية الصورة</span>'
        : `<img alt="صورة مرفقة" data-att="${m.attachment.id}" />`;
    }
    if (m.body) inner += `${m.attachment ? "<br>" : ""}${esc(m.body)}`;
    inner += "</div>";
    inner += `<div class="meta"><span>${fmtTime(m.createdAt)}</span>`;
    if (m.topic) inner += `<span class="topic-tag">${esc(TOPIC_LABELS[m.topic] || m.topic)}</span>`;
    if (mine) inner += `<span data-tick="${m.id}">${tickHTML(m.status || "sent")}</span>`;
    inner += "</div>";
    el.innerHTML = inner;
    const img = el.querySelector("img[data-att]");
    if (img) {
      loadProtectedImage(img, `/portal/chat/attachments/${img.dataset.att}`, fetchBlob);
      img.addEventListener("click", () => openLightbox(img.src));
    }
    return el;
  }

  function openLightbox(src) {
    if (!src) return;
    $("lightbox").querySelector("img").src = src;
    $("lightbox").classList.add("open");
  }
  $("lightbox").addEventListener("click", () => $("lightbox").classList.remove("open"));

  function appendMessages(list, { prepend = false } = {}) {
    const stick = nearBottom();
    const frag = document.createDocumentFragment();
    if (prepend) state.lastDay = null;
    for (const m of list) {
      if (state.seenIds.has(m.id)) continue;
      state.seenIds.add(m.id);
      const sep = prepend ? null : daySep(m.createdAt);
      if (sep) frag.appendChild(sep);
      frag.appendChild(messageEl(m));
      if (m.event === "closed") state.closureId = m.id;
      if (m.event === "reopened") state.closureId = null;
      if (!prepend) state.lastId = Math.max(state.lastId, m.id);
      state.oldestId = state.oldestId === null ? m.id : Math.min(state.oldestId, m.id);
    }
    if (prepend) {
      const prevH = box.scrollHeight;
      const anchor = box.querySelector(".load-older");
      box.insertBefore(frag, anchor ? anchor.nextSibling : box.firstChild);
      box.scrollTop += box.scrollHeight - prevH;
    } else {
      box.appendChild(frag);
      if (stick) scrollBottom();
    }
  }

  function refreshTicks() {
    box.querySelectorAll("[data-tick]").forEach((el) => {
      const id = Number(el.dataset.tick);
      el.innerHTML = tickHTML(tickStatus(id, state.meta.staffDeliveredUpTo, state.meta.staffReadUpTo));
    });
  }

  function applyMeta(c) {
    if (!c) return;
    state.meta = c;
    $("handler-line").textContent = c.handlerName ? `المسؤول: ${c.handlerName}` : "سيتم تعيين مسؤول لحسابك قريبًا";
    refreshTicks();
    const closed = c.status === "closed";
    const rated = state.closureId && localStorage.getItem(RATED_KEY + state.closureId);
    $("rating-box").classList.toggle("hidden", !(closed && state.closureId && !rated));
  }

  function ensureOlderButton() {
    let btn = box.querySelector(".load-older");
    if (state.hasMore && !btn) {
      btn = document.createElement("button");
      btn.className = "load-older";
      btn.textContent = "تحميل رسائل أقدم";
      btn.addEventListener("click", loadOlder);
      box.prepend(btn);
    } else if (!state.hasMore && btn) btn.remove();
  }

  async function loadOlder() {
    if (state.oldestId === null) return;
    try {
      const data = await api(`/portal/chat?before=${state.oldestId}`);
      state.hasMore = !!data.hasMore;
      appendMessages(data.messages, { prepend: true });
      ensureOlderButton();
    } catch (e) {
      toast(e.message, true);
    }
  }

  /* ───── load / poll ───── */
  let markReadInFlight = false;
  async function markReadIfNeeded() {
    if (document.hidden || markReadInFlight) return;
    markReadInFlight = true;
    try {
      await api("/portal/chat/read", { method: "POST", body: "{}" });
    } catch {}
    markReadInFlight = false;
  }

  async function load() {
    const data = await api("/portal/chat");
    state.hasMore = !!data.hasMore;
    appendMessages(data.messages);
    applyMeta(data.conversation);
    ensureOlderButton();
    scrollBottom();
    if (data.conversation.unread > 0) markReadIfNeeded();
    applyHours(data.conversation.hours);
  }

  const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const hhmm = (m) => {
    const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "ص" : "م"}`;
  };
  /** الساعات من إعدادات المدير (السيرفر) — ليست ثابتة في الكود. */
  function applyHours(h) {
    if (!h) return;
    const b = $("hours-banner");
    b.textContent = h.isOpen ? "" : `خارج ساعات العمل الآن (${h.openDays.map((d) => DAY_NAMES[d]).join("، ")} — من ${hhmm(h.openMinute)} إلى ${hhmm(h.closeMinute)} بتوقيت القاهرة). اترك رسالتك وسيرد عليك مسؤول حسابك فور بدء الدوام.`;
    b.classList.toggle("hidden", h.isOpen);
    const wa = $("btn-wa");
    if (h.whatsappNumber) {
      wa.href = `https://wa.me/${h.whatsappNumber}?text=${encodeURIComponent("مرحبًا، أنا عميل في هايبر تك")}`;
      wa.style.display = "";
    } else wa.style.display = "none";
  }

  const poller = createPoller(
    async () => {
      const data = await api(`/portal/chat/poll?after=${state.lastId}`);
      $("offline-banner").classList.add("hidden");
      const before = state.lastId;
      const metaChanged = data.conversation.staffReadUpTo !== state.meta.staffReadUpTo || data.conversation.staffDeliveredUpTo !== state.meta.staffDeliveredUpTo;
      // لا نضيف رسائل العميل نفسها المعروضة تفاؤليًا (تُطابق بالـ id بعد الإرسال)
      appendMessages(data.messages);
      applyMeta(data.conversation);
      applyHours(data.conversation.hours);
      if (state.lastId > before) markReadIfNeeded();
      return state.lastId > before || metaChanged;
    },
    { onError: () => $("offline-banner").classList.remove("hidden") },
  );

  /* ───── composer ───── */
  const input = $("input");
  const sendBtn = $("btn-send");
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
    const len = input.value.length;
    const c = $("counter");
    c.textContent = len > 1500 ? `${len} / 2000` : "";
    c.classList.toggle("over", len > 2000);
    updateSendState();
  }
  function updateSendState() {
    sendBtn.disabled = state.sending || (!input.value.trim() && !state.image) || input.value.length > 2000;
  }
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) send();
    }
  });
  sendBtn.addEventListener("click", send);

  // topics
  const chipsEl = $("topic-chips");
  Object.entries(TOPIC_LABELS).forEach(([k, label]) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = label;
    b.dataset.k = k;
    b.addEventListener("click", () => {
      state.topic = state.topic === k ? null : k;
      chipsEl.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.k === state.topic));
    });
    chipsEl.appendChild(b);
  });

  function renderAttachPreview() {
    const p = $("attach-preview");
    p.innerHTML = "";
    if (state.image) {
      const d = document.createElement("div");
      d.className = "item";
      d.innerHTML = `<img src="${state.image}" alt=""><span>صورة</span><button class="x" aria-label="إزالة">✕</button>`;
      d.querySelector(".x").onclick = () => {
        state.image = null;
        renderAttachPreview();
        updateSendState();
      };
      p.appendChild(d);
    }
    if (state.context) {
      const d = document.createElement("div");
      d.className = "item";
      d.innerHTML = `<span>📎 ${esc(state.context.label)}</span><button class="x" aria-label="إزالة">✕</button>`;
      d.querySelector(".x").onclick = () => {
        state.context = null;
        renderAttachPreview();
      };
      p.appendChild(d);
    }
  }

  $("btn-image").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      state.image = await compressImage(f);
      renderAttachPreview();
      updateSendState();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ───── context picker ───── */
  let ctxTab = "order";
  async function loadCtx() {
    const list = $("ctx-list");
    list.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      let items = [];
      if (ctxTab === "order") {
        const raw = asList(await api("/portal/my-orders?limit=20&page=1"));
        // قد تكون دفعات (batch) تحوي items، أو طلبات مباشرة
        raw.forEach((b) => (Array.isArray(b.items) ? b.items : [b]).forEach((o) => o.id && items.push({ id: o.id, label: `طلب ${o.orderNumber || o.id}${o.productName ? " — " + o.productName : ""}` })));
      } else if (ctxTab === "product") {
        items = asList(await api("/portal/products")).slice(0, 60).map((p) => ({ id: p.id, label: p.name || p.productName || `منتج ${p.id}` }));
      } else {
        items = asList(await api("/portal/price-inquiries")).slice(0, 30).map((q) => ({ id: q.id, label: `طلب سعر: ${q.productName || q.id}` }));
      }
      list.innerHTML = "";
      if (!items.length) list.innerHTML = '<div class="empty">لا يوجد عناصر</div>';
      items.forEach((it) => {
        const b = document.createElement("button");
        b.className = "pick-item";
        b.textContent = it.label;
        b.onclick = () => {
          state.context = { type: ctxTab, id: it.id, label: it.label };
          $("ctx-overlay").classList.remove("open");
          renderAttachPreview();
        };
        list.appendChild(b);
      });
    } catch (e) {
      list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }
  $("btn-context").addEventListener("click", () => {
    $("ctx-overlay").classList.add("open");
    loadCtx();
  });
  $("ctx-close").addEventListener("click", () => $("ctx-overlay").classList.remove("open"));
  $("ctx-tabs").addEventListener("click", (e) => {
    const t = e.target.dataset.t;
    if (!t) return;
    ctxTab = t;
    $("ctx-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    loadCtx();
  });

  /* ───── send (optimistic + idempotent retry) ───── */
  function pendingEl(payload) {
    const el = document.createElement("div");
    el.className = "msg mine";
    el.innerHTML = `<div class="bubble">${payload.context ? `<div class="ctx-chip">📎 ${esc(payload.contextLabel)}</div><br>` : ""}${payload.image ? '<img alt="" src="' + payload.image + '"><br>' : ""}${esc(payload.body)}</div><div class="meta"><span>${fmtTime(new Date().toISOString())}</span><span class="st">${tickHTML("pending")}</span></div>`;
    return el;
  }

  async function postPayload(payload, el) {
    try {
      const data = await api("/portal/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          body: payload.body,
          clientMsgId: payload.clientMsgId,
          topic: payload.topic || null,
          image: payload.image || null,
          context: payload.context || null,
        }),
      });
      const real = data.message;
      el.remove();
      state.pending.delete(payload.clientMsgId);
      appendMessages([real]);
      applyMeta(data.conversation);
      poller.wake();
      return true;
    } catch (e) {
      el.classList.add("failed");
      const meta = el.querySelector(".meta");
      meta.innerHTML = `<span class="tick failed">!</span><span>${esc(e.message)}</span>`;
      if (e.status && e.status < 500 && e.status !== 429 && e.status !== 408) {
        // خطأ نهائي (تحقق/صلاحية): لا نعيد المحاولة
        state.pending.delete(payload.clientMsgId);
      } else {
        const retry = document.createElement("button");
        retry.className = "retry-btn";
        retry.textContent = "إعادة المحاولة";
        retry.onclick = () => {
          el.classList.remove("failed");
          meta.innerHTML = `<span>${fmtTime(new Date().toISOString())}</span><span class="st">${tickHTML("pending")}</span>`;
          postPayload(payload, el);
        };
        meta.appendChild(retry);
      }
      return false;
    }
  }

  async function send() {
    const body = input.value.trim();
    if (!body && !state.image) return;
    const payload = {
      clientMsgId: newId(), // يُعاد استخدامه عند أي retry → السيرفر لا يكرر الرسالة
      body,
      topic: state.topic,
      image: state.image,
      context: state.context ? { type: state.context.type, id: state.context.id } : null,
      contextLabel: state.context?.label,
    };
    const el = pendingEl(payload);
    box.appendChild(el);
    state.pending.set(payload.clientMsgId, { el, payload });
    scrollBottom();
    input.value = "";
    state.image = null;
    state.context = null;
    renderAttachPreview();
    autoGrow();
    state.sending = true;
    updateSendState();
    await postPayload(payload, el);
    state.sending = false;
    updateSendState();
    input.focus();
  }

  /* ───── rating ───── */
  let stars = 0;
  $("stars").addEventListener("click", (e) => {
    const v = Number(e.target.dataset.v);
    if (!v) return;
    stars = v;
    $("stars").querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) <= v));
  });
  $("rating-send").addEventListener("click", async () => {
    if (!stars) return toast("اختر عدد النجوم أولًا", true);
    try {
      await api("/portal/chat/rating", { method: "POST", body: JSON.stringify({ stars, comment: $("rating-comment").value.trim() || null }) });
      toast("شكرًا لتقييمك 🙏");
    } catch (e) {
      if (e.status !== 409) return toast(e.message, true);
    }
    if (state.closureId) localStorage.setItem(RATED_KEY + state.closureId, "1");
    $("rating-box").classList.add("hidden");
  });

  /* ───── boot (deep link: ?ctx=product:12&topic=product) ───── */
  async function boot() {
    if (!getSession()?.token) return redirectToLogin();
    const q = new URLSearchParams(location.search);
    try {
      await load();
    } catch (e) {
      if (e.status !== 401) toast(e.message, true);
      return;
    }
    const topic = q.get("topic");
    if (topic && TOPIC_LABELS[topic]) chipsEl.querySelector(`[data-k="${topic}"]`)?.click();
    const ctx = (q.get("ctx") || "").split(":");
    if (ctx.length === 2 && ["order", "product", "price_inquiry"].includes(ctx[0]) && Number(ctx[1]) > 0) {
      const label = q.get("label") || `${ctx[0] === "order" ? "طلب" : ctx[0] === "product" ? "منتج" : "طلب سعر"} #${ctx[1]}`;
      state.context = { type: ctx[0], id: Number(ctx[1]), label };
      renderAttachPreview();
    }
    poller.start();
    autoGrow();
    window.ChatPush.init({ api, prefix: "/portal/chat", button: $("btn-push"), onMessage: (m) => toast(m) });
  }
  window.addEventListener("online", () => $("offline-banner").classList.add("hidden"));
  window.addEventListener("offline", () => $("offline-banner").classList.remove("hidden"));
  boot();
})();
