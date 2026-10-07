/**
 * Shared dialogs for the portal admin pages (activation links, temporary
 * passwords, lifetime picker). Everything is built with DOM APIs (no innerHTML
 * with data) and removed from the page on close, so a link or password never
 * stays in the DOM after the staff member is done with it.
 */
(() => {
  const DURATIONS = [
    { minutes: 60, label: "ساعة" },
    { minutes: 1440, label: "24 ساعة" },
    { minutes: 4320, label: "3 أيام" },
    { minutes: 10080, label: "7 أيام" },
  ];

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child) node.append(child);
    }
    return node;
  }

  const formatExpiry = (value) =>
    value
      ? new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })
      : "";

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        input.focus();
        input.select();
        return document.execCommand("copy");
      } catch {
        return false;
      }
    }
  }

  function openDialog(build) {
    const dialog = el("dialog", { class: "action-dialog pad-dialog" });
    const close = (value) => {
      dialog.__value = value;
      if (dialog.open) dialog.close();
    };
    dialog.append(build(close));
    document.body.append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        const value = dialog.__value;
        dialog.remove(); // wipes the link / password from the DOM
        resolve(value);
      });
      dialog.showModal();
    });
  }

  function copyRow({ label, value, ltr = true, secret = false }) {
    const input = el("input", {
      class: "input pad-copy-input",
      type: "text",
      readonly: true,
      value,
      dir: ltr ? "ltr" : "rtl",
      "aria-label": label,
      autocomplete: "off",
    });
    const status = el("span", { class: "pad-copy-status muted", role: "status", "aria-live": "polite" });
    const button = el("button", {
      type: "button",
      class: "button primary",
      text: "نسخ",
      onclick: async () => {
        const ok = await copyText(value, input);
        status.textContent = ok ? "اتنسخ" : "ما اتنسخش، حدّده وانسخه بإيدك";
        if (!ok) input.select();
      },
    });
    return el(
      "div",
      { class: `pad-row${secret ? " pad-secret" : ""}` },
      el("label", { class: "pad-label", text: label }),
      el("div", { class: "pad-copy" }, input, button),
      status,
    );
  }

  function durationSelect(selected = 1440) {
    return el(
      "select",
      { class: "input", id: "pad-duration" },
      DURATIONS.map((d) =>
        el("option", { value: String(d.minutes), text: d.label, selected: d.minutes === selected }),
      ),
    );
  }

  /** Shows a one-time activation link with copy + WhatsApp. */
  function showActivation({ title = "رابط التفعيل جاهز", customerName, activation }) {
    return openDialog((close) => {
      const delivered = Boolean(activation?.delivered);
      const info = el("p", {
        class: `pad-note ${delivered ? "pad-ok" : "pad-warn"}`,
        text: delivered
          ? "اتبعت SMS للعميل. تقدر برضه تبعت الرابط بنفسك."
          : "الـ SMS مش مظبوط أو ما اتبعتش. ابعت الرابط للعميل بنفسك: انسخه أو افتح واتساب.",
      });
      const actions = el("div", { class: "dialog-actions" });
      if (activation?.whatsappUrl) {
        actions.append(
          el("a", {
            class: "button success",
            href: activation.whatsappUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            text: "افتح واتساب",
          }),
        );
      }
      actions.append(el("button", { type: "button", class: "button", text: "خلصت", onclick: () => close(true) }));
      return el(
        "div",
        { class: "pad-body" },
        el("h2", { text: title }),
        customerName ? el("p", { class: "muted", text: customerName }) : null,
        info,
        copyRow({ label: "رابط التفعيل", value: activation?.url || "" }),
        activation?.expiresAt
          ? el("p", { class: "muted", text: `صالح لحد ${formatExpiry(activation.expiresAt)}` })
          : null,
        el("p", { class: "pad-warn-text", text: "الرابط بيظهر مرة واحدة بس. لو قفلت الشاشة من غير ما تنسخه، ولّد رابط جديد." }),
        actions,
      );
    });
  }

  /** Shows a temporary password (one time) with copy + optional WhatsApp. */
  function showTempPassword({ customerName, password, whatsappUrl }) {
    return openDialog((close) => {
      const actions = el("div", { class: "dialog-actions" });
      if (whatsappUrl) {
        actions.append(
          el("a", {
            class: "button success",
            href: whatsappUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            text: "ابعتها واتساب",
          }),
        );
      }
      actions.append(el("button", { type: "button", class: "button", text: "خلصت", onclick: () => close(true) }));
      return el(
        "div",
        { class: "pad-body" },
        el("h2", { text: "كلمة السر المؤقتة" }),
        customerName ? el("p", { class: "muted", text: customerName }) : null,
        copyRow({ label: "كلمة السر", value: password, secret: true }),
        el("p", { class: "pad-warn-text", text: "اعرضها للعميل دلوقتي، مش هتظهر تاني." }),
        el("p", { class: "muted", text: "الجلسات القديمة اتقفلت، والعميل هيغيّرها أول ما يدخل." }),
        actions,
      );
    });
  }

  /** Asks for a lifetime (and optionally explains an action). Resolves minutes or null. */
  function askDuration({ title, message, confirmLabel = "متابعة", defaultMinutes = 1440 }) {
    return openDialog((close) => {
      const select = durationSelect(defaultMinutes);
      return el(
        "form",
        {
          class: "pad-body",
          onsubmit: (event) => {
            event.preventDefault();
            close(Number(select.value));
          },
        },
        el("h2", { text: title }),
        message ? el("p", { class: "muted", text: message }) : null,
        el("label", { class: "pad-label", for: "pad-duration", text: "الرابط يفضل شغال" }),
        select,
        el(
          "div",
          { class: "dialog-actions" },
          el("button", { type: "submit", class: "button primary", text: confirmLabel }),
          el("button", { type: "button", class: "button", text: "إلغاء", onclick: () => close(null) }),
        ),
      );
    }).then((value) => (typeof value === "number" ? value : null));
  }

  /** Asks how to reset a password. Resolves { newPassword? } or null. */
  function askResetPassword({ customerName }) {
    return openDialog((close) => {
      const input = el("input", {
        class: "input",
        id: "pad-new-password",
        type: "text",
        minlength: "6",
        autocomplete: "off",
        dir: "ltr",
        placeholder: "سيبها فاضية والنظام يولّد واحدة",
      });
      return el(
        "form",
        {
          class: "pad-body",
          onsubmit: (event) => {
            event.preventDefault();
            const value = input.value.trim();
            close(value ? { newPassword: value } : {});
          },
        },
        el("h2", { text: "تعيين كلمة سر مؤقتة" }),
        customerName ? el("p", { class: "muted", text: customerName }) : null,
        el("p", { class: "muted", text: "جلسات العميل الحالية هتتقفل، وهيغيّر الكلمة أول ما يدخل." }),
        el("label", { class: "pad-label", for: "pad-new-password", text: "كلمة سر (اختياري)" }),
        input,
        el(
          "div",
          { class: "dialog-actions" },
          el("button", { type: "submit", class: "button primary", text: "عيّن" }),
          el("button", { type: "button", class: "button", text: "إلغاء", onclick: () => close(null) }),
        ),
      );
    }).then((value) => (value && typeof value === "object" ? value : null));
  }

  window.PortalAdminDialogs = {
    DURATIONS,
    showActivation,
    showTempPassword,
    askDuration,
    askResetPassword,
  };
})();
