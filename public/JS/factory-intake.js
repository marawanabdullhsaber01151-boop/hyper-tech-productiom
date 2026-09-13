/** @format */
(async function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  // ✅ إصلاح ثغرة XSS محتملة: الملف ده مكانش فيه أي تعقيم خالص للبيانات
  // القادمة من السيرفر (اسم منتج، اسم عميل، ملاحظات...) قبل حقنها
  // مباشرة جوه HTML.
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

  const STATUS_LABELS = {
    ...window.HyperTechProduction.statusLabels,
    new: "بانتظار استلام مدير الإنتاج",
    materials_requested: "بانتظار فحص المخازن",
    materials_approved: "تمت الموافقة على المواد",
    materials_rejected: "رُفضت المواد",
    completed: "اكتمل الإنتاج",
    delivery_pending_customer: "جاهز — بانتظار تأكيدك للتسليم",
  };

  // ✅ تحميل قائمة المنتجات من وصفات التصنيع المحفوظة فقط
  async function loadProducts() {
    try {
      const recipes = await api("/bom");
      const select = $("f-product");
      if (!recipes.length) {
        select.innerHTML = "";
        select.disabled = true;
        $("f-product-empty").style.display = "block";
        return;
      }
      // ✅ لو فيه أسماء متكررة، نضيف رقم تمييز بسيط جنب الاسم عشان محدش يختار الغلط بالخطأ
      const nameCounts = {};
      recipes.forEach((r) => {
        nameCounts[r.productName] = (nameCounts[r.productName] || 0) + 1;
      });

      select.innerHTML =
        '<option value="">اختر المنتج...</option>' +
        recipes
          .map(
            (r) =>
              `<option value="${esc(r.id)}">${esc(r.productName)}${nameCounts[r.productName] > 1 ? ` (#${esc(r.id)})` : ""}</option>`,
          )
          .join("");
    } catch (e) {
      toast("تعذر تحميل قائمة المنتجات: " + e.message);
    }
  }

  async function loadMyRequests() {
    const tbody = $("req-tbody");
    try {
      const data = await api("/production-workflow");

      const awaitingConfirm = data.filter(
        (o) => o.workflowStatus === "delivery_pending_customer",
      );
      const confirmCard = $("delivery-confirm-card");
      const confirmList = $("delivery-confirm-list");
      if (awaitingConfirm.length) {
        confirmCard.style.display = "block";
        confirmList.innerHTML = awaitingConfirm
          .map(
            (o) => `<div class="wh-card" id="delivery-confirm-${esc(o.id)}">
          <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
          <div class="meta">العميل: ${esc(o.customerName || "—")} ${o.customerPhone ? "| " + esc(o.customerPhone) : ""} ${o.deliveryNotes ? "| ملاحظات: " + esc(o.deliveryNotes) : ""}</div>
          <button class="btn-primary" onclick="window.__confirmCustomerDelivery(${Number(o.id)})"><i class="fa-solid fa-check-double"></i> تأكيد التسليم للعميل</button>
        </div>`,
          )
          .join("");
      } else {
        confirmCard.style.display = "none";
      }

      if (!data.length) {
        tbody.innerHTML =
          '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">لا توجد طلبات بعد</td></tr>';
        return;
      }

      // ✅ عداد سريع لطلبات البوابة الجديدة (لسه في حالة "new" — يعني محدش خطواها بعد)
      const newPortalCount = data.filter(
        (o) => o.orderSource === "website" && o.workflowStatus === "new",
      ).length;
      const portalBadge = $("portal-count-badge");
      if (newPortalCount > 0) {
        portalBadge.textContent = `${newPortalCount} جديد من البوابة`;
        portalBadge.style.display = "inline-block";
      } else {
        portalBadge.style.display = "none";
      }

      tbody.innerHTML = data
        .map(
          (o) => `<tr>
        <td><strong>${esc(o.orderNumber)}</strong>${o.orderSource === "website" ? ` <span title="طلب وارد من بوابة العملاء مباشرة" style="background:var(--accent-soft,rgba(245,158,11,.12));color:var(--accent,#f59e0b);font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;margin-right:6px"><i class="fa-solid fa-globe"></i> بوابة</span>` : ""}</td>
        <td>${esc(o.customerName || "—")}</td>
        <td>${esc(o.productName)} <span style="color:var(--text-muted)">(${esc(o.qty)} ${esc(o.unit)})</span></td>
        <td>${esc(o.neededBy || "—")}</td>
        <td><span class="badge blue">${esc(STATUS_LABELS[o.workflowStatus] || o.workflowStatus)}</span></td>
        <td>${
          o.workflowStatus === "new" ?
            `<button class="lock-edit" data-edit-id="${esc(o.id)}" data-edit-date="${esc(o.neededBy || "")}"><i class="fa-solid fa-pen"></i> تعديل التاريخ</button>`
          : ""
        }</td>
      </tr>`,
        )
        .join("");
      // ✅ إصلاح أمني: كان الـonclick بيحقن قيمة neededBy مباشرة جوه
      // كود JS كنص بين علامتي اقتباس أحادية — لو القيمة فيها علامة
      // اقتباس، كانت هتكسر السكريبت وتسمح بتنفيذ كود مباشر (XSS خطير
      // في سياق onclick نفسه). استبدلته بـ data-attributes معقّمة +
      // event delegation آمن تمامًا.
      tbody.querySelectorAll("[data-edit-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          window.__editNeededBy(btn.dataset.editId, btn.dataset.editDate);
        });
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red)">تعذر تحميل الطلبات: ${e.message}</td></tr>`;
    }
  }

  window.__confirmCustomerDelivery = async function (id) {
    try {
      const result = await api(`/production-workflow/${id}/confirm-delivery`, {
        method: "PATCH",
      });
      toast(result.message || "تم تأكيد التسليم للعميل");
      loadMyRequests();
    } catch (e) {
      toast("تعذر تأكيد التسليم: " + e.message);
    }
  };

  window.__editNeededBy = async function (id, currentDate) {
    const newDate = prompt("تاريخ التسليم الجديد (YYYY-MM-DD):", currentDate);
    if (!newDate || newDate === currentDate) return;
    const reason = prompt("سبب التعديل (اختياري):") || "";
    try {
      await api(`/production-workflow/${id}/needed-by`, {
        method: "PATCH",
        body: JSON.stringify({ neededBy: newDate, reason }),
      });
      toast("تم تعديل تاريخ التسليم وتنبيه كل من مرّ على الطلب");
      loadMyRequests();
    } catch (e) {
      toast("تعذر التعديل: " + e.message);
    }
  };

  $("btn-submit").addEventListener("click", async () => {
    const productSelect = $("f-product");
    const productName =
      productSelect.selectedOptions[0]?.textContent
        .replace(/\s*\(#\d+\)$/, "")
        .trim() || "";
    const payload = {
      productName,
      customerName: $("f-customer-name").value.trim(),
      customerPhone: $("f-customer-phone").value.trim() || null,
      customerEmail: $("f-customer-email").value.trim() || null,
      orderSource: $("f-source").value,
      bomRecipeId: Number($("f-product").value) || null,
      qty: $("f-qty").value,
      unit: $("f-unit").value.trim() || "وحدة",
      priority: $("f-priority").value,
      neededBy: $("f-needed-by").value,
      notes: $("f-notes").value.trim() || null,
    };
    if (!payload.customerName) {
      toast("اسم العميل مطلوب");
      return;
    }
    if (!payload.bomRecipeId || !payload.productName) {
      toast("يرجى اختيار منتج له وصفة تصنيع");
      return;
    }
    if (!payload.qty) {
      toast("الكمية مطلوبة");
      return;
    }
    if (!payload.neededBy) {
      toast("تاريخ التسليم مطلوب");
      return;
    }

    try {
      const result = await api("/production-workflow", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast(result.message || "تم إرسال طلب الإنتاج بنجاح");
      [
        "f-customer-name",
        "f-customer-phone",
        "f-customer-email",
        "f-qty",
        "f-unit",
        "f-needed-by",
        "f-notes",
      ].forEach((id) => ($(id).value = ""));
      $("f-product").value = "";
      $("f-priority").value = "normal";
      $("f-source").value = "direct";
      loadMyRequests();
    } catch (e) {
      toast("تعذر إرسال الطلب: " + e.message);
    }
  });

  await loadProducts();
  await loadMyRequests();
})();
