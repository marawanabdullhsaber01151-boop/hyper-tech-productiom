/** @format */
(() => {
  const $ = (id) => document.getElementById(id);
  const api = async (path, body) => {
    const r = await fetch("/api/v1" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || "حصلت مشكلة، جرّب تاني.");
    return j;
  };
  const show = (box, msg) => {
    $("r-error").classList.remove("show");
    $("r-success").classList.remove("show");
    $(box).textContent = msg;
    $(box).classList.add("show");
  };
  let resetToken = new URLSearchParams(location.search).get("token") || "";

  // لو الطلب فشل لأي سبب، نسيب كل الطرق ظاهرة (السيرفر هو اللي بيرفض اللي مش متاح).
  fetch("/api/v1/portal/recovery/methods")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("methods"))))
    .then((j) => {
      const m = Array.isArray(j.methods) ? j.methods : null;
      const map = { link: ["email", "telegram"], admin: ["admin"], recovery: ["recovery_code"], owner: ["owner"] };
      if (m && m.length) {
        [...$("r-method").options].forEach((o) => {
          if (!map[o.value].some((k) => m.includes(k))) o.remove();
        });
      }
      if (j.support?.whatsappUrl) $("support-link").href = j.support.whatsappUrl;
      else $("support-link").classList.add("hidden");
      sync();
    })
    .catch(() => {});

  const sync = () => {
    const v = $("r-method").value;
    $("code-field").classList.toggle("hidden", v !== "admin" && v !== "recovery");
    $("r-code-label").textContent = v === "admin" ? "كود الدعم (8 أرقام)" : "كود الاسترجاع (XXXX-XXXX)";
  };
  $("r-method").addEventListener("change", sync);
  sync();

  $("r-go").addEventListener("click", async () => {
    const identifier = $("r-identifier").value.trim();
    const method = $("r-method").value || "link";
    if (!identifier) return show("r-error", "اكتب رقم الموبايل أو الإيميل.");
    $("r-go").disabled = true;
    try {
      if (method === "link") {
        const j = await api("/portal/recovery/start", { identifier });
        show("r-success", j.message);
      } else if (method === "owner") {
        const j = await api("/portal/recovery/ask-owner", { identifier });
        show("r-success", j.message);
      } else {
        const code = $("r-code").value.trim();
        const j = await api(
          "/portal/recovery/verify",
          method === "admin" ? { identifier, code } : { identifier, recoveryCode: code },
        );
        resetToken = j.resetToken;
        $("step-id").classList.add("hidden");
        $("step-pass").classList.remove("hidden");
        show("r-success", "الكود صح. اختار كلمة سر جديدة.");
      }
    } catch (e) {
      show("r-error", e.message);
    } finally {
      $("r-go").disabled = false;
    }
  });

  $("step-pass").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const p = $("r-pass").value;
    if (p !== $("r-pass2").value) return show("r-error", "تأكيد كلمة السر مش مطابق.");
    try {
      await api("/portal/recovery/complete", { token: resetToken, newPassword: p });
      $("step-pass").classList.add("hidden");
      show("r-success", "اتغيّرت كلمة السر. ادخل بيها دلوقتي.");
    } catch (e) {
      show("r-error", e.message);
    }
  });
})();
