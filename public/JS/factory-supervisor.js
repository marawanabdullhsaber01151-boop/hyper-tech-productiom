/** @format */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // ✅ إصلاح ثغرة XSS محتملة: الملف ده مكانش فيه أي دالة تعقيم خالص،
  // وكان بيحط بيانات زي اسم المنتج ورقم الأمر مباشرة جوه HTML — لو
  // حد قدر يدخل كود HTML/JS في اسم منتج (عبر شاشة الهندسة مثلًا)، كان
  // هيتنفّذ فعليًا هنا لأي مشرف بيفتح الصفحة دي.
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  function toast(msg) {
    $("toast-msg").textContent = msg;
    const t = $("toast");
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
  }
  async function api(path, options = {}) {
    return window.HyperTechAuth.request(path, options);
  }

  const STAGES = [
    { key: "line_setup", label: "تجهيز الخط" },
    { key: "manufacturing", label: "تصنيع فعلي" },
    { key: "assembly_packing", label: "تجميع/تغليف" },
    { key: "ready_for_quality", label: "جاهز لفحص الجودة" },
  ];

  function stageTrack(current) {
    const idx = STAGES.findIndex((s) => s.key === (current || "line_setup"));
    return `<div class="stage-track">${STAGES.map((s, i) => {
      const cls =
        i < idx ? "done"
        : i === idx ? "current"
        : "";
      return `<div class="stage-step ${cls}">${esc(s.label)}</div>`;
    }).join("")}</div>`;
  }

  async function loadOrders() {
    const list = $("sv-list");
    try {
      await window.HyperTechAuth.ready; // ✅ استنى بيانات المستخدم قبل ما تقارن supervisorId
      const me = window.HyperTechAuth.user;
      const data = await api("/production-workflow");
      const canSeeAll = [
        "chairman",
        "production_manager",
      ].includes(me?.role);
      const mine = data.filter(
        (o) =>
          o.workflowStatus === "in_production" &&
          (canSeeAll || o.supervisorId === me?.id),
      );
      if (!mine.length) {
        list.innerHTML =
          '<p class="empty-hint">لا يوجد أوامر قيد التنفيذ حاليًا</p>';
      } else {
        list.innerHTML = mine
          .map((o) => {
            const idx = STAGES.findIndex(
              (s) => s.key === (o.currentStage || "line_setup"),
            );
            const isLast = idx >= STAGES.length - 1;
            return `<div class="sv-card">
            <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
            <div class="meta">خط الإنتاج: ${esc(o.productionLine || "—")} | بداية: ${esc(o.startDate || "—")}</div>
            ${stageTrack(o.currentStage)}
            <button class="btn-primary" ${isLast ? 'disabled style="opacity:.4"' : ""} onclick="window.__advance(${Number(o.id)})">
              ${isLast ? "بانتظار فحص الجودة" : "الانتقال للمرحلة التالية"}
            </button>
          </div>`;
          })
          .join("");
      }

      // ✅ سجل الأوامر المنتهية — عشان الصفحة ماتفضلش فاضية بمجرد ما دور المشرف يخلص،
      // وعشان يفضل شايف أثر شغله لحد ما دورة الإنتاج تتقفل فعليًا (تسليم مؤكد نهائي)
      renderArchive(data, me, canSeeAll);
    } catch (e) {
      list.innerHTML = `<p class="empty-hint" style="color:var(--red)">تعذر تحميل الأوامر: ${e.message}</p>`;
    }
  }

  function renderArchive(data, me, canSeeAll) {
    const archive = $("sv-archive");
    if (!archive) return;
    const DELIVERED = ["delivered_customer", "delivered_warehouse"];
    const finished = data
      .filter(
        (o) =>
          DELIVERED.includes(o.workflowStatus) &&
          (canSeeAll || o.supervisorId === me?.id),
      )
      .sort(
        (a, b) =>
          new Date(b.deliveredAt || b.updatedAt) -
          new Date(a.deliveredAt || a.updatedAt),
      )
      .slice(0, 15);

    if (!finished.length) {
      archive.innerHTML =
        '<p class="empty-hint">مفيش أوامر منتهية لسه — أول ما تخلّص دورة إنتاج كاملة، هتظهر هنا كسجل.</p>';
      return;
    }
    archive.innerHTML = finished
      .map(
        (o) => `<div class="archive-card">
        <i class="fa-solid fa-circle-check archive-icon"></i>
        <div>
          <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
          <div class="meta">خط الإنتاج: ${esc(o.productionLine || "—")} | ${o.workflowStatus === "delivered_customer" ? "سُلّم للعميل" : "سُلّم للمخزن"}</div>
        </div>
        <span class="badge">تم التسليم ✓</span>
      </div>`,
      )
      .join("");
  }

  window.__advance = async function (id) {
    try {
      const result = await api(`/production-workflow/${id}/advance-stage`, {
        method: "PATCH",
        body: "{}",
      });
      toast(result.message || "تم الانتقال للمرحلة التالية");
      loadOrders();
    } catch (e) {
      toast("تعذر التحديث: " + e.message);
    }
  };

  await loadOrders();
})();
