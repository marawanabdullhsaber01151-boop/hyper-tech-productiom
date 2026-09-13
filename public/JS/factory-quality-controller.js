/** @format */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // ✅ إصلاح ثغرة XSS محتملة: نفس النمط اللي لقيناه في باقي شاشات factory-*
  // — مكانش فيه أي تعقيم، لا لبيانات السيرفر ولا حتى للنصوص اللي مراقب
  // الجودة نفسه بيكتبها (زي وصف العيب أو نقطة الفحص) قبل عرضها تاني.
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

  const state = {}; // orderId -> { rating, defectTags: [], checklist: [] }
  function ensureState(id) {
    if (!state[id]) state[id] = { rating: null, defectTags: [], checklist: [] };
    return state[id];
  }

  function starsHtml(id) {
    return `<div class="stars" id="stars-${id}">${[1, 2, 3, 4, 5]
      .map(
        (n) =>
          `<span data-n="${n}" onclick="window.__setRating(${id}, ${n})">★</span>`,
      )
      .join("")}</div>`;
  }
  window.__setRating = function (id, n) {
    ensureState(id).rating = n;
    document.querySelectorAll(`#stars-${id} span`).forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.n) <= n);
    });
  };

  // ─── الفحص بالعينة (منقول من صفحة مراقبة الجودة القديمة) ─────────────────
  window.__updateSampleCalc = function (id) {
    const size = Number($(`sample-size-${id}`).value) || 0;
    const passed = Number($(`sample-passed-${id}`).value) || 0;
    const failed = Number($(`sample-failed-${id}`).value) || 0;
    const result = $(`sample-result-${id}`);
    if (!size) {
      result.innerHTML =
        '<span style="color:var(--text-muted)">اكتب حجم العينة عشان تشوف النسبة</span>';
      return;
    }
    const rate = size > 0 ? Math.round((passed / size) * 100) : 0;
    const covered = passed + failed;
    const predicted =
      rate >= 95 ?
        { l: "متوقع: نجاح", c: "ok-badge" }
      : { l: "متوقع: رسوب", c: "bad-badge" };
    result.innerHTML = `
      نسبة النجاح: <strong>${rate}%</strong> (${passed} من ${size})
      ${covered > size ? '<span class="bad-badge"> — العدد أكبر من حجم العينة!</span>' : ""}
      — <span class="${predicted.c}">${predicted.l}</span>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(rate, 100)}%"></div></div>`;
  };

  // ─── العيوب كـ"تاجات" ───────────────────────────────────────────────────
  window.__addDefectTag = function (id) {
    const input = $(`defect-input-${id}`);
    const val = input.value.trim();
    if (!val) return;
    ensureState(id).defectTags.push(val);
    input.value = "";
    renderDefectTags(id);
  };
  window.__removeDefectTag = function (id, idx) {
    ensureState(id).defectTags.splice(idx, 1);
    renderDefectTags(id);
  };
  function renderDefectTags(id) {
    const tags = ensureState(id).defectTags;
    $(`defect-tags-${id}`).innerHTML = tags
      .map(
        (t, i) =>
          `<span class="tag-chip">${esc(t)} <i class="fa-solid fa-xmark" onclick="window.__removeDefectTag(${id}, ${i})"></i></span>`,
      )
      .join("");
  }

  // ─── قائمة الفحص التفصيلية ──────────────────────────────────────────────
  window.__addChecklistItem = function (id) {
    const input = $(`checklist-input-${id}`);
    const val = input.value.trim();
    if (!val) return;
    ensureState(id).checklist.push({ label: val, ok: false });
    input.value = "";
    renderChecklist(id);
  };
  window.__toggleChecklistItem = function (id, idx) {
    const item = ensureState(id).checklist[idx];
    item.ok = !item.ok;
    renderChecklist(id);
  };
  function renderChecklist(id) {
    const items = ensureState(id).checklist;
    const okCount = items.filter((i) => i.ok).length;
    $(`checklist-items-${id}`).innerHTML = items
      .map(
        (item, i) => `<div class="checklist-row">
          <input type="checkbox" ${item.ok ? "checked" : ""} onchange="window.__toggleChecklistItem(${id}, ${i})" />
          <span style="${item.ok ? "text-decoration:line-through;color:var(--text-muted)" : ""}">${esc(item.label)}</span>
        </div>`,
      )
      .join("");
    $(`checklist-score-${id}`).textContent =
      items.length ? `${okCount}/${items.length}` : "";
  }

  async function loadOrders() {
    const list = $("qc-list");
    try {
      await window.HyperTechAuth.ready; // ✅ استنى بيانات المستخدم قبل ما تقارن qualityControllerUserId
      const me = window.HyperTechAuth.user;
      const data = await api("/production-workflow");
      const canSeeAll = [
        "chairman",
        "production_manager",
        "quality_engineer",
      ].includes(me?.role);
      const mine = data.filter(
        (o) =>
          o.workflowStatus === "quality_check" &&
          (canSeeAll || o.qualityControllerUserId === me?.id),
      );
      if (!mine.length) {
        list.innerHTML =
          '<p class="empty-hint">لا يوجد أوامر بانتظار فحص الجودة حاليًا</p>';
      } else {
        list.innerHTML = mine
          .map(
            (o) => `<div class="qc-card">
        <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
        <div class="meta">المشرف: ${esc(o.supervisorName || "—")} | خط الإنتاج: ${esc(o.productionLine || "—")}</div>

        <div class="form-row">
          <label>الفحص بالعينة (اختياري)</label>
          <div class="sample-grid">
            <input type="number" min="0" id="sample-size-${o.id}" placeholder="حجم العينة" oninput="window.__updateSampleCalc(${o.id})" />
            <input type="number" min="0" id="sample-passed-${o.id}" placeholder="عدد الناجح" oninput="window.__updateSampleCalc(${o.id})" />
            <input type="number" min="0" id="sample-failed-${o.id}" placeholder="عدد الفاشل" oninput="window.__updateSampleCalc(${o.id})" />
          </div>
          <div class="sample-result" id="sample-result-${o.id}"><span style="color:var(--text-muted)">اكتب حجم العينة عشان تشوف النسبة</span></div>
        </div>

        <div class="form-row">
          <label>العيوب المكتشفة (لو فيه)</label>
          <div class="tag-input-row">
            <input type="text" id="defect-input-${o.id}" placeholder="اكتب العيب واضغط إضافة..." onkeydown="if(event.key==='Enter'){window.__addDefectTag(${o.id})}" />
            <button type="button" onclick="window.__addDefectTag(${o.id})">إضافة</button>
          </div>
          <div class="tags-list" id="defect-tags-${o.id}"></div>
        </div>

        <div class="form-row">
          <label>قائمة الفحص <span id="checklist-score-${o.id}" style="color:var(--text-muted)"></span></label>
          <div id="checklist-items-${o.id}"></div>
          <div class="tag-input-row" style="margin-top:6px">
            <input type="text" id="checklist-input-${o.id}" placeholder="أضف نقطة فحص..." onkeydown="if(event.key==='Enter'){window.__addChecklistItem(${o.id})}" />
            <button type="button" onclick="window.__addChecklistItem(${o.id})">إضافة</button>
          </div>
        </div>

        <div class="form-row">
          <label>تقييم التنفيذ (اختياري)</label>
          ${starsHtml(o.id)}
        </div>
        <div class="form-row">
          <label>ملاحظات الفحص</label>
          <textarea id="notes-${o.id}" rows="2"></textarea>
        </div>
        <div class="action-row">
          <button class="btn-pass" onclick="window.__submitQuality(${o.id}, 'passed')">✓ اجتاز الفحص</button>
          <button class="btn-fail" onclick="window.__submitQuality(${o.id}, 'failed')">✗ رسب الفحص</button>
        </div>
      </div>`,
          )
          .join("");
      }

      // ✅ سجل الأوامر المنتهية — نفس مبدأ صفحة المشرف: الصفحة ماتفضلش فاضية،
      // وأثر شغل مراقب الجودة يفضل ظاهر لحد ما دورة الإنتاج تتقفل نهائيًا
      renderArchive(data, me, canSeeAll);
    } catch (e) {
      list.innerHTML = `<p class="empty-hint" style="color:var(--red)">تعذر تحميل الأوامر: ${e.message}</p>`;
    }
  }

  function renderArchive(data, me, canSeeAll) {
    const archive = $("qc-archive");
    if (!archive) return;
    const DELIVERED = ["delivered_customer", "delivered_warehouse"];
    const finished = data
      .filter(
        (o) =>
          DELIVERED.includes(o.workflowStatus) &&
          (canSeeAll || o.qualityControllerUserId === me?.id),
      )
      .sort(
        (a, b) =>
          new Date(b.deliveredAt || b.updatedAt) -
          new Date(a.deliveredAt || a.updatedAt),
      )
      .slice(0, 15);

    if (!finished.length) {
      archive.innerHTML =
        '<p class="empty-hint">مفيش أوامر منتهية لسه — أول ما تخلّص دورة إنتاج كاملة فحصتها، هتظهر هنا كسجل.</p>';
      return;
    }
    archive.innerHTML = finished
      .map((o) => {
        const resultBadge =
          o.qualityStatus === "failed" ?
            `<span class="badge" style="background:rgba(239,68,68,0.15);color:var(--red)">رسب ثم اكتمل</span>`
          : `<span class="badge">اجتاز ✓</span>`;
        return `<div class="archive-card">
        <i class="fa-solid fa-shield-check archive-icon"></i>
        <div>
          <div class="num">${esc(o.orderNumber)} — ${esc(o.productName)} (${esc(o.qty)} ${esc(o.unit)})</div>
          <div class="meta">المشرف: ${esc(o.supervisorName || "—")} | ${o.workflowStatus === "delivered_customer" ? "سُلّم للعميل" : "سُلّم للمخزن"}</div>
        </div>
        ${resultBadge}
      </div>`;
      })
      .join("");
  }

  window.__submitQuality = async function (id, qualityStatus) {
    const qualityNotes = $(`notes-${id}`).value.trim();
    if (qualityStatus === "failed" && !qualityNotes) {
      toast("سبب الرسوب في الفحص مطلوب");
      return;
    }
    const s = ensureState(id);
    const sampleSize = Number($(`sample-size-${id}`).value) || null;
    const samplePassedCount = Number($(`sample-passed-${id}`).value) || null;
    const sampleFailedCount = Number($(`sample-failed-${id}`).value) || null;
    try {
      const result = await api(`/production-workflow/${id}/quality-done`, {
        method: "PATCH",
        body: JSON.stringify({
          qualityStatus,
          qualityNotes: qualityNotes || null,
          performanceRating: s.rating || null,
          sampleSize,
          samplePassedCount,
          sampleFailedCount,
          defectTags: s.defectTags,
          checklist: s.checklist,
        }),
      });
      toast(result.message || "تم تسجيل نتيجة الفحص");
      delete state[id];
      loadOrders();
    } catch (e) {
      toast("تعذر التسجيل: " + e.message);
    }
  };

  await loadOrders();
})();
