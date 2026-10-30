import { describe, expect, it } from "vitest";
import { canAct, dueState, emptyDraft, isTaskManager, sortTasks, taskCounts, toPayload, validateDraft, type TaskRow } from "./tasksCore";

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const hrs = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const task = (o: Partial<TaskRow> = {}): TaskRow => ({
  id: 1, kind: "general", title: "اتصل بالعميل", description: "", status: "open", priority: "normal", assigneeUserId: 5, assigneeRole: null, escalateToRole: "executive_manager",
  dueAt: hrs(30), escalationLevel: 0, createdBy: 1, completedAt: null, resultNote: null, createdAt: hrs(-1), ...o,
});

describe("حالة الموعد", () => {
  it("متأخرة وقربت وعادية وبدون موعد والمنتهية", () => {
    expect(dueState(task({ dueAt: hrs(-1) }), NOW)).toBe("overdue");
    expect(dueState(task({ dueAt: hrs(2) }), NOW)).toBe("due_soon");
    expect(dueState(task({ dueAt: hrs(30) }), NOW)).toBe("ok");
    expect(dueState(task({ dueAt: null }), NOW)).toBe("none");
    expect(dueState(task({ dueAt: hrs(-5), status: "done" }), NOW)).toBe("none");
    expect(dueState(task({ dueAt: "garbage" }), NOW)).toBe("none");
  });
});

describe("الترتيب والعدّادات", () => {
  const rows = [task({ id: 1, dueAt: hrs(30) }), task({ id: 2, dueAt: hrs(-3) }), task({ id: 3, status: "done", dueAt: hrs(-9) }), task({ id: 4, dueAt: hrs(2) })];
  it("المتأخر أولًا ثم الأقرب موعدًا والمنتهي في الآخر", () => {
    expect(sortTasks(rows, NOW).map((r) => r.id)).toEqual([2, 4, 1, 3]);
  });
  it("العدّادات بتتجاهل المنتهي", () => {
    expect(taskCounts(rows, NOW)).toEqual({ active: 3, overdue: 1, dueSoon: 1 });
  });
});

describe("من يقدر ينفّذ", () => {
  it("صاحب المهمة أو المدير فقط لو المهمة لشخص", () => {
    expect(canAct(task({ assigneeUserId: 5 }), { id: 5, role: "buyer" })).toBe(true);
    expect(canAct(task({ assigneeUserId: 5 }), { id: 6, role: "buyer" })).toBe(false);
    expect(canAct(task({ assigneeUserId: 5 }), { id: 6, role: "sales_manager" })).toBe(true);
  });
  it("مهمة الدور: أي حد في الدور", () => {
    const t = task({ assigneeUserId: null, assigneeRole: "buyer" });
    expect(canAct(t, { id: 9, role: "buyer" })).toBe(true);
    expect(canAct(t, { id: 9, role: "storekeeper" })).toBe(false);
  });
  it("المديرين", () => {
    expect(isTaskManager("chairman")).toBe(true);
    expect(isTaskManager("buyer")).toBe(false);
    expect(isTaskManager(undefined)).toBe(false);
  });
});

describe("نموذج المهمة", () => {
  it("العنوان مطلوب، والدور مطلوب لو الهدف دور", () => {
    expect(validateDraft(emptyDraft()).ok).toBe(false);
    const d = { ...emptyDraft(), title: "راجع الطلب" };
    expect(validateDraft(d).ok).toBe(true);
    expect(validateDraft({ ...d, target: "role" }).errors.role).toBe(true);
    expect(validateDraft({ ...d, target: "role", role: "buyer" }).ok).toBe(true);
  });
  it("الحمولة: لنفسي = assigneeUserId، لدور = assigneeRole، والموعد ISO", () => {
    const base = { ...emptyDraft(), title: " مهمة " };
    expect(toPayload(base, 7)).toMatchObject({ title: "مهمة", assigneeUserId: 7 });
    const p = toPayload({ ...base, target: "role", role: "buyer", due: "2026-11-01T10:00" }, 7) as Record<string, unknown>;
    expect(p.assigneeRole).toBe("buyer");
    expect(p.assigneeUserId).toBeUndefined();
    expect(typeof p.dueAt).toBe("string");
  });
});
