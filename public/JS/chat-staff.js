/** @format */
/**
 * شاشة الموظف لمحادثات العملاء: صندوق وارد + محادثة + (للمدير) صلاحيات/ردود جاهزة/تقارير.
 * الصلاحيات الفعلية يفرضها السيرفر؛ الواجهة فقط تخفي ما لا ينفع.
 */
(function () {
  "use strict";
  const { esc, newId, fmtTime, fmtDay, fmtRelative, tickHTML, tickStatus, createPoller, compressImage, loadProtectedImage, EVENT_ICONS, TOPIC_LABELS } = window.ChatUI;
  const $ = (id) => document.getElementById(id);
  const api = (path, options = {}) => window.HyperTechAuth.request(path, options);
  const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });

  const MODE_LABELS = { manager: "مدير (يدير ويرد)", agent: "يرد على العملاء", observer: "مراقب (قراءة فقط)", none: "لا وصول" };

  const S = {
    mode: "none",
    me: null,
    filter: "all",
    q: "",
    page: 1,
    items: [],
    hasMore: false,
    current: null, // conversation view
    lastId: 0,
    seen: new Set(),
    lastDay: null,
    image: null,
    quick: null,
    inboxSig: "",
    sending: false,
  };

  function toast(msg, bad) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.toggle("bad", !!bad);
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  }
  const token = () => window.HyperTechAuth.session()?.token;
  async function fetchBlob(url) {
    const res = await fetch(`/api/v1${url}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw Object.assign(new Error("img"), { status: res.status });
    return res.blob();
  }
  function openModal(html) {
    $("modal-body").innerHTML = html;
    $("modal").classList.add("open");
  }
  const closeModal = () => $("modal").classList.remove("open");
  $("modal").addEventListener("click", (e) => e.target === $("modal") && closeModal());
  $("lightbox").addEventListener("click", () => $("lightbox").classList.remove("open"));

  /* ───────────────── views / tabs ───────────────── */
  function showView(v) {
    for (const name of ["inbox", "reports", "access", "quick", "settings"]) {
      $(`view-${name}`).style.display = name === v ? (name === "inbox" ? "grid" : "block") : "none";
    }
    $("view-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    if (v === "reports") renderReports(30);
    if (v === "access") renderAccess();
    if (v === "quick") renderQuick();
    if (v === "settings") renderSettings();
  }
  $("view-tabs").addEventListener("click", (e) => e.target.dataset.v && showView(e.target.dataset.v));

  /* ───────────────── inbox ───────────────── */
  function convItem(c) {
    const el = document.createElement("div");
    el.className = `conv-item${S.current?.id === c.id ? " active" : ""}`;
    el.dataset.id = c.id;
    const tags = [];
    if (c.escalated) tags.push('<span class="tag esc">مُصعَّدة</span>');
    if (!c.handler) tags.push('<span class="tag free">بدون مسؤول</span>');
    else tags.push(`<span class="tag">${esc(c.handler.name)}</span>`);
    if (c.status === "closed") tags.push('<span class="tag">مغلقة</span>');
    el.innerHTML = `<div class="row1"><span class="name">${esc(c.customerName)}</span><span class="time">${fmtRelative(c.lastMessageAt)}</span></div>
      <div class="preview">${c.lastSenderType === "staff" ? "الفريق: " : ""}${esc(c.lastMessagePreview || "—")}</div>
      <div class="row3">${c.customerCompany ? `<span>${esc(c.customerCompany)}</span>` : ""}${tags.join("")}${c.staffUnread ? `<span class="unread-dot" style="margin-inline-start:auto">${c.staffUnread}</span>` : ""}</div>`;
    el.addEventListener("click", () => openConversation(c.id));
    return el;
  }

  function renderInbox() {
    const list = $("inbox-list");
    list.innerHTML = "";
    if (!S.items.length) list.innerHTML = '<div class="empty">لا توجد محادثات</div>';
    S.items.forEach((c) => list.appendChild(convItem(c)));
    $("inbox-more").style.display = S.hasMore ? "block" : "none";
  }

  async function loadInbox({ append = false } = {}) {
    const params = new URLSearchParams({ filter: S.filter, q: S.q, page: String(S.page) });
    const data = await api(`/chat/inbox?${params}`);
    S.items = append ? S.items.concat(data.items) : data.items;
    S.hasMore = data.hasMore;
    renderInbox();
    return data.items;
  }

  const inboxPoller = createPoller(
    async () => {
      // نحدّث الصفحة الأولى فقط (ما لم يطلب المستخدم المزيد)
      if (S.page > 1) return false;
      const items = await api(`/chat/inbox?${new URLSearchParams({ filter: S.filter, q: S.q, page: "1" })}`);
      const sig = items.items.map((c) => `${c.id}:${c.lastMessageId}:${c.staffUnread}:${c.status}:${c.escalated}:${c.handler?.userId ?? 0}`).join("|");
      const changed = sig !== S.inboxSig;
      S.inboxSig = sig;
      if (changed) {
        S.items = items.items;
        S.hasMore = items.hasMore;
        renderInbox();
      }
      refreshSummary();
      return changed;
    },
    { minMs: 5000, maxMs: 30000 },
  );

  let qTimer;
  $("q").addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      S.q = $("q").value.trim();
      S.page = 1;
      loadInbox().catch((e) => toast(e.message, true));
    }, 300);
  });
  $("filter").addEventListener("change", () => {
    S.filter = $("filter").value;
    S.page = 1;
    loadInbox().catch((e) => toast(e.message, true));
  });
  $("inbox-more").addEventListener("click", () => {
    S.page += 1;
    loadInbox({ append: true }).catch((e) => toast(e.message, true));
  });

  async function refreshSummary() {
    try {
      const s = await api("/chat/summary");
      const b = $("total-unread");
      b.textContent = s.unreadConversations;
      b.style.display = s.unreadConversations ? "inline-flex" : "none";
      document.title = (s.unreadConversations ? `(${s.unreadConversations}) ` : "") + "هايبر تك — محادثات العملاء";
    } catch {}
  }

  /* ───────────────── conversation ───────────────── */
  const box = $("messages");
  const nearBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const scrollBottom = () => (box.scrollTop = box.scrollHeight);

  function msgEl(m) {
    if (m.kind === "system" || m.senderType === "system") {
      const el = document.createElement("div");
      el.className = `sys-event${m.isInternal ? " internal" : ""}`;
      el.dataset.id = m.id;
      el.textContent = `${EVENT_ICONS[m.event] || "ℹ️"} ${m.body}${m.isInternal ? " (داخلي)" : ""}`;
      return el;
    }
    const mine = m.senderType === "staff";
    const el = document.createElement("div");
    el.className = `msg ${mine ? "mine" : "theirs"}${m.isInternal ? " internal" : ""}${m.hidden ? " hidden-msg" : ""}`;
    el.dataset.id = m.id;
    let h = "";
    if (m.senderName) h += `<div class="sender">${esc(m.senderName)}${m.isInternal ? " — ملاحظة داخلية 🔒" : ""}</div>`;
    h += '<div class="bubble">';
    if (m.context?.label) h += `<div class="ctx-chip">📎 ${esc(m.context.label)}</div><br>`;
    if (m.attachment) h += m.attachment.expired ? '<span class="img-expired">انتهت صلاحية الصورة</span>' : `<img alt="صورة" data-att="${m.attachment.id}">`;
    if (m.body) h += `${m.attachment ? "<br>" : ""}${esc(m.body)}`;
    h += "</div>";
    h += `<div class="meta"><span>${fmtTime(m.createdAt)}</span>`;
    if (m.topic) h += `<span class="topic-tag">${esc(TOPIC_LABELS[m.topic] || m.topic)}</span>`;
    if (mine && !m.isInternal) h += `<span data-tick="${m.id}">${tickHTML(m.status || "sent")}</span>`;
    if (S.mode === "manager" && !m.hidden && m.senderType !== "system") h += `<button class="hide-btn" data-hide="${m.id}">إخفاء</button>`;
    if (m.hidden) h += "<span>(مخفية)</span>";
    h += "</div>";
    el.innerHTML = h;
    const img = el.querySelector("img[data-att]");
    if (img) {
      loadProtectedImage(img, `/chat/attachments/${img.dataset.att}`, fetchBlob);
      img.addEventListener("click", () => {
        $("lightbox").querySelector("img").src = img.src;
        $("lightbox").classList.add("open");
      });
    }
    const hb = el.querySelector("[data-hide]");
    if (hb) hb.addEventListener("click", () => hideMessage(m.id));
    return el;
  }

  function appendMsgs(list, { prepend = false } = {}) {
    const stick = nearBottom();
    const frag = document.createDocumentFragment();
    for (const m of list) {
      if (S.seen.has(m.id)) {
        // رسالة موجودة: ربما تغيّرت (إخفاء)
        const old = box.querySelector(`[data-id="${m.id}"]`);
        if (old && m.hidden && !old.classList.contains("hidden-msg")) old.replaceWith(msgEl(m));
        continue;
      }
      S.seen.add(m.id);
      if (!prepend) {
        const label = fmtDay(m.createdAt);
        if (S.lastDay !== label) {
          S.lastDay = label;
          const sep = document.createElement("div");
          sep.className = "day-sep";
          sep.textContent = label;
          frag.appendChild(sep);
        }
        S.lastId = Math.max(S.lastId, m.id);
      }
      frag.appendChild(msgEl(m));
    }
    if (prepend) {
      const prev = box.scrollHeight;
      box.prepend(frag);
      box.scrollTop += box.scrollHeight - prev;
    } else {
      box.appendChild(frag);
      if (stick) scrollBottom();
    }
  }

  function refreshTicks() {
    if (!S.current) return;
    box.querySelectorAll("[data-tick]").forEach((el) => {
      el.innerHTML = tickHTML(tickStatus(Number(el.dataset.tick), S.current.customerDeliveredUpTo, S.current.customerReadUpTo));
    });
  }

  function applyConversation(c) {
    S.current = c;
    $("c-name").textContent = c.customerName;
    const seen = c.customerLastSeenAt ? ` · آخر ظهور ${fmtRelative(c.customerLastSeenAt)}` : "";
    $("c-sub").textContent = `${c.customerCompany || ""}${c.handler ? ` · المسؤول: ${c.handler.name}` : " · بدون مسؤول"}${seen}`;
    const canReply = c.access.canReply;
    const closed = c.status === "closed";
    $("btn-claim").style.display = canReply && (!c.handler || (c.handler.userId !== S.me && c.access.canManage)) && !closed ? "" : "none";
    $("btn-transfer").style.display = c.access.canManage && !closed ? "" : "none";
    $("btn-close").style.display = canReply && !closed ? "" : "none";
    $("btn-reopen").style.display = canReply && closed ? "" : "none";
    const banner = $("c-banner");
    let text = "";
    if (c.access.readOnly) text = "وضع المراقبة: قراءة فقط — فتحك لهذه المحادثة مسجَّل في سجل التدقيق.";
    else if (closed) text = "المحادثة مغلقة. يمكنك إضافة ملاحظات داخلية، أو إعادة الفتح للرد على العميل.";
    else if (c.escalated) text = "⏫ هذه المحادثة مُصعَّدة لتأخّر الرد.";
    banner.textContent = text;
    banner.classList.toggle("hidden", !text);
    $("composer").style.display = c.access.readOnly ? "none" : "";
    refreshTicks();
  }

  async function openConversation(id) {
    try {
      detailPoller.stop();
      const data = await api(`/chat/conversations/${id}`);
      S.seen = new Set();
      S.lastId = 0;
      S.lastDay = null;
      box.innerHTML = "";
      $("pane-empty").style.display = "none";
      $("pane-body").style.display = "flex";
      $("view-inbox").classList.add("show-pane");
      applyConversation(data.conversation);
      if (data.hasMore) {
        const b = document.createElement("button");
        b.className = "load-older";
        b.textContent = "تحميل رسائل أقدم";
        b.onclick = async () => {
          const oldest = Math.min(...[...S.seen]);
          const older = await api(`/chat/conversations/${id}?before=${oldest}`);
          appendMsgs(older.messages, { prepend: true });
          if (!older.hasMore) b.remove();
        };
        box.appendChild(b);
      }
      appendMsgs(data.messages);
      if (data.lastRating) {
        const r = document.createElement("div");
        r.className = "sys-event";
        r.textContent = `⭐ آخر تقييم: ${data.lastRating.stars}/5${data.lastRating.comment ? " — " + data.lastRating.comment : ""}`;
        box.appendChild(r);
      }
      scrollBottom();
      if (data.conversation.access.canReply && data.conversation.staffUnread > 0) {
        post(`/chat/conversations/${id}/read`).then(() => {
          const it = S.items.find((x) => x.id === id);
          if (it) {
            it.staffUnread = 0;
            renderInbox();
          }
          refreshSummary();
        }).catch(() => {});
      }
      renderInbox();
      detailPoller.start();
      $("input").focus();
    } catch (e) {
      toast(e.message, true);
    }
  }

  const detailPoller = createPoller(
    async () => {
      if (!S.current) return false;
      const id = S.current.id;
      const data = await api(`/chat/conversations/${id}/poll?after=${S.lastId}`);
      if (!S.current || S.current.id !== id) return false;
      const before = S.lastId;
      appendMsgs(data.messages);
      applyConversation(data.conversation);
      if (S.lastId > before && data.conversation.access.canReply && !document.hidden) post(`/chat/conversations/${id}/read`).catch(() => {});
      return S.lastId > before;
    },
    { minMs: 3000, maxMs: 15000 },
  );

  $("btn-back").addEventListener("click", () => {
    $("view-inbox").classList.remove("show-pane");
    detailPoller.stop();
    S.current = null;
  });

  /* ───── actions ───── */
  async function act(path, body, okMsg) {
    try {
      await post(path, body);
      if (okMsg) toast(okMsg);
      detailPoller.wake();
      inboxPoller.wake();
    } catch (e) {
      toast(e.message, true);
    }
  }
  $("btn-claim").addEventListener("click", () => act(`/chat/conversations/${S.current.id}/claim`, {}, "تم الاستلام"));
  $("btn-close").addEventListener("click", () => {
    openModal(`<h3>إغلاق المحادثة</h3><p>سيصل العميل طلب تقييم. يمكن إعادة الفتح في أي وقت.</p>
      <button class="btn danger" id="m-ok">إغلاق المحادثة</button> <button class="btn" id="m-cancel">إلغاء</button>`);
    $("m-cancel").onclick = closeModal;
    $("m-ok").onclick = async () => {
      closeModal();
      await act(`/chat/conversations/${S.current.id}/close`, {}, "تم الإغلاق");
    };
  });
  $("btn-reopen").addEventListener("click", () => act(`/chat/conversations/${S.current.id}/reopen`, {}, "أُعيد فتح المحادثة"));
  $("btn-transfer").addEventListener("click", async () => {
    try {
      const users = await api("/chat/assignable-users");
      openModal(`<h3>تحويل المحادثة</h3>
        <select class="field" id="m-user">${users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select>
        <div style="margin-top:12px"><button class="btn primary" id="m-ok">تحويل</button> <button class="btn" id="m-cancel">إلغاء</button></div>`);
      $("m-cancel").onclick = closeModal;
      $("m-ok").onclick = async () => {
        const toUserId = Number($("m-user").value);
        closeModal();
        await act(`/chat/conversations/${S.current.id}/transfer`, { toUserId }, "تم التحويل");
      };
    } catch (e) {
      toast(e.message, true);
    }
  });
  function hideMessage(id) {
    openModal(`<h3>إخفاء رسالة مخالفة</h3><p>تبقى الرسالة الأصلية في السجل للتدقيق، ويرى العميل «تم إخفاء هذه الرسالة».</p>
      <textarea class="field" id="m-reason" rows="2" placeholder="سبب الإخفاء (إلزامي)"></textarea>
      <div style="margin-top:12px"><button class="btn danger" id="m-ok">إخفاء</button> <button class="btn" id="m-cancel">إلغاء</button></div>`);
    $("m-cancel").onclick = closeModal;
    $("m-ok").onclick = async () => {
      const reason = $("m-reason").value.trim();
      if (reason.length < 3) return toast("اكتب السبب", true);
      closeModal();
      await act(`/chat/messages/${id}/hide`, { reason }, "تم الإخفاء");
      const old = box.querySelector(`[data-id="${id}"]`);
      if (old) old.classList.add("hidden-msg");
    };
  }

  /* ───── composer ───── */
  const input = $("input");
  const sendBtn = $("btn-send");
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
    const len = input.value.length;
    $("counter").textContent = len > 1500 ? `${len} / 2000` : "";
    sendBtn.disabled = S.sending || (!input.value.trim() && !S.image);
    // "/" يفتح الردود الجاهزة
    if (input.value.startsWith("/")) showQuick(input.value.slice(1));
    else if (!$("qr-panel").classList.contains("pinned")) $("qr-panel").classList.add("hidden");
  }
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!sendBtn.disabled) send();
    }
  });
  sendBtn.addEventListener("click", send);
  $("internal").addEventListener("change", () => {
    $("note-toggle").classList.toggle("note-on", $("internal").checked);
    if ($("internal").checked) {
      S.image = null;
      renderAttach();
    }
  });
  $("btn-image").addEventListener("click", () => {
    if ($("internal").checked) return toast("الملاحظة الداخلية نصية فقط", true);
    $("file").click();
  });
  $("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      S.image = await compressImage(f);
      renderAttach();
      autoGrow();
    } catch (err) {
      toast(err.message, true);
    }
  });
  function renderAttach() {
    const p = $("attach-preview");
    p.innerHTML = "";
    if (S.image) {
      const d = document.createElement("div");
      d.className = "item";
      d.innerHTML = `<img src="${S.image}" alt=""><span>صورة</span><button class="x">✕</button>`;
      d.querySelector(".x").onclick = () => {
        S.image = null;
        renderAttach();
        autoGrow();
      };
      p.appendChild(d);
    }
  }

  async function send() {
    if (!S.current) return;
    const body = input.value.trim();
    if (!body && !S.image) return;
    const internal = $("internal").checked;
    // فشل سابق لنفس المحتوى → نعيد نفس clientMsgId فلا تتكرر الرسالة لو كانت وصلت فعلًا
    const sig = `${S.current.id}|${internal}|${body}|${S.image ? S.image.length : 0}`;
    const clientMsgId = S.attempt && S.attempt.sig === sig ? S.attempt.id : newId();
    S.attempt = { sig, id: clientMsgId };
    const payload = { body, clientMsgId, internal, image: S.image };
    S.sending = true;
    sendBtn.disabled = true;
    try {
      const data = await api(`/chat/conversations/${S.current.id}/messages`, { method: "POST", body: JSON.stringify(payload) });
      S.attempt = null;
      input.value = "";
      S.image = null;
      renderAttach();
      appendMsgs([data.message]);
      scrollBottom();
      detailPoller.wake();
      inboxPoller.wake();
    } catch (e) {
      // نُبقي النص في الخانة؛ إعادة الضغط تعيد نفس clientMsgId (idempotent)
      detailPoller.wake();
      toast(e.message, true);
    }
    S.sending = false;
    autoGrow();
    input.focus();
  }

  /* ───── quick replies ───── */
  async function ensureQuick() {
    if (!S.quick) S.quick = await api("/chat/quick-replies");
    return S.quick;
  }
  async function showQuick(filter = "") {
    try {
      const list = (await ensureQuick()).filter((q) => !filter || q.title.includes(filter) || q.body.includes(filter));
      const panel = $("qr-panel");
      panel.innerHTML = list.length ? "" : '<div class="empty">لا توجد ردود جاهزة</div>';
      list.forEach((q) => {
        const d = document.createElement("div");
        d.className = "qr";
        d.innerHTML = `<b>${esc(q.title)}</b>${esc(q.body)}`;
        d.onclick = () => {
          input.value = q.body;
          panel.classList.add("hidden");
          panel.classList.remove("pinned");
          autoGrow();
          input.focus();
        };
        panel.appendChild(d);
      });
      panel.classList.remove("hidden");
    } catch (e) {
      toast(e.message, true);
    }
  }
  $("btn-qr").addEventListener("click", () => {
    const panel = $("qr-panel");
    if (!panel.classList.contains("hidden")) {
      panel.classList.add("hidden");
      panel.classList.remove("pinned");
    } else {
      panel.classList.add("pinned");
      showQuick("");
    }
  });

  /* ───────────────── manager: quick replies admin ───────────────── */
  async function renderQuick() {
    const v = $("view-quick");
    v.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      S.quick = null;
      const list = await ensureQuick();
      v.innerHTML = `<h2>الردود الجاهزة</h2>
        <div style="display:grid;gap:8px;max-width:560px;margin-bottom:18px">
          <input class="field" id="qr-title" maxlength="40" placeholder="العنوان (مثال: ساعات العمل)">
          <textarea class="field" id="qr-body" rows="3" maxlength="2000" placeholder="نص الرد"></textarea>
          <button class="btn primary" id="qr-add" style="justify-self:start">إضافة</button>
        </div>
        <table><thead><tr><th>العنوان</th><th>النص</th><th></th></tr></thead><tbody>
        ${list.map((q) => `<tr><td>${esc(q.title)}</td><td>${esc(q.body)}</td><td><button class="btn danger" data-del="${q.id}">حذف</button></td></tr>`).join("") || '<tr><td colspan="3" class="empty">لا توجد ردود</td></tr>'}
        </tbody></table>`;
      $("qr-add").onclick = async () => {
        try {
          await post("/chat/quick-replies", { title: $("qr-title").value.trim(), body: $("qr-body").value.trim() });
          toast("تمت الإضافة");
          renderQuick();
        } catch (e) {
          toast(e.message, true);
        }
      };
      v.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          try {
            await api(`/chat/quick-replies/${b.dataset.del}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
            renderQuick();
          } catch (e) {
            toast(e.message, true);
          }
        }),
      );
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  /* ───────────────── manager: settings (hours / escalation / holidays) ───────────────── */
  const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const fromTime = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  async function renderSettings() {
    const v = $("view-settings");
    v.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      const c = await api("/chat/settings");
      const holidays = new Set(c.holidays);
      const paintHolidays = () => {
        $("st-holiday-list").innerHTML = [...holidays].sort().map((d) => `<span class="tag" style="margin:2px">${esc(d)} <button class="x" data-rm="${d}" style="background:none;border:none;color:var(--c-bad);cursor:pointer">✕</button></span>`).join("") || '<span style="color:var(--c-muted)">لا توجد إجازات مضافة</span>';
        v.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { holidays.delete(b.dataset.rm); paintHolidays(); }));
      };
      v.innerHTML = `<h2>إعدادات الشات</h2>
        <p style="color:var(--c-muted);font-size:14px">كل ما هنا يسري فورًا على الرد التلقائي، وحساب التصعيد، ولافتة «خارج ساعات العمل» عند العميل. التوقيت: القاهرة.</p>
        <div style="display:grid;gap:18px;max-width:640px">
          <section><h3>أيام وساعات العمل</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">${DAYS.map((d, i) => `<label><input type="checkbox" data-day="${i}" ${c.openDays.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><label>من <input type="time" class="field" id="st-open" value="${toTime(c.openMinute)}" style="width:auto"></label><label>إلى <input type="time" class="field" id="st-close" value="${toTime(c.closeMinute)}" style="width:auto"></label></div>
          </section>
          <section><h3>إجازات رسمية</h3>
            <div style="display:flex;gap:8px"><input type="date" class="field" id="st-holiday" style="width:auto"><button class="btn" id="st-holiday-add">إضافة</button></div>
            <div id="st-holiday-list" style="margin-top:8px"></div>
          </section>
          <section><h3>التصعيد</h3>
            <label>صعّد للمدير بعد <input type="number" class="field" id="st-esc" min="1" max="1440" value="${c.escalationMinutes}" style="width:90px;display:inline-block"> دقيقة <b>عمل</b> بدون رد (الوقت خارج الدوام والإجازات لا يُحسب)</label>
          </section>
          <section><h3>الرد التلقائي خارج الدوام</h3>
            <label><input type="checkbox" id="st-auto" ${c.autoReplyEnabled ? "checked" : ""}> مفعّل (مرة كل 6 ساعات لكل عميل)</label>
            <textarea class="field" id="st-auto-text" rows="3" maxlength="500" style="margin-top:8px">${esc(c.autoReplyText)}</textarea>
          </section>
          <section><h3>واتساب (مجاني)</h3>
            <p style="color:var(--c-muted);font-size:13px;margin:0 0 6px">يظهر للعميل زر «واتساب» يفتح محادثة مباشرة على رقمك (wa.me). لا يتطلب WhatsApp Business API المدفوع.</p>
            <input class="field" id="st-wa" placeholder="مثال: 201001234567 (أرقام فقط بصيغة دولية بدون +)" value="${esc(c.whatsappNumber || "")}" style="max-width:360px">
          </section>
          <div><button class="btn primary" id="st-save">حفظ الإعدادات</button></div>
        </div>`;
      paintHolidays();
      $("st-holiday-add").onclick = () => {
        const d = $("st-holiday").value;
        if (d) { holidays.add(d); $("st-holiday").value = ""; paintHolidays(); }
      };
      $("st-save").onclick = async () => {
        const body = {
          openDays: [...v.querySelectorAll("[data-day]")].filter((x) => x.checked).map((x) => Number(x.dataset.day)),
          openMinute: fromTime($("st-open").value || "09:00"),
          closeMinute: fromTime($("st-close").value || "17:00"),
          escalationMinutes: Number($("st-esc").value),
          autoReplyEnabled: $("st-auto").checked,
          autoReplyText: $("st-auto-text").value.trim(),
          holidays: [...holidays],
          whatsappNumber: $("st-wa").value.trim() || null,
        };
        try {
          await api("/chat/settings", { method: "PUT", body: JSON.stringify(body) });
          toast("تم حفظ الإعدادات ✅");
        } catch (e) {
          toast(e.message, true);
        }
      };
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  /* ───────────────── manager: who can reply ───────────────── */
  async function renderAccess() {
    const v = $("view-access");
    v.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      const data = await api("/chat/staff-access");
      v.innerHTML = `<h2>من يرد على العملاء؟</h2>
        <p style="color:var(--c-muted);font-size:14px">حدّد لكل موظف دوره في الشات. «الافتراضي» يعتمد على وظيفته. التغيير يسري فورًا ويُسجَّل في سجل التدقيق.</p>
        <table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>الافتراضي</th><th>الصلاحية في الشات</th></tr></thead><tbody>
        ${data.users
          .map(
            (u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${MODE_LABELS[u.defaultMode]}</td>
            <td><select class="field" data-user="${u.id}" ${u.id === S.me ? "disabled title=\"لا يمكنك تعديل صلاحيتك\"" : ""}>
              <option value="">افتراضي (${MODE_LABELS[u.defaultMode]})</option>
              ${data.modes.map((m) => `<option value="${m}" ${u.override === m ? "selected" : ""}>${MODE_LABELS[m]}</option>`).join("")}
            </select></td></tr>`,
          )
          .join("")}
        </tbody></table>`;
      v.querySelectorAll("select[data-user]").forEach((sel) =>
        sel.addEventListener("change", async () => {
          try {
            await api(`/chat/staff-access/${sel.dataset.user}`, { method: "PUT", body: JSON.stringify({ mode: sel.value || null }) });
            toast("تم الحفظ");
          } catch (e) {
            toast(e.message, true);
            renderAccess();
          }
        }),
      );
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  /* ───────────────── reports ───────────────── */
  const fmtMin = (m) => {
    if (m === null || m === undefined) return "—";
    const n = Number(m);
    if (n < 60) return `${n.toFixed(n < 10 ? 1 : 0)} د`;
    return `${(n / 60).toFixed(1)} س`;
  };
  async function renderReports(days) {
    const v = $("view-reports");
    v.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try {
      const r = await api(`/chat/reports?days=${days}`);
      const t = r.totals;
      const dist = [1, 2, 3, 4, 5].map((s) => ({ s, n: r.ratingDistribution.find((d) => Number(d.stars) === s)?.n || 0 }));
      const maxN = Math.max(1, ...dist.map((d) => d.n));
      const o = r.responseTime.overall;
      v.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h2>تقارير الأداء</h2>
        <select class="field" id="rp-days" style="width:auto"><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يوم</option><option value="90">آخر 90 يوم</option><option value="365">آخر سنة</option></select></div>
        <div class="kpis">
          <div class="kpi"><div class="v">${t.open_conversations}</div><div class="l">محادثات مفتوحة</div></div>
          <div class="kpi"><div class="v">${t.closed_conversations}</div><div class="l">محادثات مغلقة</div></div>
          <div class="kpi"><div class="v">${t.customer_messages}</div><div class="l">رسائل العملاء</div></div>
          <div class="kpi"><div class="v">${t.staff_messages}</div><div class="l">ردود الفريق</div></div>
          <div class="kpi"><div class="v">${fmtMin(o?.median_minutes)}</div><div class="l">وسيط زمن الرد الأول</div></div>
          <div class="kpi"><div class="v">${fmtMin(o?.avg_minutes)}</div><div class="l">متوسط زمن الرد</div></div>
          <div class="kpi"><div class="v">${t.escalations}</div><div class="l">حالات تصعيد</div></div>
          <div class="kpi"><div class="v">${t.avg_stars ?? "—"}</div><div class="l">متوسط التقييم (${t.ratings_count})</div></div>
        </div>
        <h3>توزيع التقييمات</h3>
        ${dist.map((d) => `<div class="bar-row"><span style="width:44px">${d.s} ★</span><div class="bar" style="width:${(d.n / maxN) * 60}%;min-width:2px"></div><span>${d.n}</span></div>`).join("")}
        <h3 style="margin-top:22px">الأداء لكل موظف</h3>
        <table><thead><tr><th>الموظف</th><th>محادثات أُجيب عنها</th><th>وسيط زمن الرد</th><th>متوسط زمن الرد</th></tr></thead><tbody>
        ${r.responseTime.perAgent.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.answered}</td><td>${fmtMin(a.median_minutes)}</td><td>${fmtMin(a.avg_minutes)}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">لا بيانات</td></tr>'}
        </tbody></table>
        <p style="color:var(--c-muted);font-size:12px;margin-top:14px">زمن الرد بالدقائق الفعلية (يشمل خارج ساعات العمل). التصعيد يُحسب بدقائق العمل فقط.</p>`;
      $("rp-days").value = String(days);
      $("rp-days").onchange = () => renderReports(Number($("rp-days").value));
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  /* ───────────────── boot ───────────────── */
  async function boot() {
    await window.HyperTechAuth.ready;
    S.me = window.HyperTechAuth.user?.id ?? window.HyperTechAuth.user?.userId ?? null;
    try {
      const s = await api("/chat/summary");
      S.mode = s.mode;
    } catch (e) {
      document.body.innerHTML = `<div class="pane-empty" style="height:100vh;flex-direction:column;gap:10px"><h2>ليس لديك صلاحية الوصول للمحادثات</h2><p>اطلب من مدير المبيعات تفعيل صلاحيتك.</p><a href="index.html">→ لوحة التحكم</a></div>`;
      return;
    }
    $("mode-line").textContent = `· ${MODE_LABELS[S.mode]}`;
    if (S.mode === "manager") {
      ["tab-reports", "tab-access", "tab-quick", "tab-settings"].forEach((id) => ($(id).style.display = ""));
    } else if (S.mode === "observer") {
      $("tab-reports").style.display = "";
    }
    try {
      await loadInbox();
      S.inboxSig = S.items.map((c) => `${c.id}:${c.lastMessageId}:${c.staffUnread}:${c.status}:${c.escalated}:${c.handler?.userId ?? 0}`).join("|");
    } catch (e) {
      toast(e.message, true);
    }
    refreshSummary();
    inboxPoller.start();
    window.ChatPush.init({ api, prefix: "/chat", button: $("btn-push"), onMessage: (m) => toast(m) });
    const openId = Number(new URLSearchParams(location.search).get("c"));
    if (openId) openConversation(openId);
  }
  boot();
})();
