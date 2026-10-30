/** @format */
// المهام البشرية بموعد وتصعيد (الخطوة 30).
// الصلاحيات: أي موظف يشوف وينفّذ مهامه، والمديرين (TASK_MANAGER_ROLES) بيشوفوا مهام الفريق وبيعيدوا التوزيع.
// إنشاء مهمة لغيرك محتاج صلاحية tasks.assign. كل التحقق من الصلاحية هنا في الخادم مش في الواجهة.

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth";
import { getEffectiveRoles } from "../lib/delegation";
import { cancelTaskSchema, completeTaskSchema, createTaskSchema, reassignTaskSchema, TASK_MANAGER_ROLES, type TaskActor } from "../lib/humanTaskCore";
import { cancelTask, claimTask, completeTask, createTask, getTaskDetail, listTasks, reassignTask, TaskError } from "../lib/humanTasks";
import { parseIdParam } from "../lib/validate";

const router = Router();

async function actorOf(req: Request): Promise<TaskActor> {
  const user = req.user!;
  let roles = [user.role];
  try {
    roles = await getEffectiveRoles(user.userId);
  } catch {
    // لو فحص التفويض وقع، بنكمّل بدور المستخدم الأصلي
  }
  return { userId: user.userId, roles, isManager: roles.some((r) => (TASK_MANAGER_ROLES as readonly string[]).includes(r)) };
}

function fail(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof TaskError) {
    const status = { NOT_FOUND: 404, FORBIDDEN: 403, BAD_STATE: 409, INVALID: 400 }[error.code];
    res.status(status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  next(error);
}

const assignGate = requirePermission("tasks.assign");
/** مهمة لنفسك مسموحة لأي موظف؛ مهمة لشخص أو دور تانيين محتاجة صلاحية الإسناد. */
function createGate(req: Request, res: Response, next: NextFunction) {
  const b = (req.body ?? {}) as { assigneeUserId?: unknown; assigneeRole?: unknown };
  if (b.assigneeUserId === req.user!.userId && !b.assigneeRole) return next();
  return assignGate(req, res, next);
}

function idOf(req: Request, res: Response): number | null {
  return parseIdParam(req.params.id, res);
}

const listQuery = z.object({ scope: z.enum(["mine", "team"]).default("mine"), status: z.enum(["active", "all"]).default("active") });

router.get("/tasks", requireAuth, async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const actor = await actorOf(req);
    res.json({ data: await listTasks({ scope: q.scope, status: q.status, actor }) });
  } catch (e) {
    fail(res, next, e);
  }
});

router.get("/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const id = idOf(req, res);
    if (id === null) return;
    res.json({ data: await getTaskDetail(id, await actorOf(req)) });
  } catch (e) {
    fail(res, next, e);
  }
});

router.post("/tasks", requireAuth, createGate, async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) throw new TaskError("INVALID", parsed.error.issues[0]?.message ?? "بيانات المهمة غير صحيحة");
    const { task, duplicate } = await createTask(parsed.data, actor.userId);
    res.status(duplicate ? 200 : 201).json({ data: task, duplicate });
  } catch (e) {
    fail(res, next, e);
  }
});

router.post("/tasks/:id/claim", requireAuth, async (req, res, next) => {
  try {
    const id = idOf(req, res);
    if (id === null) return;
    res.json({ data: await claimTask(id, await actorOf(req)) });
  } catch (e) {
    fail(res, next, e);
  }
});

router.post("/tasks/:id/complete", requireAuth, async (req, res, next) => {
  try {
    const id = idOf(req, res);
    if (id === null) return;
    const body = completeTaskSchema.safeParse(req.body);
    if (!body.success) throw new TaskError("INVALID", body.error.issues[0]?.message ?? "اكتب نتيجة المهمة");
    res.json({ data: await completeTask(id, body.data.note, await actorOf(req)) });
  } catch (e) {
    fail(res, next, e);
  }
});

router.post("/tasks/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const id = idOf(req, res);
    if (id === null) return;
    const body = cancelTaskSchema.safeParse(req.body);
    if (!body.success) throw new TaskError("INVALID", body.error.issues[0]?.message ?? "اكتب سبب الإلغاء");
    res.json({ data: await cancelTask(id, body.data.reason, await actorOf(req)) });
  } catch (e) {
    fail(res, next, e);
  }
});

router.post("/tasks/:id/reassign", requireAuth, assignGate, async (req, res, next) => {
  try {
    const id = idOf(req, res);
    if (id === null) return;
    const body = reassignTaskSchema.safeParse(req.body);
    if (!body.success) throw new TaskError("INVALID", body.error.issues[0]?.message ?? "بيانات غير صحيحة");
    const { reason, ...to } = body.data;
    res.json({ data: await reassignTask(id, to, reason, await actorOf(req)) });
  } catch (e) {
    fail(res, next, e);
  }
});

export default router;
