/** @format */
// صندوق الاعتمادات (الخطوة 39أ): قراءة فقط. القرار نفسه PATCH /governance/approval-requests/:id/decide.
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { APPROVER_ROLES, loadInbox } from "../lib/approvalsInbox";

const router = Router();

// GET /api/v1/approvals/inbox?mode=pending|history — الطلبات اللي دوري (أو تفويضي) يعتمدها، الأقدم أولاً، ومحاكي الأثر لكل طلب
router.get("/approvals/inbox", requireAuth, requireRole(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const mode = req.query.mode === "history" ? "history" : "pending";
    res.json({ data: await loadInbox({ userId: req.user!.userId, role: req.user!.role }, mode) });
  } catch (err) {
    next(err);
  }
});

export default router;
