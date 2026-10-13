/* لو الواجهة الجديدة لصفحة إدارة شغّالة، حوّل الصفحة القديمة للجديدة (ماعدا ?legacy=1). */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("legacy") === "1") {
      sessionStorage.setItem("admin_legacy", "1");
      return;
    }
    if (sessionStorage.getItem("admin_legacy") === "1") return;
    var map = {
      "portal-customers-admin.html": { flag: "portal-customers-admin", to: "/v2/admin/portal-customers" },
      "portal-applications-admin.html": { flag: "portal-applications-admin", to: "/v2/admin/portal-applications" },
      "portal-activation-requests-admin.html": { flag: "portal-activation-requests-admin", to: "/v2/admin/portal-activation-requests" },
    };
    var hit = map[location.pathname.split("/").pop()];
    if (!hit) return;
    fetch("/api/v1/portal/ui-flags?page=" + encodeURIComponent(hit.flag), { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : { v2: false }; })
      .then(function (raw) {
        var f = raw && raw.data !== undefined ? raw.data : raw;
        if (f && f.v2) location.replace(hit.to);
      })
      .catch(function () {});
  } catch (e) {}
})();
