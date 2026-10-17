#!/usr/bin/env node
/**
 * أداة التسليم (docs/handoff/03-delivery-protocol.md).
 *
 *   node scripts/delivery-pack.mjs pack   --phase 1-staff-shell --base v-phase-0
 *   node scripts/delivery-pack.mjs pack   --phase hardening-1 --base-dir ../baseline-copy
 *   node scripts/delivery-pack.mjs verify --dir delivery/1-staff-shell [--root .]
 *
 * pack   : يحسب الملفات الجديدة/المعدّلة/المحذوفة مقارنةً بـ(git ref أو مجلد أساس)، وينسخ الجديد والمعدّل
 *          (كاملًا، بنفس المسارات) داخل files/، ويكتب MANIFEST.md وCOMMANDS.md وchecksums.json،
 *          وبعدين يعمل ملف zip (بدون أي حزم خارجية ولا أمر zip خارجي، عشان يشتغل على Windows).
 * verify : بعد النسخ فوق المشروع، يتأكد إن كل ملف مطابق للبصمة وإن المحذوف اتشال. يطلع ✔ أو يحدد الملف الغلط.
 *
 * ضمانات: لا يضم أبدًا .env* ولا node_modules ولا dist ولا delivery، ويرفض أسماء بمسافات/حروف عربية،
 * ويفشل لو لقى سر محتمل (مفتاح خاص أو رابط قاعدة بيانات بكلمة مرور حقيقية) إلا لو --allow-secrets.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/* ───────────── أدوات عامة ───────────── */

const IGNORE_DIRS = new Set([
  "node_modules", "dist", "delivery", ".git", ".vercel", "coverage", ".vite", ".turbo",
]);
const IGNORE_PREFIXES = ["public/v2/", "web/dist/"];
const IGNORE_FILE = (rel) => {
  const base = rel.split("/").pop();
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) return true;
  if (base === ".DS_Store" || base === "Thumbs.db" || base.endsWith(".log")) return true;
  if (rel.endsWith(".zip") && rel.startsWith("delivery/")) return true;
  return IGNORE_PREFIXES.some((p) => rel.startsWith(p));
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const toPosix = (p) => p.split(path.sep).join("/");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) options[key] = true;
    else { options[key] = next; i++; }
  }
  return { command, options };
}

function walk(root) {
  const out = new Map();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, full));
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        visit(full);
      } else if (entry.isFile() && !IGNORE_FILE(rel)) {
        out.set(rel, sha256(readFileSync(full)));
      }
    }
  };
  visit(root);
  return out;
}

/* ───────────── حساب التغييرات ───────────── */

function changesFromDir(root, baseDir) {
  const now = walk(root);
  const before = walk(baseDir);
  const added = [], modified = [], deleted = [];
  for (const [rel, hash] of now) {
    if (!before.has(rel)) added.push(rel);
    else if (before.get(rel) !== hash) modified.push(rel);
  }
  for (const rel of before.keys()) if (!now.has(rel)) deleted.push(rel);
  return { added, modified, deleted };
}

function changesFromGit(root, baseRef) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const added = [], modified = [], deleted = [];
  for (const line of git("diff", "--name-status", "--no-renames", baseRef).split("\n")) {
    if (!line.trim()) continue;
    const [status, ...fileParts] = line.split("\t");
    const rel = toPosix(fileParts.join("\t"));
    if (IGNORE_FILE(rel) || rel.split("/").some((part) => IGNORE_DIRS.has(part))) continue;
    if (status === "A") added.push(rel);
    else if (status === "D") deleted.push(rel);
    else modified.push(rel);
  }
  for (const rel of git("ls-files", "--others", "--exclude-standard").split("\n")) {
    const clean = toPosix(rel.trim());
    if (!clean || IGNORE_FILE(clean) || clean.split("/").some((part) => IGNORE_DIRS.has(part))) continue;
    if (!added.includes(clean)) added.push(clean);
  }
  return { added, modified, deleted };
}

/* ───────────── فحوصات الأمان والجودة ───────────── */

const SECRET_PATTERNS = [
  { name: "مفتاح خاص", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    name: "رابط قاعدة بيانات بكلمة مرور",
    regex: /postgres(?:ql)?:\/\/[^:\s/]+:(?!ci@|password|your-|<|\$\{|ci\b|postgres\b|changeme|xxx|\*)[^@\s]{6,}@(?!localhost|127\.0\.0\.1)/i,
  },
  { name: "توكن شائع", regex: /\b(?:ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/ },
];

function scanForProblems(root, files) {
  const errors = [];
  for (const rel of files) {
    // مسارات: إنجليزي بدون مسافات (مشكلة README القديم)
    if (!/^[A-Za-z0-9._\-\/\[\]@+]+$/.test(rel)) errors.push(`مسار غير مسموح (مسافات أو حروف غير لاتينية): ${rel}`);
    const full = path.join(root, rel);
    const size = statSync(full).size;
    if (size > 2_000_000 || /\.(png|jpe?g|webp|woff2?|ico|zip|gif|mp4)$/i.test(rel)) continue;
    const text = readFileSync(full, "utf8");
    if (text.charCodeAt(0) === 0xfeff) errors.push(`BOM في بداية الملف (ممنوع): ${rel}`);
    if (/\.(ts|tsx|js|mjs|md|sql|json|css|html)$/.test(rel) && text.includes("\r\n")) {
      errors.push(`نهايات أسطر CRLF (المطلوب LF): ${rel}`);
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(text)) errors.push(`سر محتمل (${pattern.name}) في: ${rel}`);
    }
  }
  return errors;
}

/* ───────────── كتابة ZIP (بدون حزم) ───────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeZip(zipPath, entries) {
  const date = new Date();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(zipPath, Buffer.concat([...locals, ...centrals, end]));
}

/* ───────────── توليد المستندات ───────────── */

const short = (hash) => hash.slice(0, 12);
const kb = (bytes) => (bytes / 1024).toFixed(1);

function rollbackNotes(root, migrations) {
  const notes = [];
  for (const rel of migrations) {
    const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
    const start = lines.findIndex((line) => /^--\s*Rollback:/i.test(line));
    if (start === -1) continue;
    const block = [];
    for (let i = start + 1; i < lines.length && /^--/.test(lines[i]); i++) block.push(lines[i].replace(/^--\s?/, ""));
    notes.push({ file: rel, sql: block.filter((l) => l.trim()).join("\n") });
  }
  return notes;
}

function buildManifest({ phase, base, added, modified, deleted, hashes, sizes, migrations, envNotes }) {
  const row = (rel, kind, note = "") => `| \`${rel}\` | ${kind} | ${kb(sizes.get(rel) ?? 0)} KB | \`${short(hashes.get(rel) ?? "")}\` | ${note} |`;
  const table = (items, kind) =>
    items.length
      ? ["| الملف | النوع | الحجم | sha256 | ملاحظة |", "|---|---|---|---|---|", ...items.map((rel) => row(rel, kind))].join("\n")
      : "_لا يوجد_";
  return `# MANIFEST — ${phase}

- الأساس: \`${base}\`
- التاريخ: ${new Date().toISOString().slice(0, 10)}
- الإجمالي: ${added.length} جديد، ${modified.length} معدّل، ${deleted.length} محذوف

## ١) ملفات جديدة (A)
${table(added, "جديد")}

## ٢) ملفات معدّلة (M) — الملف كامل يستبدل القديم
${table(modified, "معدّل")}

## ٣) نقل/إعادة تسمية (R)
_الأداة تعامل النقل كحذف + إضافة؛ شوف §١ و§٤._

## ٤) ملفات محذوفة (D) — أوامر المسح في COMMANDS.md §٢
${deleted.length ? deleted.map((rel) => `- \`${rel}\``).join("\n") : "_لا يوجد_"}

## ٥) هجرات قاعدة البيانات
${migrations.length ? migrations.map((rel) => `- \`${rel}\``).join("\n") : "_لا يوجد_"}

## ٦) متغيرات بيئة
${envNotes.length ? envNotes.map((n) => `- ${n}`).join("\n") : "_لا يوجد تغيير في .env.example_"}
`;
}

function buildCommands({ phase, added, modified, deleted, migrations, rollbacks, packageChanged }) {
  const dirs = [...new Set(deleted.map((rel) => path.posix.dirname(rel)))];
  const bashDeletes = deleted.map((rel) => `rm -f "${rel}"`).join("\n") || "# لا يوجد ملفات للمسح";
  const psDeletes =
    deleted.map((rel) => `Remove-Item -LiteralPath "${rel.replace(/\//g, "\\")}" -Force -ErrorAction SilentlyContinue`).join("\n") ||
    "# لا يوجد ملفات للمسح";
  const steps = [
    packageChanged ? "npm ci --include=dev" : null,
    migrations.length ? "npm run db:migrate" : null,
    "npm run check:all",
    migrations.length ? "npm run check:e2e" : null,
  ].filter(Boolean);
  const verify = "node scripts/delivery-pack.mjs verify --dir <مسار-مجلد-الحزمة-المفكوكة> --root .";
  return `# COMMANDS — ${phase}

> ${migrations.length ? "⚠️ الحزمة فيها هجرة قاعدة بيانات: **خد نسخة احتياطية (pg_dump أو فرع Neon) قبل ما تبدأ.**" : "الحزمة مفيهاش هجرات قاعدة بيانات."}

## ١) نسخ الملفات فوق المشروع
\`\`\`bash
# من جذر المشروع، و<PKG> = مجلد الحزمة المفكوكة
cp -R <PKG>/files/. .
\`\`\`
\`\`\`powershell
Copy-Item -Recurse -Force "<PKG>\\files\\*" .
\`\`\`

## ٢) مسح الملفات المحذوفة (${deleted.length})
\`\`\`bash
${bashDeletes}
\`\`\`
\`\`\`powershell
${psDeletes}
\`\`\`
${dirs.length ? `> مجلدات ممكن تفضل فاضية بعد المسح: ${dirs.map((d) => `\`${d}\``).join("، ")} — امسحها لو فاضية.\n` : ""}
## ٣) الحزم والبيئة
${packageChanged ? "- \`package.json\` اتغيّر: نفّذ \`npm ci --include=dev\`." : "- مفيش تغيير في الحزم."}
- راجع \`.env.example\` لو فيه متغير جديد وضيفه في Vercel/\`.env\`.

## ٤) الهجرات والتحقق
\`\`\`bash
${steps.join("\n")}
${verify}
\`\`\`

## ٥) الرجوع (Rollback)
- الكود: ارجع للنسخة السابقة من ملفات الحزمة (git checkout أو النسخة الاحتياطية للمجلد)، وأعد النشر.
${rollbacks.length ? rollbacks.map((r) => `- هجرة \`${r.file}\`:\n\`\`\`sql\n${r.sql}\n\`\`\``).join("\n") : "- مفيش هجرات تحتاج رجوع."}
- لو الهجرة اتنفذت وفيها بيانات: استرجع من النسخة الاحتياطية اللي أخدتها قبل التنفيذ.
`;
}

/* ───────────── pack ───────────── */

function pack(options) {
  const root = path.resolve(options.root ?? ".");
  const phase = options.phase;
  if (!phase || phase === true || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(phase)) {
    console.error("❌ --phase مطلوب (حروف إنجليزي/أرقام/شرطة فقط)، مثال: --phase 1-staff-shell");
    process.exit(2);
  }
  let changes, baseLabel;
  if (options["base-dir"]) {
    const baseDir = path.resolve(options["base-dir"]);
    if (!existsSync(baseDir)) { console.error(`❌ مجلد الأساس غير موجود: ${baseDir}`); process.exit(2); }
    changes = changesFromDir(root, baseDir);
    baseLabel = `dir:${path.basename(baseDir)}`;
  } else if (options.base && options.base !== true) {
    changes = changesFromGit(root, options.base);
    baseLabel = options.base;
  } else {
    console.error("❌ لازم --base <git-ref> أو --base-dir <مجلد>");
    process.exit(2);
  }
  const { added, modified, deleted } = changes;
  added.sort(); modified.sort(); deleted.sort();
  const shipped = [...added, ...modified];
  if (!shipped.length && !deleted.length) { console.error("❌ مفيش أي تغيير يتسلّم."); process.exit(2); }

  const problems = scanForProblems(root, shipped);
  const blocking = options["allow-secrets"] ? problems.filter((p) => !p.startsWith("سر محتمل")) : problems;
  if (blocking.length) {
    console.error("❌ التسليم مرفوض:\n" + blocking.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }

  const outRoot = path.resolve(options.out ?? path.join(root, "delivery"));
  const pkgDir = path.join(outRoot, phase);
  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(path.join(pkgDir, "files"), { recursive: true });

  const hashes = new Map();
  const sizes = new Map();
  for (const rel of shipped) {
    const source = path.join(root, rel);
    const target = path.join(pkgDir, "files", rel);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    const buffer = readFileSync(source);
    hashes.set(rel, sha256(buffer));
    sizes.set(rel, buffer.length);
  }

  const migrations = shipped.filter((rel) => /^migrations\/\d{4}.*\.sql$/.test(rel));
  const packageChanged = shipped.includes("package.json") || shipped.includes("package-lock.json");
  const envNotes = shipped.includes(".env.example") ? ["`.env.example` اتعدّل — راجع المتغيرات الجديدة وضيفها في Vercel."] : [];

  const manifest = buildManifest({ phase, base: baseLabel, added, modified, deleted, hashes, sizes, migrations, envNotes });
  const commands = buildCommands({
    phase, added, modified, deleted, migrations, packageChanged,
    rollbacks: rollbackNotes(root, migrations),
  });
  const checksums = {
    phase,
    base: baseLabel,
    createdAt: new Date().toISOString(),
    files: Object.fromEntries([...hashes].sort(([a], [b]) => a.localeCompare(b))),
    deleted,
  };
  writeFileSync(path.join(pkgDir, "MANIFEST.md"), manifest);
  writeFileSync(path.join(pkgDir, "COMMANDS.md"), commands);
  writeFileSync(path.join(pkgDir, "checksums.json"), JSON.stringify(checksums, null, 2) + "\n");

  const entries = [
    ...["MANIFEST.md", "COMMANDS.md", "checksums.json"].map((name) => ({ name, data: readFileSync(path.join(pkgDir, name)) })),
    ...shipped.map((rel) => ({ name: `files/${rel}`, data: readFileSync(path.join(pkgDir, "files", rel)) })),
  ];
  const zipPath = path.join(outRoot, `${phase}.zip`);
  writeZip(zipPath, entries);

  console.log(`✅ حزمة ${phase}: ${added.length} جديد، ${modified.length} معدّل، ${deleted.length} محذوف`);
  console.log(`   ${pkgDir}`);
  console.log(`   ${zipPath} (${kb(statSync(zipPath).size)} KB)`);
}

/* ───────────── verify ───────────── */

function verify(options) {
  const dir = options.dir && options.dir !== true ? path.resolve(options.dir) : null;
  const root = path.resolve(options.root ?? ".");
  if (!dir || !existsSync(path.join(dir, "checksums.json"))) {
    console.error("❌ --dir لازم يشاور على مجلد حزمة فيه checksums.json");
    process.exit(2);
  }
  const { files, deleted, phase } = JSON.parse(readFileSync(path.join(dir, "checksums.json"), "utf8"));
  const wrong = [];
  for (const [rel, expected] of Object.entries(files)) {
    const full = path.join(root, rel);
    if (!existsSync(full)) wrong.push(`ناقص: ${rel}`);
    else if (sha256(readFileSync(full)) !== expected) wrong.push(`مختلف عن الحزمة: ${rel}`);
  }
  for (const rel of deleted) if (existsSync(path.join(root, rel))) wrong.push(`المفروض اتمسح: ${rel}`);
  if (wrong.length) {
    console.error(`✖ ${phase}: ${wrong.length} مشكلة\n` + wrong.map((w) => `  - ${w}`).join("\n"));
    process.exit(1);
  }
  console.log(`✔ ${phase}: ${Object.keys(files).length} ملف مطابق، ${deleted.length} محذوف تمام.`);
}

/* ───────────── main ───────────── */

const { command, options } = parseArgs(process.argv.slice(2));
if (command === "pack") pack(options);
else if (command === "verify") verify(options);
else {
  console.error("الاستخدام:\n  pack   --phase <اسم> (--base <git-ref> | --base-dir <مجلد>) [--root .] [--out delivery]\n  verify --dir <مجلد-الحزمة> [--root .]");
  process.exit(2);
}
