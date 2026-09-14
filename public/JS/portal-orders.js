/** @format */
const orderApi = (path, options = {}) => window.HyperTechAuth.request(path, options);
const esc = (value) => { const d = document.createElement("div"); d.textContent = value ?? ""; return d.innerHTML; };
const list = document.getElementById("portal-orders-list");
let currentPage = 1;
let hasMore = false;

function deliveryMethodLabel(value) {
  return value === "customer" ? "توصيل للعميل" : value === "warehouse" ? "استلام من المخزن" : "—";
}

async function loadPortalOrders(page = 1) {
  list.innerHTML = '<div class="empty-state">جاري تحميل الطلبات...</div>';
  try {
    const limit = 20;
    const response = await orderApi(`/portal-orders/pending?limit=${limit}&page=${page}`);
    const batches = Array.isArray(response) ? response : response.data || [];
    currentPage = page;
    hasMore = batches.length === limit;
    if (!batches.length) {
      list.innerHTML = `<div class="empty-state">${page > 1 ? "لا توجد طلبات أخرى للمراجعة." : "لا توجد طلبات جديدة للمراجعة."}</div>`;
      renderPagination();
      return;
    }
    list.innerHTML = batches.map((batch) => `
      <article class="sales-card" data-batch="${esc(batch.batchRef)}" style="margin-bottom:16px;padding:20px">
        <div class="sales-card-header"><div><h3>${esc(batch.customerName)}</h3><p>${esc(batch.customerPhone)} · ${esc(batch.batchRef)}</p></div><strong>${esc(batch.priority)}</strong></div>
        <p>${esc(batch.notes || "بدون ملاحظات")}</p>
        <div class="sales-table-wrap"><table class="sales-table"><thead><tr>
          <th>المنتج</th><th>الكمية</th><th>السعر للوحدة</th>
          <th>الميعاد المقترح</th><th>ميعاد جديد (اختياري)</th>
          <th>طريقة التسليم المقترحة</th><th>تعديلها (اختياري)</th>
          <th></th>
        </tr></thead>
        <tbody>${batch.items.map((item) => `<tr data-item-row="${item.id}">
          <td>${esc(item.productName)}</td>
          <td>${esc(item.qty)} ${esc(item.unit)}</td>
          <td><input class="portal-price" data-id="${item.id}" type="number" min="0" step="0.01" placeholder="${item.referenceUnitPrice ? "مرجعي: " + esc(item.referenceUnitPrice) : "ج.م"}" /></td>
          <td>${esc(item.suggestedDueDate || item.neededBy || "—")}</td>
          <td><input class="portal-duedate-override" data-id="${item.id}" type="date" /></td>
          <td>${deliveryMethodLabel(item.suggestedDeliveryMethod)}</td>
          <td>
            <select class="portal-delivery-override" data-id="${item.id}">
              <option value="">بدون تعديل</option>
              <option value="customer">توصيل للعميل</option>
              <option value="warehouse">استلام من المخزن</option>
            </select>
          </td>
          <td><button type="button" class="btn-danger portal-cancel-item" data-id="${item.id}" title="إلغاء هذا الصنف فقط">إلغاء الصنف</button></td>
        </tr>`).join("")}</tbody></table></div>
        <div class="form-row" style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap">
          <label>الموعد المتوقع للإرسالية كلها <input class="portal-delivery" type="date" /></label>
          <label style="flex:1;min-width:200px">سبب أي تعديل تاريخ/طريقة تسليم <input class="portal-override-reason" type="text" placeholder="اختياري — يُسجَّل في سجل المراجعة" /></label>
          <label style="flex:1;min-width:240px">رسالة للعميل <input class="portal-reply" type="text" placeholder="سيظهر الرد في طلباتي" /></label>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px"><button class="btn-primary portal-confirm">تأكيد وإرسال للمسار الداخلي</button><button class="btn-danger portal-reject">رفض الطلب</button></div>
      </article>`).join("");
    document.querySelectorAll(".portal-confirm").forEach((button) => button.addEventListener("click", () => review(button.closest("[data-batch]"), false)));
    document.querySelectorAll(".portal-reject").forEach((button) => button.addEventListener("click", () => review(button.closest("[data-batch]"), true)));
    document.querySelectorAll(".portal-cancel-item").forEach((button) => button.addEventListener("click", () => cancelItem(button)));
    renderPagination();
  } catch (error) { list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; }
}

function renderPagination() {
  const controls = document.createElement("div");
  controls.className = "portal-pagination";
  controls.innerHTML = `<button type="button" ${currentPage <= 1 ? "disabled" : ""}>السابق</button><span>صفحة ${currentPage}</span><button type="button" ${hasMore ? "" : "disabled"}>التالي</button>`;
  const [previous, next] = controls.querySelectorAll("button");
  previous.addEventListener("click", () => loadPortalOrders(Math.max(1, currentPage - 1)));
  next.addEventListener("click", () => loadPortalOrders(currentPage + 1));
  list.appendChild(controls);
}

// Phase 3: إلغاء صنف واحد بس من غير ما يأثر على باقي أصناف نفس الإرسالية.
// السيرفر هو اللي بيمنع الإلغاء لو الصنف دخل الإنتاج بالفعل — الزرار ده
// بيظهر دايمًا في شاشة "قبل المراجعة" لأن كل الأصناف هنا لسه في أول
// الطريق أصلًا، لكن السيرفر يفضل هو مصدر الحقيقة النهائي.
async function cancelItem(button) {
  const id = button.dataset.id;
  const reason = prompt("سبب إلغاء هذا الصنف؟");
  if (!reason?.trim()) return;
  button.disabled = true;
  try {
    await orderApi(`/portal-orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
    await loadPortalOrders(currentPage);
  } catch (error) {
    console.error("[portal-orders]", error);
    alert(error.message);
    button.disabled = false;
  }
}

async function review(card, rejected) {
  const batchRef = card.dataset.batch;
  const delivery = card.querySelector(".portal-delivery").value || null;
  const replyMessage = card.querySelector(".portal-reply").value.trim() || null;
  const overrideReason = card.querySelector(".portal-override-reason").value.trim() || null;
  const buttons = [...card.querySelectorAll("button")];
  buttons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
  try {
    if (rejected) {
      const reason = prompt("اكتب سبب رفض الطلب");
      if (!reason?.trim()) return;
      await orderApi(`/portal-orders/${encodeURIComponent(batchRef)}/reject`, { method: "POST", body: JSON.stringify({ reason: reason.trim(), replyMessage, expectedDelivery: delivery }) });
    } else {
      const items = [...card.querySelectorAll(".portal-price")].map((input) => {
        const id = Number(input.dataset.id);
        const dueDateOverride = card.querySelector(`.portal-duedate-override[data-id="${id}"]`).value || null;
        const deliveryMethodOverride = card.querySelector(`.portal-delivery-override[data-id="${id}"]`).value || null;
        return {
          workflowOrderId: id,
          unitPrice: input.value,
          dueDateOverride,
          deliveryMethodOverride,
          overrideReason: (dueDateOverride || deliveryMethodOverride) ? overrideReason : null,
        };
      });
      if (items.some((item) => !item.unitPrice)) { alert("حدد سعر كل صنف أولاً"); return; }
      await orderApi(`/portal-orders/${encodeURIComponent(batchRef)}/confirm`, { method: "POST", body: JSON.stringify({ items, replyMessage, expectedDelivery: delivery }) });
    }
    await loadPortalOrders();
  } catch (error) {
    console.error("[portal-orders]", error);
    alert(error.message);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    });
  }
}

document.getElementById("refresh-orders").addEventListener("click", () => loadPortalOrders(1));
loadPortalOrders(1);
