/** @format */

(() => {
  const form = document.getElementById("activate-form");
  const submit = document.getElementById("activate-submit");
  const errorBox = document.getElementById("activate-error");
  const successBox = document.getElementById("activate-success");
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const isReset = params.get("mode") === "reset";
  if (isReset) {
    const sub = document.querySelector(".auth-sub");
    if (sub) sub.textContent = "اختار كلمة سر جديدة لحسابك. الرابط يُستخدم مرة واحدة فقط.";
    document.title = "كلمة سر جديدة — Hyper-Tech";
  }
  if (token) {
    fetch("/api/v1/portal/activate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) {
          showError(j?.error?.message || "الرابط غلط أو منتهي");
          submit.disabled = true;
        }
      })
      .catch(() => {});
  }

  function reportPortalError(context, error) {
    console.error("[portal]", {
      context,
      message: error instanceof Error ? error.message : String(error),
      status: error?.status,
    });
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.setAttribute("aria-busy", String(busy));
    submit.innerHTML = busy
      ? '<i class="fa-solid fa-spinner fa-spin"></i> جاري التفعيل...'
      : '<i class="fa-solid fa-check"></i> تفعيل الحساب';
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.classList.remove("show");
    successBox.classList.remove("show");

    const password = document.getElementById("new-password").value;
    const confirmation = document.getElementById("confirm-password").value;
    if (!token) {
      showError("رابط التفعيل غير صحيح أو ناقص.");
      return;
    }
    if (password.length < 6) {
      showError("كلمة المرور لازم تكون 6 أحرف على الأقل.");
      return;
    }
    if (password !== confirmation) {
      showError("تأكيد كلمة المرور غير مطابق.");
      return;
    }

    setBusy(true);
    try {
      let response;
      try {
        response = await fetch(
          isReset ? "/api/v1/portal/recovery/complete" : "/api/v1/portal/activate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              isReset
                ? { token, newPassword: password }
                : { token, password, confirmPassword: confirmation },
            ),
          },
        );
      } catch (error) {
        reportPortalError("activate:network", error);
        throw new Error("تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.");
      }
      const rawPayload = await response.json().catch(() => ({}));
      const payload = rawPayload && typeof rawPayload === "object" && "data" in rawPayload ? rawPayload.data || {} : rawPayload;
      // رسائل الخطأ بتيجي على مستوى الغلاف نفسه
      if (!response.ok && rawPayload?.error) payload.error = rawPayload.error;
      if (!response.ok) {
        const error = new Error(payload?.error?.message || "تعذر تفعيل الحساب.");
        error.status = response.status;
        reportPortalError("activate", error);
        throw error;
      }
      if (!navigator.onLine) {
        throw new Error("لا يوجد اتصال بالإنترنت حاليًا.");
      }
      form.classList.add("hidden");
      successBox.textContent = isReset
        ? "اتغيّرت كلمة السر. ادخل بيها دلوقتي."
        : "تم تفعيل حسابك بنجاح. تقدر تسجّل دخول برقم موبايلك أو إيميلك.";
      if (Array.isArray(payload.recoveryCodes) && payload.recoveryCodes.length) {
        const wrap = document.createElement("div");
        wrap.style.marginTop = "12px";
        const note = document.createElement("div");
        note.textContent =
          "أكواد الاسترجاع — احفظها في مكان آمن. كل كود يُستخدم مرة واحدة ولن تظهر تاني:";
        const pre = document.createElement("pre");
        pre.style.cssText =
          "direction:ltr;text-align:center;font-size:15px;line-height:2;margin:8px 0;user-select:all";
        pre.textContent = payload.recoveryCodes.join("\n");
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "auth-submit";
        copy.textContent = "نسخ الأكواد";
        copy.addEventListener("click", () => {
          navigator.clipboard
            ?.writeText(payload.recoveryCodes.join("\n"))
            .then(() => (copy.textContent = "اتنسخت"))
            .catch(() => {});
        });
        wrap.append(note, pre, copy);
        successBox.append(wrap);
      }
      successBox.classList.add("show");
    } catch (error) {
      reportPortalError("activate:submit", error);
      showError(error.message || "تعذر تفعيل الحساب.");
      setBusy(false);
    }
  });
})();