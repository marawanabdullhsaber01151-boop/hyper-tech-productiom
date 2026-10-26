import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  caseRisk,
  classifySla,
  matchRecipe,
  nextActionFor,
  normalizeProductName,
  planConversion,
  workingHoursBetween,
  cairoDateString,
  OPS_CONVERT_ROLES, TRANSFER_CREATORS, TRANSFER_DIRECTIONS, TRANSFER_RECEIVERS, stockEffectOf, approvalLevelFor, checkPlanDecision, planShortageValue, planReservationWants, allocateConsumption, transferCostAmount } from "./operationsCenterCore";

const d = (s: string) => new Date(s);

describe("ساعات العمل (القاهرة، السبت–الخميس، 9–5)", () => {
  it("بيعدّ ساعات اليوم الواحد", () => {
    expect(workingHoursBetween(d("2026-10-25T06:00:00Z"), d("2026-10-25T10:00:00Z"))).toBe(4);
  });
  it("بيتخطى الجمعة وبيحسب من بداية السبت", () => {
    expect(workingHoursBetween(d("2026-10-22T13:00:00Z"), d("2026-10-24T06:30:00Z"))).toBe(1.5);
  });
  it("الليل ما بيتحسبش", () => {
    expect(workingHoursBetween(d("2026-10-25T16:00:00Z"), d("2026-10-26T06:00:00Z"))).toBe(0);
  });
  it("الفترة المعكوسة = صفر", () => {
    expect(workingHoursBetween(d("2026-10-26T06:00:00Z"), d("2026-10-25T06:00:00Z"))).toBe(0);
  });
  it("تاريخ القاهرة بيعدّي منتصف الليل قبل UTC", () => {
    expect(cairoDateString(d("2026-10-25T22:30:00Z"))).toBe("2026-10-26");
  });
});

describe("الـSLA والمخاطر", () => {
  it("حالات المهلة", () => {
    expect(classifySla(1, 4)).toBe("ok");
    expect(classifySla(3, 4)).toBe("due");
    expect(classifySla(4, 4)).toBe("breached");
  });
  it("متأخرة + عدّت المهلة + عاجلة بلا مسؤول = خطر عالي بكل الأسباب", () => {
    const r = caseRisk(
      { status: "received", priority: "urgent", dueDate: "2026-10-20", assignedTo: null, createdAt: d("2026-10-25T06:00:00Z"), updatedAt: d("2026-10-25T06:00:00Z") },
      d("2026-10-25T12:00:00Z"),
    );
    expect(r.level).toBe("high");
    expect(r.reasons).toEqual(["overdue", "sla_breached", "urgent_unassigned"]);
  });
  it("انتظار المبيعات بيتعدّ من وقت الطلب وبمهلة يوم عمل", () => {
    const r = caseRisk(
      { status: "needs_sales_clarification", priority: "normal", dueDate: null, assignedTo: 1, createdAt: d("2026-10-20T06:00:00Z"), updatedAt: d("2026-10-25T06:00:00Z") },
      d("2026-10-26T12:00:00Z"),
    );
    expect(r.reasons).toContain("waiting_sales");
  });
  it("الحالات المقفولة ملهاش مخاطر", () => {
    const r = caseRisk(
      { status: "converted", priority: "urgent", dueDate: "2020-01-01", assignedTo: null, createdAt: d("2020-01-01T00:00:00Z"), updatedAt: d("2020-01-01T00:00:00Z") },
      d("2026-10-25T12:00:00Z"),
    );
    expect(r).toMatchObject({ level: "low", reasons: [], sla: null });
  });
});

describe("الخطوة التالية", () => {
  it("بتتبع الحالة", () => {
    expect(nextActionFor("received", false)).toBe("start_validation");
    expect(nextActionFor("under_validation", false)).toBe("complete_validation");
    expect(nextActionFor("needs_sales_clarification", false)).toBe("resume_validation");
    expect(nextActionFor("analysis_ready", false)).toBe("convert");
    expect(nextActionFor("analysis_ready", true)).toBe("track_orders");
    expect(nextActionFor("converted", true)).toBe("track_orders");
    expect(nextActionFor("cancelled", false)).toBe("none");
  });
});

describe("مطابقة الوصفة", () => {
  it("بتتجاهل التشكيل والهمزات والتاء المربوطة", () => {
    expect(normalizeProductName("  بُطاريّة  ")).toBe(normalizeProductName("بطاريه"));
    expect(normalizeProductName("أحمر")).toBe(normalizeProductName("احمر"));
  });
  it("وصفة واحدة = مطابقة، صفر = none، اتنين = ambiguous", () => {
    expect(matchRecipe("بطارية", [{ id: 5, productName: "بطاريه" }])).toEqual({ recipeId: 5, reason: "matched" });
    expect(matchRecipe("x", [])).toEqual({ recipeId: null, reason: "none" });
    expect(matchRecipe("ا", [{ id: 1, productName: "أ" }, { id: 2, productName: "ا" }])).toEqual({ recipeId: null, reason: "ambiguous" });
    expect(matchRecipe("   ", [{ id: 1, productName: "" }])).toEqual({ recipeId: null, reason: "none" });
  });
  it("خطة التحويل بتفصل المحلول من غير المحلول", () => {
    const plan = planConversion(
      [{ id: 1, productNameSnapshot: "بطارية" }, { id: 2, productNameSnapshot: "مجهول" }],
      [{ id: 9, productName: "بطارية" }],
    );
    expect(plan.resolved).toEqual([{ lineId: 1, recipeId: 9 }]);
    expect(plan.unresolved).toEqual([{ lineId: 2, productName: "مجهول", reason: "none" }]);
  });
});

describe("حراسة المسارات (ثغرات اتقفلت)", () => {
  const lifecycle = readFileSync("src/routes/production-lifecycle.ts", "utf8");
  it("التحويل للتشغيل بس ويشترط analysis_ready ويربط الوصفة ويعلّم الحالة converted", () => {
    expect([...OPS_CONVERT_ROLES]).toEqual(["operations_manager", "executive_manager", "chairman"]);
    expect(lifecycle).toContain("OPS_CONVERT_ROLES");
    expect(lifecycle).toContain('source.status !== "analysis_ready"');
    expect(lifecycle).toContain("planConversion(");
    expect(lifecycle).toContain('status: "converted"');
  });
  it("طلب التوضيح بيسجّل السبب في النسخة وبيبلّغ المبيعات، وفيه مسار استئناف", () => {
    const mgr = readFileSync("src/routes/operations-manager.ts", "utf8");
    expect(mgr).toContain("sales_clarification_requested: ${reason}");
    expect(mgr).toContain('notifyRole("sales_manager"');
    expect(mgr).toContain("/operations-manager/cases/:id/resume-validation");
  });
  it("التصعيد التلقائي مربوط بالـcron الموجود (من غير cron جديد)", () => {
    expect(readFileSync("src/routes/health.ts", "utf8")).toContain("escalateOperationsSla");
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: unknown[] };
    expect(v.crons).toHaveLength(2);
  });
  it("أدوار صفحة الويب = أدوار السيرفر، والصفحة متسجّلة lazy بحارس الدور", () => {
    const roles = readFileSync("web/src/staff/staffRoles.ts", "utf8").match(/OPERATIONS_ROLES = \[([^\]]*)\]/)?.[1] ?? "";
    const policy = readFileSync("src/lib/operations-control-policy.ts", "utf8");
    for (const r of ["chairman", "executive_manager", "operations_manager"]) {
      expect(roles).toContain(`"${r}"`);
      expect(policy).toContain(`"${r}"`);
    }
    const app = readFileSync("web/src/app/App.tsx", "utf8");
    expect(app).toMatch(/\/staff\/operations[\s\S]{0,80}RoleGuard roles=\{OPERATIONS_ROLES\}/);
    expect(app).toContain('import("../staff/Operations")');
  });

  it("أثر المخزون: خصم مرة واحدة من المخزن للتشغيل، وإضافة عند الرجوع، والباقي عهدة بس", () => {
    expect(stockEffectOf("warehouse_to_operations")).toBe("out");
    expect(stockEffectOf("operations_to_warehouse")).toBe("in");
    expect(stockEffectOf("operations_to_production")).toBeNull();
    expect(stockEffectOf("production_to_operations")).toBeNull();
    // رحلة كاملة مخزن → تشغيل → إنتاج: خصم واحد بس
    const trip = ["warehouse_to_operations", "operations_to_production"].map(stockEffectOf).filter((e) => e === "out");
    expect(trip).toHaveLength(1);
  });
  it("كل اتجاه له من يبدأه ومن يستلمه، والويب بيعكس نفس الاتجاهات", () => {
    for (const d of TRANSFER_DIRECTIONS) {
      expect(TRANSFER_CREATORS[d].length).toBeGreaterThan(0);
      expect(TRANSFER_RECEIVERS[d].length).toBeGreaterThan(0);
    }
    const web = readFileSync("web/src/staff/transferRules.ts", "utf8");
    for (const d of TRANSFER_DIRECTIONS) expect(web).toContain(`"${d}"`);
    expect(web).toContain('production_manager", "supervisor"');
    expect(web).toContain('operations_to_warehouse: ["warehouse_manager"]');
  });
  it("مسار الاستلام بيستخدم stockEffectOf، ومفيش خصم صريح لـoperations_to_production", () => {
    const route = readFileSync("src/routes/operations-control.ts", "utf8");
    expect(route).toContain("stockEffectOf(received.direction)");
    expect(route).not.toContain('"operations_to_production"]');
    expect(route).toContain("/operations-control/transfers\",");
    expect(route).toContain("purchase-requisitions/confirm-bulk");
    expect(route).toContain('notifyRoles(["purchasing_manager", "buyer"]');
  });

  it("مستوى الاعتماد حسب قيمة العجز: تلقائي/50 ألف/200 ألف/فوقها", () => {
    expect([0, 10_000, 10_000.01, 50_000, 50_001, 200_000, 200_001].map(approvalLevelFor)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });
  it("قيمة العجز بتتجاهل الأصناف من غير سعر أو من غير عجز", () => {
    expect(planShortageValue([{ shortageQty: "3.5", unitPrice: "10.00" }, { shortageQty: "0", unitPrice: "99" }, { shortageQty: "2", unitPrice: null }])).toBe(35);
  });
  it("قرار الاعتماد: الدور حسب المستوى، ومش صاحب الخطة، وسبب في المستوى 3", () => {
    const b = { role: "executive_manager", userId: 2, level: 1 as const, submittedBy: 1, note: "" };
    expect(checkPlanDecision(b)).toEqual({ ok: true });
    expect(checkPlanDecision({ ...b, role: "operations_manager" })).toEqual({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(checkPlanDecision({ ...b, userId: 1 })).toEqual({ ok: false, code: "SELF_APPROVAL" });
    expect(checkPlanDecision({ ...b, role: "executive_manager", level: 2 })).toEqual({ ok: false, code: "ROLE_NOT_ALLOWED" });
    expect(checkPlanDecision({ ...b, role: "chairman", level: 3 })).toEqual({ ok: false, code: "NOTE_REQUIRED" });
    expect(checkPlanDecision({ ...b, role: "chairman", level: 3, note: "سبب" })).toEqual({ ok: true });
  });
  it("الخطط: الراوتر متركّب، الهجرة بتعرّف الجدول والترقيم، والمسارات محروسة", () => {
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toContain('import operationsPlansRouter from "./routes/operations-plans"');
    expect(main).toContain("apiRouter.use(operationsPlansRouter)");
    const sql = readFileSync("migrations/0082_operations_plans.sql", "utf8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "operations_plans"');
    expect(sql).toContain("'operations_plan', 'PLN-'");
    const route = readFileSync("src/routes/operations-plans.ts", "utf8");
    expect(route).toContain("OPERATIONS_CONTROL_ACTIONS.planCreate");
    expect(route).toContain("OPERATIONS_CONTROL_ACTIONS.planSubmit");
    expect(route).toContain("checkPlanDecision(");
    expect(route).toContain('.for("update")');
    // لا حجز مخزون ولا إنشاء إنتاج من الخطة في الخطوة دي
    expect(route).not.toContain("applyStockMovement");
    expect(route).not.toContain("productionWorkflowOrdersTable");
  });

  it("الحجز: المتاح من كل خامة (المطلوب − العجز) متجمّع بالصنف، من غير أصناف مجهولة أو عجز كامل", () => {
    const plan = [
      { requirements: [{ inventoryItemId: 1, requiredQty: "10", shortageQty: "4" }, { inventoryItemId: null, requiredQty: "5", shortageQty: "0" }, { inventoryItemId: 2, requiredQty: "3", shortageQty: "3" }] },
      { requirements: [{ inventoryItemId: 1, requiredQty: "2", shortageQty: "0" }] },
    ];
    expect(planReservationWants(plan)).toEqual([{ inventoryItemId: 1, qty: 8 }]);
  });
  it("صرف الحجز بالأقدم أول ومن غير ما يتعدّى المتبقي", () => {
    expect(allocateConsumption([{ id: 1, remaining: 3 }, { id: 2, remaining: 5 }], 6)).toEqual([{ id: 1, take: 3 }, { id: 2, take: 3 }]);
    expect(allocateConsumption([{ id: 1, remaining: 3 }], 9)).toEqual([{ id: 1, take: 3 }]);
    expect(allocateConsumption([], 4)).toEqual([]);
  });
  it("تكلفة الخامة التلقائية: موجبة عند الصرف، سالبة عند الرجوع، ولا شيء للعهدة أو السعر صفر", () => {
    expect(transferCostAmount("warehouse_to_operations", "2.5", "10")).toBe(25);
    expect(transferCostAmount("operations_to_warehouse", "1", "10")).toBe(-10);
    expect(transferCostAmount("operations_to_production", "1", "10")).toBeNull();
    expect(transferCostAmount("warehouse_to_operations", "1", "0")).toBeNull();
  });
  it("م3ب: الحجز عند الاعتماد (يدوي وتلقائي)، الصرف عند الاستلام، التكلفة التلقائية، والهجرة", () => {
    const plans = readFileSync("src/routes/operations-plans.ts", "utf8");
    expect(plans.match(/reservePlanMaterials\(/g)).toHaveLength(2);
    expect(plans).toContain("/operations-center/plans/:id/release");
    const route = readFileSync("src/routes/operations-control.ts", "utf8");
    expect(route).toContain("consumePlanReservation(");
    expect(route).toContain("transferCostAmount(");
    expect(route).toContain("productionCostEntriesTable");
    const sql = readFileSync("migrations/0083_operations_plan_reservations.sql", "utf8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "operations_plan_reservations"');
    // الخطة نفسها لسه ما بتنشئش إنتاج
    expect(plans).not.toContain("productionWorkflowOrdersTable");
  });
});
