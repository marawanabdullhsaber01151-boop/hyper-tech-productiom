/* Shared rendering helpers for the production control screens. */
(function () {
  const auth = window.HyperTechAuth;
  window.FactoryScreen = {
    async request(path, options) {
      return auth.request(path, options);
    },
    escape(value) {
      return String(value ?? "—").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
      }[char]));
    },
    list(target, rows, mapper, empty = "لا توجد سجلات") {
      const node = document.getElementById(target);
      const data = Array.isArray(rows) ? rows : [];
      node.innerHTML = data.length ? data.map(mapper).join("") : `<div class="empty-state">${empty}</div>`;
      return data;
    },
    toast(message, error = false) {
      const toast = document.getElementById("advanced-toast");
      const label = document.getElementById("advanced-toast-msg");
      if (!toast || !label) return;
      label.textContent = message;
      toast.classList.toggle("error", error);
      toast.classList.add("visible");
      window.clearTimeout(toast._timer);
      toast._timer = window.setTimeout(() => toast.classList.remove("visible"), 3600);
    },
    async submit(form, path, transform = (value) => value) {
      const button = form.querySelector("button[type=submit], button:last-child");
      if (button) button.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        await window.FactoryScreen.request(path, { method: "POST", body: JSON.stringify(transform(values)) });
        form.reset();
        window.FactoryScreen.toast("تم حفظ العملية بنجاح");
        return true;
      } catch (error) {
        window.FactoryScreen.toast(error.message || "تعذر تنفيذ العملية", true);
        return false;
      } finally {
        if (button) button.disabled = false;
      }
    },
    formatDate(value) {
      if (!value) return "—";
      return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(value));
    },
  };
})();