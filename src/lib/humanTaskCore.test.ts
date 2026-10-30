/** @format */
import { describe, expect, it } from "vitest";
import {
  canActOnTask,
  canTransition,
  createTaskSchema,
  dueState,
  nextEscalationAt,
  nextEscalationStep,
  raisePriority,
  taskHealth,
  type EscalationTask,
} from "./humanTaskCore";

const T0 = new Date("2026-11-01T10:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const base = (over: Partial<EscalationTask> = {}): EscalationTask => ({ status: "open", priority: "normal", dueAt: T0, escalationLevel: 0, nextEscalationAt: T0, escalateToRole: "sales_manager", ...over });

describe("التحقق من بيانات المهمة", () => {
  it("لازم مسؤول (موظف أو دور)", () => {
    expect(createTaskSchema.safeParse({ title: "اتصل بالعميل" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "اتصل بالعميل", assigneeRole: "sales_manager" }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: "اتصل بالعميل", assigneeUserId: 4 }).success).toBe(true);
  });
  it("العنوان قصير جدًا مرفوض والقيم الافتراضية سليمة", () => {
    expect(createTaskSchema.safeParse({ title: "ا", assigneeUserId: 1 }).success).toBe(false);
    const ok = createTaskSchema.parse({ title: "راجع الطلب", assigneeUserId: 1 });
    expect(ok.priority).toBe("normal");
    expect(ok.escalateToRole).toBe("executive_manager");
  });
});

describe("حالة الموعد", () => {
  it("بدون موعد أو منتهية = none", () => {
    expect(dueState(null, T0, "open")).toBe("none");
    expect(dueState(T0, T0, "done")).toBe("none");
  });
  it("متأخرة، قربت، عادية", () => {
    expect(dueState(hours(-1), T0, "open")).toBe("overdue");
    expect(dueState(T0, T0, "open")).toBe("overdue");
    expect(dueState(hours(2), T0, "in_progress")).toBe("due_soon");
    expect(dueState(hours(30), T0, "open")).toBe("ok");
  });
});

describe("سياسة التصعيد", () => {
  it("قبل الموعد: مفيش تصعيد", () => {
    expect(nextEscalationStep(base({ nextEscalationAt: hours(1) }), T0)).toBeNull();
  });
  it("عند الموعد: مستوى 1 ينبه المسؤول والمدير ويرفع الأولوية ويحدد مستوى 2 بعد 24 ساعة", () => {
    const s = nextEscalationStep(base(), T0)!;
    expect(s.level).toBe(1);
    expect(s.notifyAssignee).toBe(true);
    expect(s.notifyRoles).toEqual(["sales_manager"]);
    expect(s.priority).toBe("high");
    expect(s.nextEscalationAt).toEqual(hours(24));
  });
  it("مستوى 2: الإدارة العليا وأولوية عاجلة وبعدها مفيش تصعيد", () => {
    const s = nextEscalationStep(base({ escalationLevel: 1, nextEscalationAt: hours(24) }), hours(25))!;
    expect(s.level).toBe(2);
    expect(s.notifyRoles).toEqual(["sales_manager", "chairman"]);
    expect(s.priority).toBe("urgent");
    expect(s.nextEscalationAt).toBeNull();
    expect(nextEscalationStep(base({ escalationLevel: 2, nextEscalationAt: null }), hours(100))).toBeNull();
  });
  it("لو المدير هو الرئيس ما يتنبهش مرتين", () => {
    expect(nextEscalationStep(base({ escalationLevel: 1, nextEscalationAt: hours(24), escalateToRole: "chairman" }), hours(25))!.notifyRoles).toEqual(["chairman"]);
  });
  it("غياب العامل يوم كامل: مستوى واحد في كل تشغيلة (مفيش قفز)", () => {
    expect(nextEscalationStep(base(), hours(48))!.level).toBe(1);
  });
  it("المهمة المنتهية أو الملغية ما بتتصعّدش", () => {
    expect(nextEscalationStep(base({ status: "done" }), hours(5))).toBeNull();
    expect(nextEscalationStep(base({ status: "cancelled" }), hours(5))).toBeNull();
  });
  it("الأولوية بتترفع ولا بتنزل", () => {
    expect(raisePriority("urgent", "high")).toBe("urgent");
    expect(raisePriority("low", "high")).toBe("high");
  });
  it("موعد التصعيد الأول = الموعد النهائي، وبدون موعد مفيش تصعيد", () => {
    expect(nextEscalationAt(T0, 0)).toEqual(T0);
    expect(nextEscalationAt(null, 0)).toBeNull();
    expect(nextEscalationAt(T0, 2)).toBeNull();
  });
});

describe("من يقدر ينفّذ", () => {
  const actor = (userId: number, roles: string[], isManager = false) => ({ userId, roles, isManager });
  it("صاحب المهمة والمدير فقط لو المهمة لشخص", () => {
    const t = { assigneeUserId: 5, assigneeRole: null };
    expect(canActOnTask(t, actor(5, []))).toBe(true);
    expect(canActOnTask(t, actor(6, ["sales_manager"]))).toBe(false);
    expect(canActOnTask(t, actor(6, [], true))).toBe(true);
  });
  it("مهمة الدور: أي حد في الدور", () => {
    const t = { assigneeUserId: null, assigneeRole: "buyer" };
    expect(canActOnTask(t, actor(9, ["buyer"]))).toBe(true);
    expect(canActOnTask(t, actor(9, ["storekeeper"]))).toBe(false);
  });
  it("الانتقالات: المنتهية والملغية ما بترجعش", () => {
    expect(canTransition("open", "done")).toBe(true);
    expect(canTransition("done", "open")).toBe(false);
    expect(canTransition("cancelled", "in_progress")).toBe(false);
  });
});

describe("فحص الصحة", () => {
  it("سليم، متأخرة ومتصعّدة سليم، واقفة = تنبيه ثم خطر", () => {
    expect(taskHealth({ overdue: 0, stuckUnescalated: 0, oldestOverdueHours: 0 }).status).toBe("ok");
    expect(taskHealth({ overdue: 3, stuckUnescalated: 0, oldestOverdueHours: 9 }).status).toBe("ok");
    expect(taskHealth({ overdue: 3, stuckUnescalated: 1, oldestOverdueHours: 9 }).status).toBe("warn");
    expect(taskHealth({ overdue: 9, stuckUnescalated: 5, oldestOverdueHours: 9 }).status).toBe("bad");
  });
});
