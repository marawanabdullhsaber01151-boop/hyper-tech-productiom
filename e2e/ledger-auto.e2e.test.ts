import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * الترحيل التلقائي للمبيعات على PostgreSQL حقيقي (49أ): قيد بالفرق بس، مفيش تكرار، والتزامن آمن.
 * الاختبار بيشغّل الإعداد مؤقتًا وبيرجّعه مقفول في الآخر.
 */
const enabled = Boolean(process.env.E2E_DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("الترحيل التلقائي للمبيعات (PostgreSQL حقيقي)", () => {
  let pool: Pool;
  let db: any;
  let auto: typeof import("../src/lib/ledgerAuto");
  let core: typeof import("../src/lib/ledgerAutoCore");
  const actor = { userId: null as number | null, username: "e2e-auto" };
  const stamp = String(Date.now()).slice(-8);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

  const sync = (id: number, opts: { forceStatus?: string } = {}) => db.transaction((tx: any) => auto.syncSalesOrderLedger(tx, id, actor, opts));
  const mkOrder = async (suffix: string, status: string, total: string, date = today): Promise<number> =>
    (await pool.query("insert into sales_orders(order_number,date,status,total) values ($1,$2,$3,$4) returning id", [`AUTO-${stamp}-${suffix}`, date, status, total])).rows[0].id;
  const setOrder = (id: number, status: string, total: string) => pool.query("update sales_orders set status=$2,total=$3 where id=$1", [id, status, total]);
  const net = async (id: number) =>
    Number((await pool.query("select coalesce(sum(l.credit-l.debit),0)::text as n from gl_journal_lines l join gl_journal_entries e on e.id=l.entry_id join gl_accounts a on a.id=l.account_id where a.code='4100' and e.source_type='sales_invoice' and e.source_id like $1", [`${id}:%`])).rows[0].n);
  const count = async (id: number) => Number((await pool.query("select count(*)::int as n from gl_journal_entries where source_type='sales_invoice' and source_id like $1", [`${id}:%`])).rows[0].n);
  const setting = (v: string) => pool.query("insert into system_settings(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value", [core.AUTO_SETTING_KEY, v]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    db = drizzle(pool);
    auto = await import("../src/lib/ledgerAuto");
    core = await import("../src/lib/ledgerAutoCore");
    await setting("");
  });
  afterAll(async () => {
    await setting("");
    await pool.end();
  });

  it("مقفول: مفيش أي قيد", async () => {
    const id = await mkOrder("OFF", "confirmed", "100.00");
    expect((await sync(id)).posted).toBe(false);
    expect(await count(id)).toBe(0);
  });

  it("شغّال: مسودة مفيهاش قيد، التأكيد بيسجّل، التكرار مبيعملش حاجة، والتعديل بالفرق", async () => {
    await setting(today);
    const id = await mkOrder("A", "draft", "100.00");
    expect((await sync(id)).posted).toBe(false);
    await setOrder(id, "confirmed", "100.00");
    expect((await sync(id)).posted).toBe(true);
    expect(await net(id)).toBe(100);
    expect((await sync(id)).posted).toBe(false);
    expect(await count(id)).toBe(1);
    await setOrder(id, "confirmed", "150.00");
    await sync(id);
    expect(await net(id)).toBe(150);
    await setOrder(id, "shipped", "120.00");
    await sync(id);
    expect(await net(id)).toBe(120);
  });

  it("الإلغاء بيعكس، وإعادة التأكيد بتسجّل تاني بمفتاح جديد بدون تعارض", async () => {
    const id = await mkOrder("B", "confirmed", "80.00");
    await sync(id);
    await setOrder(id, "cancelled", "80.00");
    await sync(id);
    expect(await net(id)).toBe(0);
    await setOrder(id, "confirmed", "80.00");
    await sync(id);
    expect(await net(id)).toBe(80);
    expect(await count(id)).toBe(3);
  });

  it("الحذف (forceStatus=cancelled) بيرجّع الصافي صفر", async () => {
    const id = await mkOrder("C", "paid", "55.50");
    await sync(id);
    expect(await net(id)).toBe(55.5);
    await sync(id, { forceStatus: "cancelled" });
    expect(await net(id)).toBe(0);
  });

  it("أمر قديم قبل تاريخ البداية مبيتسجّلش", async () => {
    const id = await mkOrder("OLD", "confirmed", "70.00", "2001-01-01");
    expect((await sync(id)).posted).toBe(false);
    expect(await count(id)).toBe(0);
  });

  it("تزامن: نداءين في نفس اللحظة مبيعملوش قيد مكرر", async () => {
    const id = await mkOrder("RACE", "confirmed", "100.00");
    await Promise.all([sync(id), sync(id), sync(id)]);
    expect(await net(id)).toBe(100);
    expect(await count(id)).toBe(1);
  });

  /* ---------------- 49ب: متوسط التكلفة وتكلفة البضاعة المباعة ---------------- */
  const mkItem = async (suffix: string, category: string, qty: string, avg: string): Promise<number> =>
    (await pool.query("insert into inventory_items(name,category,qty,avg_cost) values ($1,$2,$3,$4) returning id", [`AUTO-ITEM-${stamp}-${suffix}`, category, qty, avg])).rows[0].id;
  const addLine = (orderId: number, itemId: number, qty: string, price: string) =>
    pool.query("insert into sales_order_items(order_id,inventory_item_id,description,qty,unit_price,total) values ($1,$2,'بند',$3,$4,($3::numeric*$4::numeric)::numeric(12,2))", [orderId, itemId, qty, price]);
  const cogsNet = async (id: number, code: string) =>
    Number((await pool.query("select coalesce(sum(l.debit-l.credit),0)::text as n from gl_journal_lines l join gl_journal_entries e on e.id=l.entry_id join gl_accounts a on a.id=l.account_id where a.code=$2 and e.source_type='sales_cogs' and e.source_id like $1", [`${id}:%`, code])).rows[0].n);
  const cogsCount = async (id: number) => Number((await pool.query("select count(*)::int as n from gl_journal_entries where source_type='sales_cogs' and source_id like $1", [`${id}:%`])).rows[0].n);

  it("متوسط التكلفة: أول شراء بسعره، والتاني مرجّح، والمخزون القديم من غير تكلفة مبيتخلطش", async () => {
    const { updateAverageCost } = await import("../src/lib/inventoryCost");
    const id = await mkItem("AVG", "raw_material", "0", "0");
    await db.transaction((tx: any) => updateAverageCost(tx, id, "10", "5.00"));
    await pool.query("update inventory_items set qty='10' where id=$1", [id]);
    await db.transaction((tx: any) => updateAverageCost(tx, id, "10", "7.00"));
    expect((await pool.query("select avg_cost::text as a from inventory_items where id=$1", [id])).rows[0].a).toBe("6.0000");
    const legacy = await mkItem("LEG", "raw_material", "50", "0");
    await db.transaction((tx: any) => updateAverageCost(tx, legacy, "10", "8.00"));
    expect((await pool.query("select avg_cost::text as a from inventory_items where id=$1", [legacy])).rows[0].a).toBe("8.0000");
  });

  it("الشحن بيحمّل التكلفة مرة واحدة (تكرار = لا قيد)، والتكلفة متتغيّرش لو المتوسط اتغيّر بعد كده", async () => {
    const fg = await mkItem("FG", "finished_good", "100", "12.5000");
    const rm = await mkItem("RM", "raw_material", "100", "2.2500");
    const id = await mkOrder("COGS", "confirmed", "300.00");
    await addLine(id, fg, "10", "20.00");
    await addLine(id, rm, "4", "25.00");
    await sync(id);
    expect(await cogsCount(id)).toBe(0);
    await setOrder(id, "shipped", "300.00");
    await sync(id);
    expect(await cogsCount(id)).toBe(1);
    expect(await cogsNet(id, "5150")).toBe(134);
    expect(await cogsNet(id, "1170")).toBe(-125);
    expect(await cogsNet(id, "1150")).toBe(-9);
    await sync(id);
    await sync(id);
    expect(await cogsCount(id)).toBe(1);
    await pool.query("update inventory_items set avg_cost='99' where id=$1", [fg]);
    await setOrder(id, "paid", "300.00");
    await sync(id);
    expect(await cogsCount(id)).toBe(1);
    expect(await cogsNet(id, "5150")).toBe(134);
  });

  it("الإلغاء بعد الشحن بيعكس التكلفة بالظبط (كل الحسابات صفر)، وإعادة الشحن بتحمّلها تاني", async () => {
    const fg = await mkItem("FG2", "finished_good", "100", "10.0000");
    const id = await mkOrder("COGS2", "shipped", "100.00");
    await addLine(id, fg, "3", "30.00");
    await sync(id);
    expect(await cogsNet(id, "5150")).toBe(30);
    await setOrder(id, "cancelled", "100.00");
    await sync(id);
    for (const code of ["5150", "1170"]) expect(await cogsNet(id, code)).toBe(0);
    expect(await cogsCount(id)).toBe(2);
    await setOrder(id, "shipped", "100.00");
    await sync(id);
    expect(await cogsNet(id, "5150")).toBe(30);
    expect(await cogsCount(id)).toBe(3);
  });

  it("بند من غير تكلفة: مبيتقيّدش بصفر ولا بيوقّف الأمر", async () => {
    const fg = await mkItem("FG3", "finished_good", "100", "0");
    const id = await mkOrder("COGS3", "shipped", "50.00");
    await addLine(id, fg, "2", "25.00");
    await sync(id);
    expect(await cogsCount(id)).toBe(0);
    expect(await net(id)).toBe(50);
  });

  it("Q5: الدفتر كله متوازن، ومفيش مفتاح مصدر مكرر لقيود المبيعات والتكلفة", async () => {
    const bal = (await pool.query("select coalesce(sum(debit),0)::text as d, coalesce(sum(credit),0)::text as c from gl_journal_lines")).rows[0];
    expect(bal.d).toBe(bal.c);
    const dup = (await pool.query("select count(*)::int as n from (select source_type, source_id from gl_journal_entries where source_type in ('sales_invoice','sales_cogs') group by 1,2 having count(*)>1) x")).rows[0].n;
    expect(dup).toBe(0);
  });
});
