/** @format */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // ✅ إصلاح ثغرة XSS محتملة: نفس النمط اللي لقيناه في factory-supervisor.js
  // وfactory-intake.js — الملف مكانش فيه أي تعقيم للبيانات القادمة من السيرفر.
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

  async function loadOrders() {
    const list = $("wh-list");
    try {
      const data = await api("/production-workflow");
      const pending = data.filter(
        (o) => o.workflowStatus === "materials_requested",
      );
      if (!pending.length) {
        list.innerHTML =
          '<p class="empty-hint">لا توجد طلبات بانتظار فحص المخزون حاليًا</p>';
      } else {
        list.innerHTML = pending
          .map(
            (o) => `<div class="wh-card" id="wh-card-${esc(o.id)}">
          <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
          <div class="meta">المشرف: ${esc(o.supervisorName || "—")} | خط الإنتاج: ${esc(o.productionLine || "—")}</div>
          <button class="btn-primary" onclick="window.__checkOrder(${Number(o.id)})">فحص الطلب</button>
          <div id="wh-check-${esc(o.id)}"></div>
        </div>`,
          )
          .join("");
      }

      const receiving = $("wh-receive-list");
      const awaitingReceipt = data.filter(
        (o) => o.workflowStatus === "delivery_pending_warehouse",
      );
      if (!awaitingReceipt.length) {
        receiving.innerHTML =
          '<p class="empty-hint">لا توجد منتجات بانتظار الاستلام حاليًا</p>';
      } else {
        receiving.innerHTML = awaitingReceipt
          .map(
            (o) => `<div class="wh-card" id="wh-receive-card-${esc(o.id)}">
          <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
          <div class="meta">${o.deliveryNotes ? "ملاحظات: " + esc(o.deliveryNotes) : "جاهز للاستلام كمنتج تام"}</div>
          <button class="btn-primary" onclick="window.__confirmReceive(${Number(o.id)})"><i class="fa-solid fa-check-double"></i> تأكيد الاستلام</button>
        </div>`,
          )
          .join("");
      }

      // ✅ سجل الأوامر المنتهية — كل أمر اتخذ فيه المخزن قرار (موافقة/رفض/موافقة جزئية)
      // أو استلمه فعليًا، وخلص لحد التسليم النهائي — عشان الصفحة ماتفضلش فاضية
      renderArchive(data);
    } catch (e) {
      list.innerHTML = `<p class="empty-hint" style="color:var(--red)">تعذر تحميل الطلبات: ${e.message}</p>`;
    }
  }

  function renderArchive(data) {
    const archive = $("wh-archive");
    if (!archive) return;
    const DELIVERED = ["delivered_customer", "delivered_warehouse"];
    // كل أمر خلص ومر على مدير المخازن في مرحلة ما (قرار مواد أو استلام) — بغض النظر
    // مين بالظبط اللي اتخذ القرار وقتها، عشان الصفحة دي مفيهاش مستخدم واحد بس عادةً
    const finished = data
      .filter(
        (o) => DELIVERED.includes(o.workflowStatus) && o.warehouseDecidedAt,
      )
      .sort(
        (a, b) =>
          new Date(b.deliveredAt || b.updatedAt) -
          new Date(a.deliveredAt || a.updatedAt),
      )
      .slice(0, 15);

    if (!finished.length) {
      archive.innerHTML =
        '<p class="empty-hint">مفيش أوامر منتهية لسه — أول ما تخلّص دورة إنتاج كاملة مرّت عليك، هتظهر هنا كسجل.</p>';
      return;
    }
    archive.innerHTML = finished
      .map((o) => {
        const decisionLabel =
          {
            approve: "موافقة كاملة",
            partial: "موافقة جزئية",
            reject: "تم الرفض ثم استؤنفت",
          }[o.warehouseDecision] || "";
        return `<div class="archive-card">
        <i class="fa-solid fa-warehouse archive-icon"></i>
        <div>
          <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
          <div class="meta">${decisionLabel ? "قرار المواد: " + esc(decisionLabel) + " | " : ""}${o.workflowStatus === "delivered_customer" ? "سُلّم للعميل" : "استُلم بالمخزن"}</div>
        </div>
        <span class="badge">مكتمل ✓</span>
      </div>`;
      })
      .join("");
  }

  window.__confirmReceive = async function (id) {
    try {
      const result = await api(`/production-workflow/${id}/confirm-delivery`, {
        method: "PATCH",
      });
      toast(result.message || "تم تأكيد الاستلام");
      loadOrders();
    } catch (e) {
      toast("تعذر تأكيد الاستلام: " + e.message);
    }
  };

  window.__checkOrder = async function (id) {
    const container = $(`wh-check-${id}`);
    container.innerHTML = '<p class="empty-hint">جاري الفحص التلقائي...</p>';
    try {
      const { materials, allSufficient } = await api(
        `/production-workflow/${id}/materials-check`,
      );
      if (!materials.length) {
        container.innerHTML =
          '<p class="empty-hint">مفيش مكوّنات مرتبطة بالمخزون في وصفة هذا المنتج</p>';
        return;
      }
      container.innerHTML = `
        <table class="mat-table">
          <thead><tr><th>المادة</th><th>المطلوب</th><th>المتاح</th><th>القرار (كمية)</th></tr></thead>
          <tbody>
            ${materials
              .map(
                (m, i) => `<tr>
              <td>${esc(m.materialName)} <span class="${m.sufficient ? "ok-badge" : "bad-badge"}">${m.sufficient ? "✓ متوفر" : "✗ ناقص"}</span></td>
              <td>${esc(m.requestedQty)} ${esc(m.unit)}</td>
              <td>${esc(m.availableQty)} ${esc(m.unit)}</td>
              <td><input type="number" step="0.001" min="0" id="qty-${id}-${i}" value="${Math.min(Number(m.requestedQty), Number(m.availableQty)).toFixed(3)}" /></td>
            </tr>`,
              )
              .join("")}
          </tbody>
        </table>
        <div class="action-row">
          <button class="btn-approve" ${allSufficient ? "" : 'disabled style="opacity:.4"'} onclick="window.__decide(${id}, 'approve')">✓ موافقة كاملة</button>
          <button class="btn-partial" onclick="window.__decide(${id}, 'partial')">موافقة جزئية</button>
          <button class="btn-reject" onclick="window.__decide(${id}, 'reject')">✗ رفض</button>
        </div>`;
      container.dataset.materials = JSON.stringify(materials);
    } catch (e) {
      container.innerHTML = `<p class="empty-hint" style="color:var(--red)">تعذر الفحص: ${e.message}</p>`;
    }
  };

  window.__decide = async function (id, action) {
    const container = $(`wh-check-${id}`);
    const materials = JSON.parse(container.dataset.materials || "[]");
    let payload = { action };

    if (action === "reject") {
      const comment = prompt("سبب الرفض:");
      if (!comment) return;
      payload.comment = comment;
    } else if (action === "partial") {
      const comment = prompt("سبب/ملاحظة الموافقة الجزئية (اختياري):") || "";
      payload.comment = comment;
      payload.materialDecisions = materials.map((m, i) => ({
        materialName: m.materialName,
        inventoryItemId: m.inventoryItemId,
        approvedQty: $(`qty-${id}-${i}`).value || "0",
        unit: m.unit,
      }));
    }
    // action === "approve" لا يحتاج بيانات إضافية — النظام بيخصم المطلوب بالكامل تلقائيًا

    try {
      const result = await api(`/production-workflow/${id}/warehouse-action`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast(result.message || "تم تنفيذ القرار");
      loadOrders();
    } catch (e) {
      toast("تعذر تنفيذ القرار: " + e.message);
    }
  };

  await loadOrders();
})();
