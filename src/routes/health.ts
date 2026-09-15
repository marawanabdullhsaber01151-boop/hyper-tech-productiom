import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, dataAuditFindingsTable, migrationLedgerTable, systemHealthChecksTable } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { API_CONTRACT_VERSION, failure } from "../contracts/api-response";

const router = Router();
const HEALTH_ROLES = ["executive_manager", "operations_manager", "production_manager"];

type CheckStatus = "ok" | "warning" | "blocked" | "unknown";

function statusRank(status: CheckStatus): number {
  return { ok: 0, unknown: 1, warning: 2, blocked: 3 }[status];
}

async function recordCheck(
  checkKey: string,
  status: CheckStatus,
  summary: string,
  details: unknown,
) {
  try {
    await db
      .insert(systemHealthChecksTable)
      .values({ checkKey, status, summary, details })
      .onConflictDoUpdate({
        target: systemHealthChecksTable.checkKey,
        set: { status, summary, details, checkedAt: new Date() },
      });
  } catch {
    // The health screen must still explain that its own metadata migration is
    // missing; it must not hide the primary diagnostic behind another 500.
  }
}

async function collectHealth(req: Parameters<typeof requireAuth>[0]) {
  const checkedAt = new Date().toISOString();
  const checks: Array<{
    key: string;
    status: CheckStatus;
    summary: string;
    details?: unknown;
  }> = [];

  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ key: "database", status: "ok", summary: "اتصال قاعدة البيانات يعمل" });
  } catch (error) {
    checks.push({
      key: "database",
      status: "blocked",
      summary: "تعذر الاتصال بقاعدة البيانات",
      details: { reason: error instanceof Error ? error.message : "unknown" },
    });
  }

  try {
    const [latest] = await db
      .select()
      .from(migrationLedgerTable)
      .orderBy(desc(migrationLedgerTable.appliedAt))
      .limit(1);
    checks.push({
      key: "migrations",
      status: latest ? "ok" : "warning",
      summary: latest ?
        `آخر migration: ${latest.filename}`
      : "لا يوجد سجل migrations",
      details: latest ?? null,
    });
  } catch {
    checks.push({
      key: "migrations",
      status: "blocked",
      summary: "جدول سجل migrations غير متاح؛ شغّل preflight ثم migration",
    });
  }

  const requiredConfiguration = [
    "DATABASE_URL",
    "JWT_SECRET",
    "PORTAL_JWT_SECRET",
  ];
  const missingConfiguration = requiredConfiguration.filter(
    (key) => !process.env[key],
  );
  checks.push({
    key: "configuration",
    status: missingConfiguration.length ? "blocked" : "ok",
    summary: missingConfiguration.length ?
      "إعدادات تشغيل إجبارية ناقصة"
    : "الإعدادات الإجبارية موجودة",
    details: { missing: missingConfiguration },
  });

  try {
    const [openFindings] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dataAuditFindingsTable)
      .where(eq(dataAuditFindingsTable.status, "open"));
    const count = Number(openFindings?.count ?? 0);
    checks.push({
      key: "data-audit",
      status: count ? "warning" : "ok",
      summary: count ?
        `يوجد ${count} finding مفتوح يحتاج مراجعة`
      : "لا توجد findings مفتوحة",
      details: { openFindings: count },
    });
  } catch {
    checks.push({
      key: "data-audit",
      status: "unknown",
      summary: "لم تُشغّل هجرة سجل فحص البيانات بعد",
    });
  }

  await Promise.all(
    checks.map((check) =>
      recordCheck(check.key, check.status, check.summary, check.details),
    ),
  );

  const overall = checks.reduce<CheckStatus>(
    (current, check) =>
      statusRank(check.status) > statusRank(current) ? check.status : current,
    "ok",
  );

  return {
    status: overall,
    checkedAt,
    correlationId: req.correlationId,
    checks,
  };
}

router.get("/health/ready", async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      data: {
        status: "ready",
        database: "ok",
        checkedAt: new Date().toISOString(),
      },
      meta: { apiVersion: API_CONTRACT_VERSION, correlationId: req.correlationId },
    });
  } catch {
    res
      .status(503)
      .json(
        failure(
          "DATABASE_UNAVAILABLE",
          "الخدمة تعمل لكن قاعدة البيانات غير متاحة حاليًا",
          { reference: req.correlationId },
        ),
      );
  }
});

router.get(
  "/admin/health",
  requireAuth,
  requireRole(...HEALTH_ROLES),
  async (req, res, next) => {
    try {
      const health = await collectHealth(req);
      res.json({
        data: health,
        meta: { apiVersion: API_CONTRACT_VERSION, correlationId: req.correlationId },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/admin/audit/findings",
  requireAuth,
  requireRole(...HEALTH_ROLES),
  async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const findings = await db
        .select()
        .from(dataAuditFindingsTable)
        .orderBy(desc(dataAuditFindingsTable.createdAt))
        .limit(limit);
      res.json({
        data: findings,
        meta: { apiVersion: API_CONTRACT_VERSION, correlationId: req.correlationId },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/admin/diagnostics/availability",
  requireAuth,
  requireRole(...HEALTH_ROLES),
  async (req, res, next) => {
    try {
      const feature = String(req.query.feature || "production");
      const health = await collectHealth(req);
      const blockedChecks = health.checks.filter(
        (check) => check.status === "blocked" || check.status === "unknown",
      );
      res.json({
        data: {
          feature,
          available: blockedChecks.length === 0,
          reason: blockedChecks.length ?
            "الميزة غير متاحة لأن فحوصات الأساس لم تكتمل"
          : "لا يوجد مانع معروف في فحوصات الأساس",
          blockedBy: blockedChecks.map((check) => ({
            check: check.key,
            explanation: check.summary,
          })),
          nextAction: blockedChecks.length ?
            "شغّل migration preflight ثم راجع findings المفتوحة"
          : null,
        },
        meta: { apiVersion: API_CONTRACT_VERSION, correlationId: req.correlationId },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;