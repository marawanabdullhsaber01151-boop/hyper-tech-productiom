/** @format */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { asc, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { auditEventsTable, db } from "../db";
import { emptyChainState, verifyAuditBatch } from "./auditChain";
import { backupHealth, type LastRun } from "./backupCore";
import { DEPARTMENTS, getNavForRole } from "./departments";
import { purgeOldErrorEvents } from "./errorEvents";
import { USER_ROLES, type UserRole } from "./roles";
import {
  buildReport,
  countWord,
  rolesWithoutPages,
  runAll,
  statusFromCount,
  usersWithUnknownRole,
  type CheckDef,
  type CheckOutcome,
  type HealthReport,
} from "./systemHealthCore";

/** صفوف الاستعلام الخام (db.execute). */
async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(q);
  return r.rows as T[];
}
async function count(q: ReturnType<typeof sql>): Promise<number> {
  const r = await rows<{ n: number | string }>(q);
  return Number(r[0]?.n ?? 0);
}

const AUDIT_BATCH = 2000;
const AUDIT_MAX_ROWS = 100_000; // سقف عشان الفحص ما يتقلش على جدول ضخم؛ لو اتعدّى بنقول إنه فحص جزئي.

const days = (n: number) => sql`now() - make_interval(days => ${n})`;

const DEFS: CheckDef[] = [
  // ───────── الأساس ─────────
  {
    id: "database",
    group: "base",
    title: "قاعدة البيانات",
    run: async () => {
      const t0 = Date.now();
      await db.execute(sql`SELECT 1`);
      const ms = Date.now() - t0;
      if (ms > 2000) return { status: "bad", message: `قاعدة البيانات شغّالة بس بطيئة جدًا (${ms} م.ث للرد).`, action: "الشاشات هتبقى بطيئة. راجع باقة قاعدة البيانات (Neon) أو اتصل بالدعم الفني." };
      if (ms > 800) return { status: "warn", message: `قاعدة البيانات بترد بس أبطأ من المعتاد (${ms} م.ث).`, action: "لو الإحساس بالبطء مستمر، راجع باقة قاعدة البيانات." };
      return { status: "ok", message: `قاعدة البيانات شغّالة وبترد بسرعة (${ms} م.ث).` };
    },
  },
  {
    id: "migrations",
    group: "base",
    title: "تحديثات هيكل البيانات",
    run: async () => {
      const applied = new Set((await rows<{ filename: string }>(sql`SELECT filename FROM "_migrations_applied"`)).map((r) => r.filename));
      const dir = path.join(process.cwd(), "migrations");
      if (!existsSync(dir)) return { status: "ok", message: `${applied.size} تحديث متطبّق على قاعدة البيانات.` };
      const files = readdirSync(dir).filter((f) => /^\d{4}.*\.sql$/.test(f));
      const missing = files.filter((f) => !applied.has(f)).sort();
      if (missing.length) {
        return {
          status: "bad",
          message: `في ${countWord(missing.length, { one: "تحديث واحد", two: "تحديثين", few: "تحديثات", many: "تحديث" })} على قاعدة البيانات لسه ما اتطبّقش. الكود الجديد ممكن يفشل لحد ما يتطبّق.`,
          action: "شغّل أمر التحديث: npm run db:migrate (أو اطلب من الدعم الفني).",
          count: missing.length,
          examples: missing,
        };
      }
      return { status: "ok", message: `كل التحديثات (${files.length}) متطبّقة.` };
    },
  },
  {
    id: "config",
    group: "base",
    title: "إعدادات التشغيل",
    run: async () => {
      const required = ["DATABASE_URL", "JWT_SECRET"];
      const missing = required.filter((k) => !process.env[k]);
      if (missing.length) return { status: "bad", message: "في إعدادات تشغيل أساسية ناقصة.", action: "أضفها في إعدادات البيئة على Vercel ثم أعد النشر.", examples: missing };
      const weak = (process.env.JWT_SECRET ?? "").length < 32;
      if (weak) return { status: "warn", message: "مفتاح تأمين الجلسات قصير.", action: "غيّره لقيمة عشوائية طولها 32 حرف على الأقل في إعدادات Vercel." };
      return { status: "ok", message: "كل الإعدادات الأساسية موجودة." };
    },
  },

  {
    id: "data_findings",
    group: "base",
    title: "ملاحظات فحص جودة البيانات",
    run: async () => {
      const n = await count(sql`SELECT count(*)::int AS n FROM data_audit_findings WHERE status = 'open'`);
      if (!n) return { status: "ok", message: "مفيش ملاحظات مفتوحة على جودة البيانات." };
      return {
        status: statusFromCount(n, { warnAt: 1, badAt: 50 }),
        message: `في ${countWord(n, { one: "ملاحظة", two: "ملاحظتين", few: "ملاحظات", many: "ملاحظة" })} مفتوحة من فحص جودة البيانات (بيانات ناقصة أو متعارضة).`,
        action: "راجع الملاحظات وصحّح البيانات المتأثرة.",
        count: n,
      };
    },
  },

  {
    id: "backups",
    group: "base",
    title: "النسخ الاحتياطي واختبار الاسترجاع",
    run: async () => {
      // آخر تشغيلة لكل (نوع، مخزن). لو الجدول لسه ما اتعملش، فحص «تحديثات هيكل البيانات» فوق هو اللي بيقول.
      // آخر تشغيلة «ناجحة» بس هي اللي بتتحسب لعمر النسخة، لكن آخر محاولة فاشلة بتغلب لو أحدث منها.
      const last = await rows<{ kind: LastRun["kind"]; store: string; status: LastRun["status"]; finished_at: string | Date; error: string | null; size_bytes: string | null }>(sql`
        SELECT DISTINCT ON (kind, store) kind, store, status, finished_at, error, size_bytes::text
        FROM backup_runs ORDER BY kind, store, finished_at DESC`);
      const okSize = await rows<{ store: string; size_bytes: string | null }>(sql`
        SELECT DISTINCT ON (store) store, size_bytes::text FROM backup_runs WHERE kind = 'backup' AND status = 'ok' ORDER BY store, finished_at DESC`);
      const sizeBy = new Map(okSize.map((r) => [r.store, r.size_bytes ? Number(r.size_bytes) : null]));
      return backupHealth(
        last.map((r) => ({ kind: r.kind, store: r.store, status: r.status, finishedAt: new Date(r.finished_at), error: r.error, sizeBytes: r.kind === "backup" ? (sizeBy.get(r.store) ?? null) : null })),
        new Date(),
      );
    },
  },

  // ───────── الأمان ─────────
  {
    id: "audit_chain",
    group: "security",
    title: "سجل التدقيق (مفيش حد عدّل في التاريخ)",
    run: async () => {
      let state = emptyChainState();
      let lastId = 0;
      let total = 0;
      for (;;) {
        const batch = await db
          .select({
            id: auditEventsTable.id,
            actorUserId: auditEventsTable.actorUserId,
            actionKey: auditEventsTable.actionKey,
            resourceId: auditEventsTable.resourceId,
            createdAt: auditEventsTable.createdAt,
            prevHash: auditEventsTable.prevHash,
            recordHash: auditEventsTable.recordHash,
          })
          .from(auditEventsTable)
          .where(gt(auditEventsTable.id, lastId))
          .orderBy(asc(auditEventsTable.id))
          .limit(AUDIT_BATCH);
        if (batch.length === 0) break;
        const step = verifyAuditBatch(state, batch);
        state = step.state;
        total += batch.length;
        if (!step.verdict.valid) {
          return {
            status: "bad",
            message: `سجل التدقيق فيه تعديل مش طبيعي عند السجل رقم ${step.verdict.firstInvalidId}. ده معناه إن حد غيّر أو شال سجل قديم.`,
            action: "ده مؤشر أمان خطير. ما تمسحش حاجة، وكلّم الدعم الفني فورًا واحتفظ بنسخة من قاعدة البيانات.",
            count: 1,
          };
        }
        lastId = batch[batch.length - 1].id;
        if (batch.length < AUDIT_BATCH) break;
        if (total >= AUDIT_MAX_ROWS) return { status: "ok", message: `فحصنا أحدث ${total} سجل وكلهم سليمين (فحص جزئي لأن السجل كبير).` };
      }
      return { status: "ok", message: total ? `${total} سجل تدقيق، كلهم سليمين ومترابطين.` : "لسه مفيش سجلات تدقيق." };
    },
  },
  {
    id: "locked_accounts",
    group: "security",
    title: "حسابات مقفولة",
    run: async () => {
      const r = await rows<{ username: string }>(sql`SELECT username FROM system_users WHERE locked_until IS NOT NULL AND locked_until > now() ORDER BY username LIMIT 20`);
      if (!r.length) return { status: "ok", message: "مفيش حسابات موظفين مقفولة." };
      return {
        status: "warn",
        message: `${countWord(r.length, { one: "حساب موظف مقفول", two: "حسابين مقفولين", few: "حسابات مقفولة", many: "حساب مقفول" })} بسبب محاولات دخول غلط. ممكن يكون موظف نسي كلمة السر، وممكن حد بيحاول يخمّن.`,
        action: "اسأل الموظف لو هو. لو مش هو، غيّر كلمة سر الحساب من الإعدادات.",
        count: r.length,
        examples: r.map((x) => x.username),
        href: "/settings.html",
      };
    },
  },
  {
    id: "top_no_2fa",
    group: "security",
    title: "التحقق بخطوتين للإدارة العليا",
    run: async () => {
      const r = await rows<{ username: string }>(sql`SELECT username FROM system_users WHERE status = 'active' AND role IN ('chairman','executive_manager') AND COALESCE(totp_enabled,false) = false ORDER BY username`);
      if (!r.length) return { status: "ok", message: "كل حسابات الإدارة العليا مفعّل عليها التحقق بخطوتين." };
      return {
        status: "warn",
        message: `${countWord(r.length, { one: "حساب إدارة عليا", two: "حسابين إدارة عليا", few: "حسابات إدارة عليا", many: "حساب إدارة عليا" })} من غير تحقق بخطوتين. لو كلمة السر اتسرقت، مفيش حاجة تانية بتحمي الحساب.`,
        action: "فعّل التحقق بخطوتين من «حسابي» لكل حساب منهم.",
        count: r.length,
        examples: r.map((x) => x.username),
      };
    },
  },

  // ───────── الصلاحيات ─────────
  {
    id: "unknown_roles",
    group: "access",
    title: "موظفين بدور غير معروف",
    run: async () => {
      const users = await rows<{ username: string; role: string }>(sql`SELECT username, role FROM system_users WHERE status = 'active'`);
      const bad = usersWithUnknownRole(users, USER_ROLES);
      if (!bad.length) return { status: "ok", message: `كل الموظفين النشطين (${users.length}) أدوارهم معروفة.` };
      return {
        status: "bad",
        message: `${countWord(bad.length, { one: "موظف", two: "موظفين", few: "موظفين", many: "موظف" })} دورهم مش موجود في النظام، فكل صفحاتهم هتفشل أو تتمنع عنهم.`,
        action: "افتح الإعدادات ← المستخدمين وغيّر دور كل واحد منهم لدور صحيح.",
        count: bad.length,
        examples: bad.map((u) => `${u.username} (${u.role})`),
        href: "/settings.html",
      };
    },
  },
  {
    id: "roles_without_pages",
    group: "access",
    title: "أدوار من غير صفحات",
    run: async () => {
      const empty = rolesWithoutPages(USER_ROLES, (r) => getNavForRole(r as UserRole).flatMap((d) => d.subFunctions.flatMap((s) => s.pages)).length);
      if (!empty.length) return { status: "ok", message: "كل دور له صفحات يشتغل منها." };
      const used = await rows<{ role: string; n: number }>(sql`SELECT role, count(*)::int AS n FROM system_users WHERE status = 'active' AND role = ANY(${empty}) GROUP BY role`);
      const affected = used.reduce((a, b) => a + Number(b.n), 0);
      return {
        status: affected ? "bad" : "warn",
        message: affected ? `في ${affected} موظف نشط بدور ملوش أي صفحة في القايمة — هيدخلوا على نظام فاضي.` : "في أدوار معرّفة في النظام بس ملهاش أي صفحة (ولا حد نشط بيستخدمها دلوقتي).",
        action: "حدّد الصفحات المناسبة لكل دور من ملف الأقسام (الدعم الفني)، أو غيّر دور الموظفين.",
        count: empty.length,
        examples: empty,
      };
    },
  },
  {
    id: "nav_role_typos",
    group: "access",
    title: "صفحات مربوطة بدور مش موجود",
    run: async () => {
      const known = new Set<string>(USER_ROLES);
      const bad = new Set<string>();
      for (const d of DEPARTMENTS) {
        for (const r of d.roles) if (!known.has(r)) bad.add(`${d.id}: ${r}`);
        for (const s of d.subFunctions) {
          for (const r of s.roles) if (!known.has(r)) bad.add(`${s.id}: ${r}`);
          for (const p of s.pages) for (const r of p.roles) if (!known.has(r)) bad.add(`${p.id}: ${r}`);
        }
      }
      if (!bad.size) return { status: "ok", message: "كل أدوار الصفحات مكتوبة صح." };
      return { status: "bad", message: "في صفحات مربوطة بدور اسمه غلط، فالصفحة دي مش هتظهر لحد.", action: "صحّح اسم الدور في ملف الأقسام (الدعم الفني).", count: bad.size, examples: [...bad] };
    },
  },

  // ───────── المبيعات ─────────
  {
    id: "invoice_totals",
    group: "sales",
    title: "إجمالي الفواتير مطابق للأصناف",
    run: async () => {
      const bad = await rows<{ order_number: string; total: string; items: string }>(sql`
        SELECT so.order_number, so.total::text, COALESCE(SUM(i.total),0)::text AS items
        FROM sales_orders so
        LEFT JOIN sales_order_items i ON i.order_id = so.id
        WHERE so.status <> 'cancelled'
        GROUP BY so.id
        HAVING ABS(so.total - COALESCE(SUM(i.total),0)) > 0.01
        ORDER BY so.id DESC LIMIT 50`);
      if (!bad.length) return { status: "ok", message: "إجمالي كل فاتورة بيساوي مجموع أصنافها." };
      return {
        status: "bad",
        message: `${countWord(bad.length, { one: "فاتورة", two: "فاتورتين", few: "فواتير", many: "فاتورة" })} إجماليها مش بيساوي مجموع الأصناف. الأرقام المالية فيها هتبقى غلط.`,
        action: "افتح كل فاتورة وراجع الأسعار والكميات، وعدّلها لحد ما الإجمالي يتصحح.",
        count: bad.length,
        examples: bad.map((b) => `${b.order_number}: الإجمالي ${b.total} والأصناف ${b.items}`),
        href: "/v2/staff/sales",
      };
    },
  },
  {
    id: "channel_mismatch",
    group: "sales",
    title: "فواتير أونلاين وأوفلاين متلخبطة",
    run: async () => {
      const bad = await rows<{ order_number: string; channel: string; role: string }>(sql`
        SELECT so.order_number, so.channel, u.role
        FROM sales_orders so JOIN system_users u ON u.id = so.created_by_id
        WHERE (u.role = 'online_seller' AND so.channel <> 'website')
           OR (u.role = 'offline_seller' AND so.channel <> 'direct')
        ORDER BY so.id DESC LIMIT 50`);
      if (!bad.length) return { status: "ok", message: "كل فاتورة بائع أونلاين/أوفلاين في قناتها الصحيحة." };
      return {
        status: "warn",
        message: `${countWord(bad.length, { one: "فاتورة", two: "فاتورتين", few: "فواتير", many: "فاتورة" })} ظاهرة في قناة غير قناة البائع اللي عملها، فهتظهر في الصفحة الغلط.`,
        action: "صحّح قناة الفاتورة من تفاصيلها.",
        count: bad.length,
        examples: bad.map((b) => `${b.order_number} (${b.channel === "website" ? "أونلاين" : "أوفلاين"}، منشئها ${b.role === "online_seller" ? "بائع أونلاين" : "بائع أوفلاين"})`),
        href: "/v2/staff/sales",
      };
    },
  },
  {
    id: "stale_drafts",
    group: "sales",
    title: "فواتير مسودة منسية",
    run: async () => {
      const n = await count(sql`SELECT count(*)::int AS n FROM sales_orders WHERE status = 'draft' AND created_at < ${days(14)}`);
      if (!n) return { status: "ok", message: "مفيش فواتير مسودة قديمة." };
      return {
        status: statusFromCount(n, { warnAt: 1, badAt: 30 }),
        message: `${countWord(n, { one: "فاتورة", two: "فاتورتين", few: "فواتير", many: "فاتورة" })} مسودة بقالها أكتر من ١٤ يوم من غير ما تتأكد أو تتلغي.`,
        action: "راجعها: أكّدها لو صحيحة، أو الغيها.",
        count: n,
        href: "/v2/staff/sales",
      };
    },
  },

  // ───────── العملاء والبوابة ─────────
  {
    id: "customers_no_owner",
    group: "customers",
    title: "عملاء من غير مسؤول مبيعات",
    run: async () => {
      const r = await rows<{ company_name: string }>(sql`SELECT company_name FROM portal_customers WHERE is_active = true AND archived_at IS NULL AND assigned_sales_user_id IS NULL ORDER BY id DESC LIMIT 50`);
      if (!r.length) return { status: "ok", message: "كل عميل نشط ليه مسؤول مبيعات." };
      return {
        status: "warn",
        message: `${countWord(r.length, { one: "شركة", two: "شركتين", few: "شركات", many: "شركة" })} نشطة ملهاش مسؤول مبيعات، فمحدش متابع طلباتها ورسايلها.`,
        action: "افتح الشركة وحدّد المسؤول من تبويب الفريق.",
        count: r.length,
        examples: r.map((x) => x.company_name),
        href: "/v2/admin/portal-customers",
      };
    },
  },
  {
    id: "applications_waiting",
    group: "customers",
    title: "طلبات انضمام مستنية رد",
    run: async () => {
      const n = await count(sql`SELECT count(*)::int AS n FROM portal_applications WHERE status = 'pending' AND created_at < ${days(3)}`);
      if (!n) return { status: "ok", message: "مفيش طلبات انضمام متأخرة." };
      return { status: statusFromCount(n, { warnAt: 1, badAt: 10 }), message: `${countWord(n, { one: "طلب انضمام", two: "طلبي انضمام", few: "طلبات انضمام", many: "طلب انضمام" })} بقالهم أكتر من ٣ أيام من غير رد. العميل مستني.`, action: "افتح الطلبات ووافق أو ارفض.", count: n, href: "/v2/admin/portal-applications" };
    },
  },
  {
    id: "activation_waiting",
    group: "customers",
    title: "طلبات تفعيل مستنية رد",
    run: async () => {
      const n = await count(sql`SELECT count(*)::int AS n FROM portal_activation_requests WHERE status = 'pending' AND created_at < ${days(3)}`);
      if (!n) return { status: "ok", message: "مفيش طلبات تفعيل متأخرة." };
      return { status: statusFromCount(n, { warnAt: 1, badAt: 10 }), message: `${countWord(n, { one: "طلب تفعيل", two: "طلبي تفعيل", few: "طلبات تفعيل", many: "طلب تفعيل" })} بقالهم أكتر من ٣ أيام من غير رد.`, action: "افتح الطلبات وراجعها.", count: n, href: "/v2/admin/portal-activation-requests" };
    },
  },
  {
    id: "chat_waiting",
    group: "customers",
    title: "عملاء مستنيين رد في الشات",
    run: async () => {
      const n = await count(sql`SELECT count(*)::int AS n FROM chat_conversations WHERE status = 'open' AND awaiting_staff_since IS NOT NULL AND awaiting_staff_since < now() - interval '1 day'`);
      if (!n) return { status: "ok", message: "مفيش عميل مستني رد في الشات أكتر من يوم." };
      return { status: statusFromCount(n, { warnAt: 1, badAt: 5 }), message: `${countWord(n, { one: "عميل", two: "عميلين", few: "عملاء", many: "عميل" })} كتبوا في الشات ومستنيين رد بقاله أكتر من يوم.`, action: "افتح الشات ورد عليهم.", count: n, href: "/v2/admin/portal-chat" };
    },
  },
  {
    id: "messages_failed",
    group: "customers",
    title: "رسائل ما وصلتش للعملاء",
    run: async () => {
      const n = await count(sql`SELECT count(*)::int AS n FROM portal_outbox WHERE status = 'failed' AND created_at > now() - interval '1 day'`);
      if (!n) return { status: "ok", message: "كل الرسائل (كود التفعيل والإشعارات) أُرسلت بنجاح آخر ٢٤ ساعة." };
      return {
        status: statusFromCount(n, { warnAt: 1, badAt: 10 }),
        message: `${countWord(n, { one: "رسالة", two: "رسالتين", few: "رسائل", many: "رسالة" })} للعملاء فشل إرسالها آخر ٢٤ ساعة (كود تفعيل أو إشعار). العميل ممكن يكون مستني كود ومش جاي.`,
        action: "راجع إعدادات قنوات الإرسال (SMS/واتساب/إيميل) في إعدادات البوابة، وأعد إرسال الكود للعملاء المتأثرين.",
        count: n,
        href: "/v2/admin/portal-customers/settings",
      };
    },
  },

  // ───────── المخزون ─────────
  {
    id: "negative_stock",
    group: "stock",
    title: "كميات مخزون بالسالب",
    run: async () => {
      const r = await rows<{ name: string; qty: string }>(sql`SELECT name, qty::text FROM inventory_items WHERE qty < 0 ORDER BY qty LIMIT 50`);
      if (!r.length) return { status: "ok", message: "مفيش صنف كميته بالسالب." };
      return { status: "bad", message: `${countWord(r.length, { one: "صنف", two: "صنفين", few: "أصناف", many: "صنف" })} كميته بالسالب، ودي معناها إن حركة صرف اتسجلت أكتر من الموجود.`, action: "راجع حركات المخزون للصنف وصحّح الكمية بجرد فعلي.", count: r.length, examples: r.map((x) => `${x.name}: ${x.qty}`), href: "/v2/staff/stock" };
    },
  },
  {
    id: "over_reserved",
    group: "stock",
    title: "محجوز أكتر من الموجود",
    run: async () => {
      const r = await rows<{ name: string; qty: string; reserved_qty: string }>(sql`SELECT name, qty::text, reserved_qty::text FROM inventory_items WHERE reserved_qty > qty AND qty >= 0 ORDER BY id DESC LIMIT 50`);
      if (!r.length) return { status: "ok", message: "مفيش صنف محجوز منه أكتر من الموجود." };
      return { status: "warn", message: `${countWord(r.length, { one: "صنف", two: "صنفين", few: "أصناف", many: "صنف" })} محجوز منه أكتر من الكمية الفعلية، فأوامر هتتعطّل أو تتأخر.`, action: "راجع الحجوزات القديمة وفك اللي مالوش لازمة، أو وفّر الكمية.", count: r.length, examples: r.map((x) => `${x.name}: موجود ${x.qty}، محجوز ${x.reserved_qty}`), href: "/v2/staff/stock" };
    },
  },

  // ───────── الأخطاء ─────────
  {
    id: "recent_errors",
    group: "errors",
    title: "أخطاء السيرفر آخر ٢٤ ساعة",
    run: async () => {
      // تنظيف القديم (٣٠ يوم) — لو فشل مش مشكلة
      void purgeOldErrorEvents().catch(() => undefined);
      const n = await count(sql`SELECT count(*)::int AS n FROM app_error_events WHERE created_at > now() - interval '1 day'`);
      if (!n) return { status: "ok", message: "مفيش أخطاء غير متوقعة آخر ٢٤ ساعة." };
      const top = await rows<{ path: string; method: string; n: number; ref: string }>(sql`
        SELECT path, method, count(*)::int AS n, (array_agg(reference ORDER BY created_at DESC))[1] AS ref
        FROM app_error_events WHERE created_at > now() - interval '1 day'
        GROUP BY path, method ORDER BY n DESC LIMIT 5`);
      return {
        status: statusFromCount(n, { warnAt: 1, badAt: 10 }),
        message: `حصل ${countWord(n, { one: "خطأ واحد", two: "خطآن", few: "أخطاء", many: "خطأ" })} غير متوقع آخر ٢٤ ساعة. يعني في شاشة أو عملية فشلت مع مستخدم.`,
        action: "ابعت المرجع (ERR-…) للدعم الفني عشان يوصل للسبب بالظبط. لو الأخطاء في نفس المكان، هو ده المكان المعطّل.",
        count: n,
        examples: top.map((t) => `${t.path} (${t.n} مرة) — مرجع ${t.ref}`),
      };
    },
  },
];

export const HEALTH_CHECK_IDS = DEFS.map((d) => d.id);

export async function runSystemHealth(): Promise<HealthReport> {
  const checks = await runAll(DEFS);
  return buildReport(checks);
}

export type { CheckOutcome };
