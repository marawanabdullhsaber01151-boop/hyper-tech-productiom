/** @format */
/**
 * أدوات مشتركة بين شاشة العميل وشاشة الموظف للشات.
 * - تحديث تكيّفي (adaptive polling): سريع وقت النشاط، بطيء وقت الهدوء،
 *   ومتوقف تمامًا والتبويب مخفي. مناسب لـ Vercel serverless (بدون sockets).
 * - ضغط الصور في المتصفح قبل الرفع (الحد 600KB).
 * - تحميل الصور بتوكن المصادقة (لأن <img src> ما يرسل Authorization).
 */
(function () {
  "use strict";

  const MAX_IMAGE_BYTES = 600 * 1024;

  const esc = (value) => {
    const d = document.createElement("div");
    d.textContent = value ?? "";
    return d.innerHTML;
  };

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback (v4-shaped) للمتصفحات القديمة
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
  }

  function fmtDay(iso) {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date();
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "اليوم";
    if (d.toDateString() === y.toDateString()) return "أمس";
    return d.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });
  }

  function fmtRelative(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "الآن";
    if (m < 60) return `منذ ${m} د`;
    const h = Math.floor(m / 60);
    if (h < 24) return `منذ ${h} س`;
    return new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
  }

  /** ✓ مرسلة، ✓✓ وصلت، ✓✓ (زرقاء) مقروءة */
  function tickHTML(status) {
    if (status === "read") return '<span class="tick read" title="تمت القراءة">✓✓</span>';
    if (status === "delivered") return '<span class="tick" title="وصلت">✓✓</span>';
    if (status === "pending") return '<span class="tick pending" title="جارٍ الإرسال">🕓</span>';
    if (status === "failed") return '<span class="tick failed" title="فشل الإرسال">!</span>';
    return '<span class="tick" title="أُرسلت">✓</span>';
  }

  function tickStatus(id, deliveredUpTo, readUpTo) {
    if (id <= readUpTo) return "read";
    if (id <= deliveredUpTo) return "delivered";
    return "sent";
  }

  /**
   * Poller تكيّفي. tick() يرجّع true لو فيه جديد (يرجّع التردد للأسرع).
   */
  function createPoller(tick, opts = {}) {
    const minMs = opts.minMs ?? 3000;
    const maxMs = opts.maxMs ?? 20000;
    let delay = minMs;
    let timer = null;
    let running = false;
    let inFlight = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!running) return;
      timer = setTimeout(run, delay);
    };
    async function run() {
      if (!running) return;
      if (document.hidden || inFlight) return schedule();
      inFlight = true;
      try {
        const changed = await tick();
        delay = changed ? minMs : Math.min(maxMs, Math.round(delay * 1.4));
      } catch (err) {
        // انقطاع شبكة/خادم: نبطّئ بدل ما نضغط على السيرفر
        delay = Math.min(maxMs * 2, Math.round(delay * 2));
        if (opts.onError) opts.onError(err);
      } finally {
        inFlight = false;
        schedule();
      }
    }
    const wake = () => {
      delay = minMs;
      if (running && !document.hidden) {
        clearTimeout(timer);
        timer = setTimeout(run, 0);
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return {
      start() {
        running = true;
        schedule();
      },
      stop() {
        running = false;
        clearTimeout(timer);
      },
      wake,
    };
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("تعذّر قراءة الصورة"));
      };
      img.src = url;
    });
  }

  /** يضغط الصورة إلى JPEG تحت 600KB ويرجّع data URL. */
  async function compressImage(file) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      throw new Error("الصورة لازم تكون png أو jpg أو webp");
    }
    const img = await loadImageElement(file);
    let maxSide = 1280;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.82, 0.7, 0.55, 0.42]) {
        const dataUrl = canvas.toDataURL("image/jpeg", q);
        const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
        if (bytes <= MAX_IMAGE_BYTES) return dataUrl;
      }
      maxSide = Math.round(maxSide * 0.75);
    }
    throw new Error("تعذّر تصغير الصورة بما يكفي — جرّب صورة أصغر");
  }

  /** يحمّل صورة محمية بتوكن ويحطها في <img>. */
  const blobCache = new Map();
  async function loadProtectedImage(imgEl, url, fetchBlob) {
    imgEl.classList.add("loading");
    try {
      let objectUrl = blobCache.get(url);
      if (!objectUrl) {
        const blob = await fetchBlob(url);
        objectUrl = URL.createObjectURL(blob);
        blobCache.set(url, objectUrl);
      }
      imgEl.src = objectUrl;
      imgEl.classList.remove("loading");
    } catch (err) {
      imgEl.replaceWith(
        Object.assign(document.createElement("span"), {
          className: "img-expired",
          textContent: err.status === 410 ? "انتهت صلاحية الصورة" : "تعذّر تحميل الصورة",
        }),
      );
    }
  }

  const EVENT_ICONS = {
    closed: "🔒",
    reopened: "🔓",
    claimed: "🙋",
    transferred: "🔁",
    escalated: "⏫",
    auto_reply: "🌙",
  };

  const TOPIC_LABELS = {
    price: "سعر",
    order: "طلب",
    product: "منتج",
    complaint: "شكوى",
    other: "أخرى",
  };

  window.ChatUI = {
    esc,
    newId,
    fmtTime,
    fmtDay,
    fmtRelative,
    tickHTML,
    tickStatus,
    createPoller,
    compressImage,
    loadProtectedImage,
    EVENT_ICONS,
    TOPIC_LABELS,
    MAX_BODY: 2000,
  };
})();
