/** @format */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { capabilitiesFor } from "../lib/accessRegistry";

const router = Router();

/** صلاحيات القراءة للمستخدم الحالي (لأي دور مسجّل دخوله). */
router.get("/me/access", requireAuth, (req, res) => {
  const role = req.user!.role;
  res.json({ role, can: capabilitiesFor(role) });
});

export default router;
