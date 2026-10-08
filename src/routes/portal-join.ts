/** @format */
/**
 * Public "join my company with the company code" endpoint.
 *  - Failures about the code are one uniform answer (no code/company probing).
 *  - Strict rate limits per IP and per phone.
 *  - A person who already has an account must prove it with their password.
 *  - The result never reveals whether a phone number is registered.
 */
import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  portalCustomersTable,
  portalMembersTable,
  portalNotificationsTable,
  portalUsersTable,
} from "../db/schema";
import { consumeCompanyCode, lookupCompanyCode } from "../lib/companyCode";
import { normalizeEmail, normalizePhone } from "../lib/identityNormalization";
import { writePortalAudit } from "../lib/portalAudit";
import { findAssignableRole } from "../lib/portalRoles";
import { createSettingsResolver } from "../lib/portalSettings";
import { assertSeatAvailable, domainError } from "../lib/portalTeam";

class CodeExhausted extends Error {}

const router = Router();
const dummyHash = bcrypt.hash("portal-join-timing-padding", 12);

const byIp = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.PORTAL_JOIN_RATE_MAX_IP ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: "RATE_LIMITED", message: "محاولات كتير. جرّب بعد شوية" },
  },
});
const byPhone = rateLimit({
  windowMs: 60 * 60_000,
  max: Number(process.env.PORTAL_JOIN_RATE_MAX_PHONE ?? 8),
  keyGenerator: (req) =>
    normalizePhone(typeof req.body?.phone === "string" ? req.body.phone : "") ||
    "missing",
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false, xForwardedForHeader: false },
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "محاولات كتير على الرقم ده. جرّب بعد شوية",
    },
  },
});

const joinSchema = z.object({
  code: z.string().trim().min(6).max(20),
  fullName: z.string().trim().min(2, "الاسم مطلوب").max(100),
  phone: z.string().trim().min(8, "رقم هاتف غير صحيح").max(20),
  email: z
    .string()
    .trim()
    .email("بريد غير صحيح")
    .optional()
    .nullable()
    .or(z.literal("")),
  password: z.string().min(6, "كلمة السر 6 أحرف على الأقل").max(100),
});

const BAD_CODE = {
  error: {
    code: "JOIN_CODE_INVALID",
    message: "الكود مش صحيح أو مش شغال دلوقتي",
  },
};

router.post(
  "/portal/join",
  byIp,
  byPhone,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = joinSchema.parse(req.body);
      const phone = normalizePhone(body.phone);
      if (!phone) throw domainError(400, "INVALID_PHONE", "رقم هاتف غير صحيح");
      const email = body.email ? normalizeEmail(body.email) : "";
      const hash = await dummyHash;

      type Outcome =
        | { kind: "bad_code" }
        | { kind: "bad_credentials" }
        | { kind: "ok"; status: "joined" | "pending"; companyName: string };

      const outcome: Outcome = await db
        .transaction(async (tx): Promise<Outcome> => {
          const found = await lookupCompanyCode(tx, body.code);
          if (!found.ok) return { kind: "bad_code" };

          const [company] = await tx
            .select({
              id: portalCustomersTable.id,
              name: portalCustomersTable.companyName,
              isActive: portalCustomersTable.isActive,
            })
            .from(portalCustomersTable)
            .where(eq(portalCustomersTable.id, found.companyId))
            .for("update")
            .limit(1);
          if (!company || !company.isActive) return { kind: "bad_code" };

          const settings = await createSettingsResolver(
            { companyId: company.id },
            tx,
          );
          const mode = settings.get<string>("join.mode");
          if (
            mode === "disabled" ||
            settings.get<boolean>("join.code.enabled") === false
          ) {
            return { kind: "bad_code" };
          }
          const expiresAt = settings.get<string | null>("join.code.expires_at");
          if (expiresAt && new Date(expiresAt) <= new Date())
            return { kind: "bad_code" };

          // Existing person must prove who they are; new person gets created.
          let [user] = await tx
            .select()
            .from(portalUsersTable)
            .where(eq(portalUsersTable.normalizedPhone, phone))
            .limit(1);
          if (user) {
            const ok = await bcrypt.compare(body.password, user.passwordHash);
            if (!ok || user.status !== "active")
              return { kind: "bad_credentials" };
          } else {
            await bcrypt.compare(body.password, hash); // keep timing similar
            if (email) {
              const [emailTaken] = await tx
                .select({ id: portalUsersTable.id })
                .from(portalUsersTable)
                .where(eq(portalUsersTable.normalizedEmail, email))
                .limit(1);
              if (emailTaken) return { kind: "bad_credentials" };
            }
            [user] = await tx
              .insert(portalUsersTable)
              .values({
                phone: body.phone.trim(),
                normalizedPhone: phone,
                email: body.email ? body.email.trim() : null,
                normalizedEmail: email || null,
                passwordHash: await bcrypt.hash(body.password, 12),
                fullName: body.fullName,
                activatedAt: new Date(),
              })
              .returning();
          }
          if (!user) return { kind: "bad_credentials" };

          const [existing] = await tx
            .select()
            .from(portalMembersTable)
            .where(
              and(
                eq(portalMembersTable.companyId, company.id),
                eq(portalMembersTable.userId, user.id),
              ),
            )
            .limit(1);
          if (existing && existing.status === "active") {
            throw domainError(
              409,
              "ALREADY_MEMBER",
              "إنت عضو في الشركة دي بالفعل. سجّل دخول",
            );
          }
          if (existing && existing.status === "pending_approval") {
            return { kind: "ok", status: "pending", companyName: company.name };
          }
          if (existing && existing.status === "suspended") {
            return { kind: "bad_credentials" };
          }

          await assertSeatAvailable(tx, company.id);
          if (!(await consumeCompanyCode(tx, found.codeId)))
            throw new CodeExhausted();

          const roleKey = settings.get<string>("join.default_role");
          const role = await findAssignableRole(tx, company.id, roleKey);
          if (!role)
            throw domainError(500, "ROLE_MISSING", "الدور الافتراضي مش موجود");

          const status = mode === "auto" ? "active" : "pending_approval";
          let memberId: number;
          if (existing) {
            // previously removed/rejected: reuse the row so history stays linked
            await tx
              .update(portalMembersTable)
              .set({
                status,
                roleId: role.id,
                joinedVia: "company_code",
                limits: {},
              })
              .where(eq(portalMembersTable.id, existing.id));
            memberId = existing.id;
          } else {
            const [created] = await tx
              .insert(portalMembersTable)
              .values({
                companyId: company.id,
                userId: user.id,
                roleId: role.id,
                status,
                joinedVia: "company_code",
              })
              .returning({ id: portalMembersTable.id });
            memberId = created!.id;
          }
          await writePortalAudit(tx, {
            companyId: company.id,
            actorMemberId: memberId,
            actorLabel: `member:${memberId}`,
            action: status === "active" ? "join.auto" : "join.requested",
            targetType: "member",
            targetId: memberId,
            after: { fullName: user.fullName, role: role.key },
            ip: req.ip,
            userAgent: req.get("user-agent"),
          });
          if (status === "pending_approval") {
            await tx.insert(portalNotificationsTable).values({
              portalCustomerId: company.id,
              type: "portal_join_request",
              title: "طلب انضمام جديد",
              body: `${user.fullName} عايز ينضم لحساب الشركة بالكود. راجع الطلب من صفحة الفريق.`,
              referenceType: "portal_member",
              referenceId: memberId,
            });
          }
          return {
            kind: "ok",
            status: status === "active" ? "joined" : "pending",
            companyName: company.name,
          };
        })
        .catch((e: unknown): Outcome => {
          if (e instanceof CodeExhausted) return { kind: "bad_code" };
          throw e;
        });

      if (outcome.kind === "bad_code") {
        res.status(400).json(BAD_CODE);
        return;
      }
      if (outcome.kind === "bad_credentials") {
        res.status(400).json({
          error: {
            code: "JOIN_FAILED",
            message: "مقدرناش نكمّل الانضمام بالبيانات دي. راجعها وجرّب تاني",
          },
        });
        return;
      }
      res.status(outcome.status === "joined" ? 201 : 202).json({
        status: outcome.status,
        companyName: outcome.companyName,
        message:
          outcome.status === "joined"
            ? "تمام، اتضفت للشركة. سجّل دخول بالرقم وكلمة السر"
            : "طلبك وصل لرئيس الشركة. هتقدر تدخل أول ما يوافق",
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
