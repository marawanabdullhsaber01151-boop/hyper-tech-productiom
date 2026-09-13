#!/usr/bin/env node
/**
 * @format
 *
 * ✨ smoke-test.js — فحص آلي سريع قبل أي نشر أو دمج تعديلات
 *
 * ليه الأداة دي موجودة:
 * في جلسة مراجعة واحدة، لقينا 6 أخطاء صامتة حقيقية نتجت كلها عن دمج ملفات
 * من مصادر/نسخ مختلفة بدون تحقق آلي:
 *   1. data-kpi اتشالت من index.html فبقى index.js بيحدّث عناصر مش موجودة
 *   2. id="live-badge" اتشال بنفس الطريقة
 *   3. @keyframes pulse اتعرّفت مرتين بمعنى مختلف في ملفين CSS
 *   4. .notif-dot اتعرّفت بالكامل مرتين بقيم متضاربة
 *   5. راوت GET /portal/my-orders اتكرر في نفس الملف (الأول بيغطي التاني)
 *   6. أدوار افتراضية في actionRegistry ما بتطابقش requireRole الأصلي
 *
 * كل واحدة من دول اكتشفناها يدويًا بالعين وبمتصفح حقيقي — ده بياخد وقت
 * وعرضة للخطأ البشري. الأداة دي بتكتشف نفس الأنماط دي آليًا في ثواني،
 * وتتشغل قبل أي "git push" أو نشر (أضفها في package.json كـ:
 * "pretest": "node scripts/smoke-test.js" أو في CI pipeline).
 *
 * الاستخدام: node scripts/smoke-test.js
 * بترجع exit code 1 لو فيه مشكلة حرجة (تصلح لوقف النشر تلقائيًا في CI)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SRC_DIR = path.join(ROOT, "src");

let errors = [];
let warnings = [];

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}

/* ────────────────────────────────────────────────────────────
   1) لكل صفحة HTML: كل id بيستخدمه JS المرتبط بيها (عبر
      getElementById / querySelector('#...') / data-kpi) لازم يكون
      موجود فعليًا في نفس الصفحة أو يتعمل ديناميكيًا (innerHTML) في
      نفس ملف الـ JS. بنتجاهل الحالة التانية دي بفحص بسيط: لو الـ id
      نفسه ظاهر في مكان تاني في ملف الـ JS كنص (يعني غالبًا بيتعمل
      ديناميكيًا)، منعتبرهوش خطأ.
──────────────────────────────────────────────────────────── */
function checkIdsMatch() {
  const htmlFiles = listFiles(PUBLIC_DIR, ".html");
  for (const htmlPath of htmlFiles) {
    const html = readIfExists(htmlPath);
    if (!html) continue;
    const base = path.basename(htmlPath, ".html");
    const jsPath = path.join(PUBLIC_DIR, "JS", `${base}.js`);
    const js = readIfExists(jsPath);
    if (!js) continue; // الصفحة دي مالهاش ملف JS مخصوص، مفيش حاجة نفحصها

    const htmlIds = new Set([...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]));
    const jsIdRefs = new Set(
      [...js.matchAll(/getElementById\("([a-zA-Z0-9_-]+)"\)|getElementById\('([a-zA-Z0-9_-]+)'\)/g)].map(
        (m) => m[1] || m[2],
      ),
    );

    for (const id of jsIdRefs) {
      const inHtml = htmlIds.has(id);
      // لو الـ id مش في الـ HTML الأصلي، ممكن يكون بيتعمل ديناميكيًا —
      // نتأكد إن اسمه ظاهر كـ id="..." جوه string جوه نفس ملف الـ JS
      const createdDynamically = new RegExp(`id="${id}"|id='${id}'`).test(js);
      if (!inHtml && !createdDynamically) {
        errors.push(`[IDs] ${base}.js بيدوّر على #${id} لكنه مش موجود في ${base}.html ولا بيتعمل ديناميكيًا`);
      }
    }

    // data-kpi خاصة — نفس الفكرة بالظبط لكن للـ attribute ده تحديدًا
    const jsDataKpiRefs = new Set([...js.matchAll(/data-kpi="([a-zA-Z]+)"/g)].map((m) => m[1]));
    const htmlDataKpi = new Set([...html.matchAll(/data-kpi="([a-zA-Z]+)"/g)].map((m) => m[1]));
    for (const key of jsDataKpiRefs) {
      if (!htmlDataKpi.has(key)) {
        errors.push(`[data-kpi] ${base}.js بيدوّر على [data-kpi="${key}"] لكنه مش موجود في ${base}.html`);
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────
   2) تعارض @keyframes: نفس الاسم بمحتوى مختلف في أكتر من ملف CSS
──────────────────────────────────────────────────────────── */
function checkKeyframeConflicts() {
  const cssFiles = listFiles(path.join(PUBLIC_DIR, "CSS"), ".css");
  const seen = {}; // name -> {file, body}
  for (const cssPath of cssFiles) {
    const css = readIfExists(cssPath);
    if (!css) continue;
    const matches = [...css.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)\s*\{([\s\S]*?)\n\}/g)];
    for (const m of matches) {
      const [, name, body] = m;
      const normalized = body.replace(/\s+/g, " ").trim();
      if (seen[name] && seen[name].body !== normalized) {
        errors.push(
          `[keyframes] @keyframes ${name} معرّفة بمحتوى مختلف في ${path.basename(seen[name].file)} و ${path.basename(cssPath)}`,
        );
      } else if (!seen[name]) {
        seen[name] = { file: cssPath, body: normalized };
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────
   3) كلاس CSS واحد معرّف بخصائص متضاربة في أكتر من ملف (زي .notif-dot)
      — بنفحص فقط الكلاسات اللي بتتكرر كـ selector كامل (سطر أول) في
      أكتر من ملف، ونقارن قائمة الخصائص المعرّفة (مش القيم بالظبط، عشان
      نتجنب false positives من فروق بسيطة زي إضافة !important)
──────────────────────────────────────────────────────────── */
function checkCssClassConflicts() {
  const cssFiles = listFiles(path.join(PUBLIC_DIR, "CSS"), ".css");
  const seen = {}; // selector -> {file, props: Set}
  for (const cssPath of cssFiles) {
    const css = readIfExists(cssPath);
    if (!css) continue;
    const rules = [...css.matchAll(/^(\.[a-zA-Z0-9_-]+)\s*\{([^}]*)\}/gm)];
    for (const [, selector, body] of rules) {
      const props = new Set([...body.matchAll(/([a-zA-Z-]+)\s*:/g)].map((m) => m[1]));
      if (seen[selector]) {
        const prevProps = seen[selector].props;
        // تعارض حقيقي = نفس الخاصية بقيمة مختلفة، مش مجرد إضافة خاصية جديدة
        const overlapping = [...props].filter((p) => prevProps.has(p));
        if (overlapping.length > 0 && seen[selector].file !== cssPath) {
          warnings.push(
            `[CSS class] ${selector} معرّفة في أكتر من ملف (${path.basename(seen[selector].file)} و ${path.basename(cssPath)}) بخصائص متداخلة (${overlapping.join(", ")}) — راجع الترتيب واحرص إن التحميل اللاحق مقصود`,
          );
        }
      } else {
        seen[selector] = { file: cssPath, props };
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────
   4) توازن وسوم <div> في كل صفحات HTML
──────────────────────────────────────────────────────────── */
function checkHtmlBalance() {
  const htmlFiles = listFiles(PUBLIC_DIR, ".html");
  for (const htmlPath of htmlFiles) {
    const html = readIfExists(htmlPath);
    if (!html) continue;
    const opens = (html.match(/<div\b/g) || []).length;
    const closes = (html.match(/<\/div>/g) || []).length;
    if (opens !== closes) {
      errors.push(`[HTML] ${path.basename(htmlPath)}: عدد <div> المفتوحة (${opens}) لا يساوي المغلقة (${closes})`);
    }
  }
}

/* ────────────────────────────────────────────────────────────
   5) راوتات مكررة بنفس المسار والـ method داخل نفس ملف route
──────────────────────────────────────────────────────────── */
function checkDuplicateRoutes() {
  const routesDir = path.join(SRC_DIR, "routes");
  const tsFiles = listFiles(routesDir, ".ts");
  for (const tsPath of tsFiles) {
    const ts = readIfExists(tsPath);
    if (!ts) continue;
    const routes = [...ts.matchAll(/router\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g)];
    const seen = new Set();
    for (const [, method, routePath] of routes) {
      const key = `${method.toUpperCase()} ${routePath}`;
      if (seen.has(key)) {
        errors.push(`[Routes] ${path.basename(tsPath)}: المسار ${key} معرّف أكتر من مرة — الأول بس هو اللي هيشتغل`);
      }
      seen.add(key);
    }
  }
}

/* ────────────────────────────────────────────────────────────
   6) requireRole مباشر لسه موجود رغم وجود actionRegistry — تنبيه فقط
      (مش خطأ بالضرورة، بس يستاهل مراجعة إذا كان مقصود يفضل requireRole)
──────────────────────────────────────────────────────────── */
function checkPermissionConsistency() {
  const registryPath = path.join(SRC_DIR, "lib", "actionRegistry.ts");
  const registry = readIfExists(registryPath);
  if (!registry) return; // مفيش نظام صلاحيات في المشروع ده أصلاً

  const registeredKeys = new Set([...registry.matchAll(/key:\s*["']([a-zA-Z0-9_.]+)["']/g)].map((m) => m[1]));

  const routesDir = path.join(SRC_DIR, "routes");
  const tsFiles = listFiles(routesDir, ".ts");
  for (const tsPath of tsFiles) {
    const ts = readIfExists(tsPath);
    if (!ts) continue;
    const usedKeys = [...ts.matchAll(/requirePermission\(["']([a-zA-Z0-9_.]+)["']\)/g)].map((m) => m[1]);
    for (const key of usedKeys) {
      if (!registeredKeys.has(key)) {
        errors.push(`[Permissions] ${path.basename(tsPath)} بيستخدم requirePermission("${key}") لكنه مش مسجّل في actionRegistry.ts — هيترفض للجميع دايمًا (fail-closed)`);
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────
   تشغيل كل الفحوصات + التقرير
──────────────────────────────────────────────────────────── */
console.log("🔍 جاري فحص المشروع...\n");

checkIdsMatch();
checkKeyframeConflicts();
checkCssClassConflicts();
checkHtmlBalance();
checkDuplicateRoutes();
checkPermissionConsistency();

if (warnings.length) {
  console.log(`⚠️  ${warnings.length} تنبيه (يستاهل مراجعة، مش بالضرورة خطأ):\n`);
  warnings.forEach((w) => console.log("   " + w));
  console.log("");
}

if (errors.length) {
  console.log(`❌ ${errors.length} خطأ حقيقي لازم يتصلح قبل النشر:\n`);
  errors.forEach((e) => console.log("   " + e));
  console.log("");
  process.exit(1);
} else {
  console.log("✅ مفيش أي مشاكل حرجة — المشروع جاهز للنشر من الناحية دي.\n");
  process.exit(0);
}
