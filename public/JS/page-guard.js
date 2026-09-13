/** @format */
// ✅ حارس صلاحيات الصفحة — يُستخدم في كل صفحة:
//   1) data-allowed-roles على body: لو موجودة، بيتحقق منها ويرفض الوصول لو الدور مش فيها.
//   2) رئيس مجلس الإدارة (chairman) مستخدم إداري كامل، لذلك لا يتم تطبيق
//      إخفاء بصري خاص عليه. الحماية الحقيقية من السيرفر عبر requirePermission.
(function () {
  "use strict";

  const allowedAttr = document.body.dataset.allowedRoles;
  const allowed =
    allowedAttr ?
      allowedAttr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  function showDenied() {
    document.documentElement.innerHTML = `
      <head><meta charset="UTF-8"><title>غير مصرح</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet"/>
      </head>
      <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
        flex-direction:column;gap:14px;font-family:'Tajawal',sans-serif;background:#0b0f17;color:#aab8cc;direction:rtl">
        <i class="fa-solid fa-lock" style="font-size:42px;color:#f59e0b"></i>
        <h2 style="color:#fff;margin:0">مفيش وصول للصفحة دي</h2>
        <p style="margin:0">الصفحة دي مش من صلاحياتك الحالية.</p>
        <a href="/index.html" style="color:#3b82f6;text-decoration:none">الرجوع للوحة التحكم</a>
      </body>`;
  }

  async function check() {
    // ✅ استنى بيانات المستخدم من auth.js بدل ما نعمل polling يدوي كل 60ms
    if (window.HyperTechAuth && window.HyperTechAuth.ready) {
      await window.HyperTechAuth.ready;
    }
    const role =
      window.HyperTechAuth &&
      window.HyperTechAuth.user &&
      window.HyperTechAuth.user.role;
    if (!role) return; // auth.js هيتولى تسجيل الخروج لو فشل جلب البيانات
    if (allowed && !allowed.includes(role)) {
      showDenied();
      return;
    }
  }
  check();
})();
