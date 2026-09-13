/** @format */

(() => {
  const form = document.getElementById("activate-form");
  const submit = document.getElementById("activate-submit");
  const errorBox = document.getElementById("activate-error");
  const successBox = document.getElementById("activate-success");
  const token = new URLSearchParams(window.location.search).get("token") || "";

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
        response = await fetch("/api/v1/portal/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password, confirmPassword: confirmation }),
        });
      } catch (error) {
        reportPortalError("activate:network", error);
        throw new Error("تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.");
      }
      const payload = await response.json().catch(() => ({}));
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
      successBox.innerHTML =
        '<strong><i class="fa-solid fa-circle-check"></i> تم تفعيل حسابك بنجاح.</strong><br>يمكنك الآن تسجيل الدخول باستخدام رقم هاتفك أو بريدك الإلكتروني.';
      successBox.classList.add("show");
    } catch (error) {
      reportPortalError("activate:submit", error);
      showError(error.message || "تعذر تفعيل الحساب.");
      setBusy(false);
    }
  });
})();