import { Request, Response, NextFunction } from "express";
import { writeAuditEvent } from "../lib/governance";

/**
 * Safety net for the audit requirement: every authenticated state-changing
 * request gets a durable event, including routes added later that forget to
 * call the detailed audit helper. Route-level events can still add the
 * business-specific before/after snapshot.
 */
export function mutationAudit(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    if (!req.user || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
    const match = req.path.match(/\/(\d+)(?:\/|$)/);
    writeAuditEvent({
      actorUserId: req.user.userId,
      actorName: req.user.username,
      actionKey: `${req.method.toLowerCase()} ${req.path}`,
      resourceType: req.path.split("/")[3] || "request",
      resourceId: match ? Number(match[1]) : null,
      decision: res.statusCode < 400 ? "executed" : "rejected",
      reason: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    }).catch(() => {
      // Auditing must never turn a completed business operation into a 500.
    });
  });
  next();
}