#!/usr/bin/env node
/**
 * فحص حي لتريجرات المخازن (هجرة 0110) على القاعدة الحقيقية، من غير ما يسيب أثر:
 * كل حاجة بتحصل جوه معاملة واحدة وبتتلغي (ROLLBACK) في الآخر، حتى لو كله نجح.
 * التشغيل: node scripts/check-warehouses.mjs   (محتاج DATABASE_URL، ومحتاج الهجرة 0110 تكون اتطبّقت)
 */
import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL مطلوب.");
  process.exit(2);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : process.env.PGSSL_STRICT === "true" ? true : { rejectUnauthorized: false },
});

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "✔" : "✘"} ${name}${ok ? "" : extra ? " — " + extra : ""}`);
};

/** يجرّب جملة المفروض تفشل برسالة فيها الكلمة دي، من غير ما يبوّظ المعاملة (savepoint). */
async function expectFail(c, label, sql, params, needle) {
  await c.query("SAVEPOINT sp");
  try {
    await c.query(sql, params);
    check(label, false, "المفروض كانت تفشل");
  } catch (e) {
    check(label, String(e.message).includes(needle), `الرسالة: ${e.message}`);
  }
  await c.query("ROLLBACK TO SAVEPOINT sp");
}

const totals = async (c, id) => {
  const { rows } = await c.query(
    `SELECT i.qty::numeric AS iq, i.reserved_qty::numeric AS ir, i.quarantine_qty::numeric AS ik,
            COALESCE(sum(b.qty),0)::numeric AS bq, COALESCE(sum(b.reserved_qty),0)::numeric AS br, COALESCE(sum(b.quarantine_qty),0)::numeric AS bk
     FROM inventory_items i LEFT JOIN stock_balances b ON b.item_id = i.id WHERE i.id = $1 GROUP BY i.id`,
    [id],
  );
  return rows[0];
};
const same = (t) => Number(t.iq) === Number(t.bq) && Number(t.ir) === Number(t.br) && Number(t.ik) === Number(t.bk);

const c = await pool.connect();
try {
  await c.query("BEGIN");

  const { rows: defs } = await c.query(`SELECT id, kind FROM warehouses WHERE is_default ORDER BY kind`);
  check("التلات مخازن الافتراضية موجودة (خام/تحت تشغيل/تام)", defs.map((d) => d.kind).join() === "finished,raw,wip", JSON.stringify(defs));
  const wh = Object.fromEntries(defs.map((d) => [d.kind, d.id]));

  // صنف خام برصيد: الرصيد لازم يتحط في المخزن الافتراضي للخام
  const raw = (await c.query(`INSERT INTO inventory_items (name, category, qty, reserved_qty) VALUES ('__chk_raw__', 'raw_material', 100, 10) RETURNING id`)).rows[0].id;
  let r = (await c.query(`SELECT warehouse_id, qty, reserved_qty FROM stock_balances WHERE item_id = $1`, [raw])).rows;
  check("صنف جديد برصيد: بيتسجّل في المخزن الافتراضي للخام", r.length === 1 && r[0].warehouse_id === wh.raw && Number(r[0].qty) === 100 && Number(r[0].reserved_qty) === 10, JSON.stringify(r));
  check("إجمالي الصنف = مجموع الأرصدة بعد الإضافة", same(await totals(c, raw)));

  // تعديل مباشر قديم على الإجمالي بيتحوّل لفرق على الافتراضي
  await c.query(`UPDATE inventory_items SET qty = 80 WHERE id = $1`, [raw]);
  let t = await totals(c, raw);
  check("تعديل الإجمالي مباشرة = فرق على الافتراضي، والإجمالي ثابت 80", Number(t.iq) === 80 && same(t), JSON.stringify(t));

  // تحرك رصيد على مخزن تحت التشغيل (مسموح للخام) والإجمالي يتجمع
  await c.query(`INSERT INTO stock_balances (item_id, warehouse_id, qty) VALUES ($1, $2, 20)`, [raw, wh.wip]);
  t = await totals(c, raw);
  check("رصيد في مخزنين: الإجمالي 100 = المجموع", Number(t.iq) === 100 && same(t), JSON.stringify(t));
  await c.query(`UPDATE stock_balances SET qty = qty - 5 WHERE item_id = $1 AND warehouse_id = $2`, [raw, wh.wip]);
  t = await totals(c, raw);
  check("تنقيص رصيد مخزن: الإجمالي بيتبعه (95)", Number(t.iq) === 95 && same(t), JSON.stringify(t));

  // قاعدة النوع: الخام مايتخزنش في مخزن التام
  await expectFail(c, "الخام في مخزن التام مرفوض", `INSERT INTO stock_balances (item_id, warehouse_id, qty) VALUES ($1, $2, 1)`, [raw, wh.finished], "WH_KIND_MISMATCH");
  // رصيد سالب
  await expectFail(c, "رصيد سالب مرفوض", `UPDATE stock_balances SET qty = qty - 1000 WHERE item_id = $1 AND warehouse_id = $2`, [raw, wh.raw], "stock_balances_qty_nonneg");
  await expectFail(c, "تعديل مباشر ينزّل الإجمالي تحت الصفر مرفوض", `UPDATE inventory_items SET qty = -50 WHERE id = $1`, [raw], "stock_balances_qty_nonneg");
  // تغيير الفئة وعليه رصيد في مخزن مايناسبها
  await expectFail(c, "تغيير فئة صنف عليه رصيد خام لتام مرفوض", `UPDATE inventory_items SET category = 'finished_good' WHERE id = $1`, [raw], "WH_KIND_MISMATCH");

  // التام: مخزن التام وتحت التشغيل مسموحين، والخام لأ
  const fg = (await c.query(`INSERT INTO inventory_items (name, category, qty) VALUES ('__chk_fg__', 'finished_good', 7) RETURNING id`)).rows[0].id;
  r = (await c.query(`SELECT warehouse_id FROM stock_balances WHERE item_id = $1`, [fg])).rows;
  check("منتج تام جديد برصيد: في مخزن التام الافتراضي", r.length === 1 && r[0].warehouse_id === wh.finished, JSON.stringify(r));
  await expectFail(c, "التام في مخزن الخام مرفوض", `INSERT INTO stock_balances (item_id, warehouse_id, qty) VALUES ($1, $2, 1)`, [fg, wh.raw], "WH_KIND_MISMATCH");

  // حركة من غير مخزن بتاخد الافتراضي
  const mv = (await c.query(`INSERT INTO stock_movements (inventory_item_id, movement_type, qty, reference_type, reference_id) VALUES ($1, 'in', 1, 'adjustment', 1) RETURNING warehouse_id`, [fg])).rows[0];
  check("حركة من غير مخزن بتاخد مخزن التام الافتراضي", mv.warehouse_id === wh.finished, JSON.stringify(mv));

  // المخازن: افتراضي مايتمسحش ولا يتوقف، النوع ثابت، مخزن عليه رصيد مايتوقفش
  await expectFail(c, "مسح المخزن الافتراضي مرفوض", `DELETE FROM warehouses WHERE id = $1`, [wh.raw], "WH_DEFAULT_LOCKED");
  await expectFail(c, "إيقاف المخزن الافتراضي مرفوض", `UPDATE warehouses SET active = false WHERE id = $1`, [wh.raw], "WH_DEFAULT_LOCKED");
  const b1 = (await c.query(`INSERT INTO warehouses (code, name, kind) VALUES ('__CHK_B1__', '__chk_b1__', 'raw') RETURNING id`)).rows[0].id;
  await expectFail(c, "تغيير نوع مخزن مرفوض", `UPDATE warehouses SET kind = 'wip' WHERE id = $1`, [b1], "WH_KIND_LOCKED");
  await expectFail(c, "مخزن افتراضي تاني لنفس النوع مرفوض", `INSERT INTO warehouses (code, name, kind, is_default) VALUES ('__CHK_B2__', '__chk_b2__', 'raw', true)`, [], "warehouses_one_default_per_kind");
  await c.query(`INSERT INTO stock_balances (item_id, warehouse_id, qty) VALUES ($1, $2, 3)`, [raw, b1]);
  await expectFail(c, "إيقاف مخزن عليه رصيد مرفوض", `UPDATE warehouses SET active = false WHERE id = $1`, [b1], "WH_HAS_STOCK");
  await expectFail(c, "مسح مخزن استُخدم مرفوض", `DELETE FROM warehouses WHERE id = $1`, [b1], "WH_IN_USE");
  await c.query(`UPDATE stock_balances SET qty = 0 WHERE item_id = $1 AND warehouse_id = $2`, [raw, b1]);
  await c.query(`UPDATE warehouses SET active = false WHERE id = $1`, [b1]);
  await expectFail(c, "إدخال رصيد في مخزن موقوف مرفوض", `UPDATE stock_balances SET qty = 5 WHERE item_id = $1 AND warehouse_id = $2`, [raw, b1], "WH_INACTIVE");

  // مسح الصنف بيمسح أرصدته ومايسيبش يتيم
  await c.query(`DELETE FROM stock_movements WHERE inventory_item_id = $1`, [fg]);
  await c.query(`DELETE FROM inventory_items WHERE id = $1`, [fg]);
  r = (await c.query(`SELECT 1 FROM stock_balances WHERE item_id = $1`, [fg])).rows;
  check("مسح الصنف بيمسح أرصدته", r.length === 0);

  // السلامة الشاملة على بيانات الإنتاج الحقيقية (قراءة بس)
  const { rows: bad } = await c.query(`
    SELECT i.id FROM inventory_items i
    LEFT JOIN (SELECT item_id, sum(qty) q, sum(reserved_qty) r, sum(quarantine_qty) k FROM stock_balances GROUP BY item_id) b ON b.item_id = i.id
    WHERE i.qty <> COALESCE(b.q,0) OR i.reserved_qty <> COALESCE(b.r,0) OR i.quarantine_qty <> COALESCE(b.k,0)`);
  check("كل أصناف النظام: الإجمالي = مجموع الأرصدة", bad.length === 0, `أصناف مختلفة: ${bad.map((x) => x.id).join(",")}`);
  const { rows: nowh } = await c.query(`SELECT count(*)::int AS n FROM stock_movements WHERE warehouse_id IS NULL`);
  check("كل الحركات مربوطة بمخزن", nowh[0].n === 0);
} catch (e) {
  results.push(false);
  console.log(`✘ خطأ غير متوقع: ${e.message}`);
} finally {
  await c.query("ROLLBACK").catch(() => undefined);
  c.release();
  await pool.end();
}

const failed = results.filter((x) => !x).length;
console.log(failed ? `\n❌ ${failed} فحص فشل من ${results.length} (ومفيش أي أثر على القاعدة، اتعمل ROLLBACK).` : `\n✅ ${results.length} فحص سليم (ومفيش أي أثر على القاعدة، اتعمل ROLLBACK).`);
process.exit(failed ? 1 : 0);
