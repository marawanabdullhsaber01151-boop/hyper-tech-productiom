/* لو الواجهة الجديدة للبوابة شغّالة، حوّل الصفحة القديمة للصفحة الجديدة (ماعدا ?legacy=1). */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("legacy") === "1") {
      sessionStorage.setItem("portal_legacy", "1");
      return;
    }
    if (sessionStorage.getItem("portal_legacy") === "1") return;
    var map = {
      "portal.html": "home",
      "portal-login.html": "login",
      "portal-activate.html": "activate",
      "portal-recover.html": "recover",
    };
    var file = location.pathname.split("/").pop();
    var target = map[file];
    if (!target) return;
    fetch("/api/v1/portal/ui-flags", { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : { v2: false }; })
      .then(function (raw) {
        var f = raw && raw.data !== undefined ? raw.data : raw;
        if (f && f.v2) location.replace("/v2/portal/" + target + location.search + location.hash);
      })
      .catch(function () {});
  } catch (e) {}
})();
