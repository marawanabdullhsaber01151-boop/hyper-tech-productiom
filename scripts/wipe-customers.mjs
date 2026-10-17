#!/usr/bin/env node
/**
 * مسح نهائي لكل العملاء وكل اللي يخصهم من السيستم، كأنه لسه جديد.
 *
 * بيمسح:
 *  - العملاء (جهات الاتصال من نوع «عميل») وشركات البوابة وموظفيها وكل حساباتهم وجلساتهم وأكوادهم
 *  - طلبات الانضمام وطلبات التفعيل ورسائل البوابة وسجل نشاط البوابة
 *  - أوامر البيع (الفواتير) وبنودها، وطلبات البوابة، وأوامر الإنتاج المرتبطة بيهم وكل توابعها
 *  - المحادثات والرسائل والمرفقات والتقييمات
 *  - الإشعارات وسجلات التدقيق والموافقات والمراجعات المتعلقة بيهم (بما فيها سجل تدقيق المسح نفسه: مفيش أي أثر)
 *  - حركات المخزون المرتبطة بالطلبات، وبيرجّع الكميات لأصلها
 * وبيصفّر عدّادات الأرقام (ID) للجداول اللي اتأثرت، وبيعيد بناء سلسلة التدقيق عشان تفضل سليمة.
 *
 * مابيلمسش: المستخدمين (الموظفين)، إعدادات النظام، إعدادات البوابة العامة، الأدوار الجاهزة،
 *  المخزون نفسه (الأصناف)، الموردين، الوصفات، وأي بيانات مش مرتبطة بعميل.
 *
 * الاستخدام:
 *   node scripts/wipe-customers.mjs --dry-run     (يعرض اللي هيتمسح ومابيمسحش حاجة)
 *   node scripts/wipe-customers.mjs               (بيطلب منك تكتب: امسح العملاء)
 *
 * ⚠️ نهائي ومالوش رجوع. خُد نسخة احتياطية قبل ما تشغّله (فرع Neon أو pg_dump).
 */
import "dotenv/config";
import crypto from "node:crypto";
import readline from "node:readline";
import pkg from "pg";

const { Pool } = pkg;
const dryRun = process.argv.includes("--dry-run");
const CONFIRM_PHRASE = "امسح العملاء";

const PROTECTED = new Set(["system_users", "system_settings", "_migrations_applied", "phase0_number_sequences", "approval_policies", "sod_rules", "foundation_state_transitions", "delivery_method_rules", "inventory_items", "login_sessions", "app_state"]);

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
const w = (table) => q(`w_${table}`);

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL مش موجود. ماحصلش أي حاجة.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const log = (s = "") => console.log(s);

  try {
    await client.query("BEGIN");
    // صيانة معلنة على سجل التدقيق (هجرة 0077) — بتنتهي مع الـtransaction
    await client.query("SET LOCAL hypertech.audit_maintenance = 'on'");

    /* ---------- خريطة العلاقات ---------- */
    const { rows: fkRows } = await client.query(`
      select c.conrelid::regclass::text as child, ca.attname as child_col,
             c.confrelid::regclass::text as parent, c.confdeltype as rule
      from pg_constraint c
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = any(c.conkey)
      join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = 'public'`);
    const edges = fkRows.map((r) => ({ child: r.child.replace(/"/g, ""), col: r.child_col, parent: r.parent.replace(/"/g, ""), setNull: r.rule === "n" }));

    const { rows: tableRows } = await client.query(`
      select c.relname as t,
        exists (select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
                where i.indrelid=c.oid and i.indisprimary and a.attname='id' and i.indnatts=1) as has_id
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`);
    const hasId = new Map(tableRows.map((r) => [r.t, r.has_id]));
    const exists = (t) => hasId.has(t);

    const tracked = new Set(); // جداول ليها w_ table
    const ensure = async (t) => {
      if (tracked.has(t)) return;
      await client.query(`create temp table ${w(t)} (id integer primary key) on commit drop`);
      tracked.add(t);
    };
    const seed = async (t, whereSql, params = []) => {
      if (!exists(t) || !hasId.get(t)) return 0;
      await ensure(t);
      const r = await client.query(`insert into ${w(t)} select id from ${q(t)} where ${whereSql} on conflict do nothing`, params);
      return r.rowCount ?? 0;
    };
    const inSet = (t) => (tracked.has(t) ? `select id from ${w(t)}` : `select null::int where false`);

    /* ---------- الجذور ---------- */
    await seed("contacts", `type = 'customer'`);
    await seed("portal_customers", `true`);
    await seed("portal_users", `true`);
    await seed("portal_applications", `true`);
    await seed("portal_activation_requests", `true`);
    await seed("sales_orders", `true`);
    await seed("portal_audit_events", `true`);
    await seed("portal_outbox", `true`);
    await seed("portal_order_reviews", `true`);
    await ensure("production_workflow_orders");
    await client.query(`insert into ${w("production_workflow_orders")} select id from production_workflow_orders
      where customer_name is not null or customer_phone is not null or customer_email is not null or portal_customer_id is not null
         or sales_order_id is not null or root_sales_order_id is not null on conflict do nothing`);

    /* ---------- توسيع: كل اللي بيشاور على اللي هيتمسح ---------- */
    const nullOuts = new Map(); // "child.col" -> parent
    const directDeletes = []; // جداول من غير id
    const expand = async () => {
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of edges) {
          if (!tracked.has(e.parent)) continue;
          if (e.child === e.parent) {
            // علاقة ذاتية (أب/ابن): الابن يتمسح مع الأب
          }
          if (e.setNull) {
            nullOuts.set(`${e.child}.${e.col}`, e);
            continue;
          }
          if (PROTECTED.has(e.child)) throw new Error(`الجدول المحمي ${e.child} بيشاور على بيانات عملاء (${e.parent}). وقفت عشان ماعملش ضرر.`);
          if (!hasId.get(e.child)) {
            if (!directDeletes.some((d) => d.child === e.child && d.col === e.col)) directDeletes.push(e);
            continue;
          }
          await ensure(e.child);
          const r = await client.query(`insert into ${w(e.child)} select id from ${q(e.child)} where ${q(e.col)} in (select id from ${w(e.parent)}) on conflict do nothing`);
          if ((r.rowCount ?? 0) > 0) grew = true;
        }
      }
    };
    await expand();

    /* ---------- مراجع من غير مفتاح أجنبي (النوع + الرقم) ---------- */
    const refMap = {
      sales_order: "sales_orders", sales: "sales_orders", sales_orders: "sales_orders",
      production_workflow: "production_workflow_orders", workflow_order: "production_workflow_orders",
      contact: "contacts", contacts: "contacts", customer: "contacts",
      portal_application: "portal_applications", portal_customer: "portal_customers",
    };
    const typeList = (target) => Object.entries(refMap).filter(([, v]) => v === target).map(([k]) => `'${k}'`).join(",");
    const refCond = (typeCol, idCol) => Object.values(refMap).filter((v, i, a) => a.indexOf(v) === i && tracked.has(v))
      .map((target) => `(${typeCol} in (${typeList(target)}) and ${idCol} in (select id from ${w(target)}))`).join(" or ") || "false";

    await seed("notifications", `${refCond("reference_type", "reference_id")} or type like 'portal%'`);
    await seed("approval_requests", `${refCond("resource_type", "resource_id")}`);
    await seed("document_revisions", `${refCond("resource_type", "resource_id")}`);
    await seed("quality_inspections", `${refCond("reference_type", "reference_id")}`);
    await seed("production_traceability", `${refCond("reference_type", "reference_id")}`);
    await seed("data_audit_findings", `${refCond("entity_type", "nullif(entity_id,'')::int")}`).catch(() => 0);
    await seed("stock_movements", `${refCond("reference_type", "reference_id")}`);
    await seed("trash", `table_name in ('contacts','sales_orders','sales_order_items','portal_customers','portal_users','portal_applications')`);
    if (tracked.has("portal_members")) {
      await seed("portal_settings", `(scope = 'company' and scope_id in (select id from ${w("portal_customers")})) or (scope = 'member' and scope_id in (select id from ${w("portal_members")}))`);
      await seed("portal_settings_history", `(scope = 'company' and scope_id in (select id from ${w("portal_customers")})) or (scope = 'member' and scope_id in (select id from ${w("portal_members")}))`);
    }

    // سجل التدقيق: كل اللي يخص البوابة والعملاء والمبيعات + أي أثر لعمليات المسح نفسها
    const pathHead = `'^(post|put|patch|delete) (/api/v[0-9]+)?/`;
    await seed("audit_events", `
      action_key like 'portal%' or resource_type in ('portal_customer','portal_application')
      or action_key ~ ${pathHead}portal'
      or (action_key ~ '^sales\\.' and resource_id in (${inSet("sales_orders")}))
      or (action_key ~ '^contacts\\.' and resource_id in (${inSet("contacts")}))
      or (action_key ~ '^(production_workflow|production_request|productionWorkflow|production\\.)' and resource_id in (${inSet("production_workflow_orders")}))
      or (action_key ~ '^operations\\.case' and resource_id in (${inSet("operations_cases")}))
      or (action_key ~ '^chat\\.' and resource_id in (${inSet("chat_conversations")}))
      or (action_key ~ ${pathHead}sales' and resource_id in (${inSet("sales_orders")}))
      or (action_key ~ ${pathHead}contacts' and resource_id in (${inSet("contacts")}))
      or (action_key ~ ${pathHead}production-workflow' and resource_id in (${inSet("production_workflow_orders")}))
      or (action_key ~ ${pathHead}chat' and resource_id in (${inSet("chat_conversations")}))`);
    await expand();

    /* ---------- تقرير ---------- */
    const counts = [];
    for (const t of [...tracked].sort()) {
      const { rows } = await client.query(`select count(*)::int n from ${w(t)}`);
      if (rows[0].n > 0) counts.push([t, rows[0].n]);
    }
    for (const d of directDeletes) {
      const { rows } = await client.query(`select count(*)::int n from ${q(d.child)} where ${q(d.col)} in (select id from ${w(d.parent)})`);
      if (rows[0].n > 0) counts.push([`${d.child} (مباشر)`, rows[0].n]);
    }
    log("\nاللي هيتمسح:");
    for (const [t, n] of counts) log(`  ${t.padEnd(42)} ${n}`);
    log(`  الإجمالي: ${counts.reduce((s, [, n]) => s + n, 0)} صف في ${counts.length} جدول`);

    // المخزون: عكس أثر الحركات
    const stockSql = tracked.has("stock_movements")
      ? await client.query(`select inventory_item_id, sum(case movement_type when 'out' then qty else -qty end) as delta
                            from stock_movements where id in (select id from ${w("stock_movements")}) group by 1 having sum(case movement_type when 'out' then qty else -qty end) <> 0`)
      : { rows: [] };
    if (stockSql.rows.length) log(`\nالمخزون: هيتعدّل ${stockSql.rows.length} صنف (الحركات المرتبطة بالطلبات بتتعكس).`);

    if (dryRun) {
      await client.query("ROLLBACK");
      log("\n(تجربة فقط: ماتمسحش أي حاجة)");
      return;
    }

    log("\n⚠️ ده مسح نهائي ومالوش رجوع، ومش هيتسجّل في أي سجل.");
    const answer = await ask(`اكتب «${CONFIRM_PHRASE}» للتأكيد: `);
    if (answer !== CONFIRM_PHRASE) {
      await client.query("ROLLBACK");
      log("اتلغت العملية. ماتمسحش أي حاجة.");
      return;
    }

    /* ---------- التنفيذ ---------- */
    for (const row of stockSql.rows) {
      await client.query(`update inventory_items set qty = qty + $1::numeric, updated_at = now() where id = $2`, [row.delta, row.inventory_item_id]);
    }
    for (const e of nullOuts.values()) {
      await client.query(`update ${q(e.child)} set ${q(e.col)} = null where ${q(e.col)} in (select id from ${w(e.parent)})`);
    }
    for (const d of directDeletes) {
      await client.query(`delete from ${q(d.child)} where ${q(d.col)} in (select id from ${w(d.parent)})`);
    }
    let pending = [...tracked].filter((t) => hasId.get(t));
    for (let pass = 0; pending.length && pass < 40; pass++) {
      const still = [];
      for (const t of pending) {
        await client.query("SAVEPOINT s");
        try {
          await client.query(`delete from ${q(t)} where id in (select id from ${w(t)})`);
          await client.query("RELEASE SAVEPOINT s");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT s");
          if (err.code !== "23503") throw err;
          still.push(t);
        }
      }
      if (still.length === pending.length) throw new Error(`ماقدرتش أمسح بسبب روابط: ${still.join(", ")}`);
      pending = still;
    }

    /* ---------- سلسلة التدقيق ---------- */
    if (exists("audit_events")) {
      const { rows } = await client.query(`select id, actor_user_id, action_key, resource_id, created_at from audit_events order by id`);
      let prev = null;
      for (const r of rows) {
        const hash = crypto.createHash("sha256").update([prev ?? "", r.actor_user_id ?? "", r.action_key, r.resource_id ?? "", new Date(r.created_at).toISOString()].join("")).digest("hex");
        await client.query(`update audit_events set prev_hash = $1, record_hash = $2 where id = $3`, [prev, hash, r.id]);
        prev = hash;
      }
    }

    /* ---------- تصفير العدّادات ---------- */
    const touched = new Set([...tracked, ...directDeletes.map((d) => d.child)]);
    for (const t of touched) {
      if (!hasId.get(t)) continue;
      const { rows } = await client.query(`select pg_get_serial_sequence($1, 'id') as seq`, [q(t)]);
      if (!rows[0]?.seq) continue;
      await client.query(`select setval($1, coalesce((select max(id) from ${q(t)}), 0) + 1, false)`, [rows[0].seq]);
    }

    await client.query("COMMIT");
    log("\n✅ اتمسح كل العملاء وبياناتهم نهائيًا. السيستم رجع زي الجديد من ناحية العملاء.");

    const { rows: reserved } = await pool.query(`select name, reserved_qty from inventory_items where reserved_qty::numeric > 0 order by name limit 20`);
    if (reserved.length) {
      log("\nتنبيه: الأصناف دي لسه فيها كمية محجوزة (راجعها لو الحجز كان لطلبات اتمسحت):");
      for (const r of reserved) log(`  ${r.name}: ${r.reserved_qty}`);
    }
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    console.error("\n❌ حصل خطأ، واترجّع كل حاجة زي ما كانت (ماتمسحش أي حاجة):\n", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
