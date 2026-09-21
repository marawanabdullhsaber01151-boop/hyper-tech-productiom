import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import { db } from "../db";
import { systemUsersTable, loginSessionsTable, permissionOverridesTable } from "../db/schema";
import { findAction } from "../lib/actionRegistry";
import { USER_ROLES } from "../lib/roles";
import { getDefaultRolesForPermission } from "../lib/permissions";
import { findActiveDelegation, writeAuditEvent } from "../lib/governance";
import { getEffectiveRoles } from "../lib/delegation";
import { failure } from "../contracts/api-response";

// ✅ إصلاح جوهري: التوكن دلوقتي بيحمل رقم الجلسة بس، مش الدور أو الحالة.
// كل طلب بيتأكد من قاعدة البيانات مباشرة (الدور الحقيقي + حالة الحساب +
// هل الجلسة دي لسه شغالة)، فأي تعطيل حساب أو تغيير دور بيتفعّل فورًا على
// كل الأجهزة، بدل ما يفضل التوكن القديم شغال لحد 7 أيام.

export interface SessionTokenPayload {
  sessionId: number;
  scopeId?: string | null;
}

export interface AuthPayload {
  userId: number;
  username: string;
  role: string;
  sessionId: number;
  scopeId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const configuredSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
if (!configuredSecret) {
  throw new Error("JWT_SECRET or SESSION_SECRET is required. Configure a strong random secret.");
}
const JWT_SECRET = configuredSecret;
if (process.env.NODE_ENV === "production" && JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production.");
}

export function generateToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "7d",
  });
}

// Security hardening — 2FA pre-auth token: issued right after a correct
// password when the account has TOTP enabled, before any real session
// exists. Deliberately a distinct claim shape ({mfaUserId, purpose}, no
// sessionId) and a short 5-minute expiry, signed with the same JWT_SECRET,
// so it can never be accepted by requireAuth (which only ever looks up
// payload.sessionId) even if someone tried to reuse it there — the lookup
// would simply find no matching session and be rejected the normal way.
interface MfaPreAuthPayload {
  mfaUserId: number;
  purpose: "mfa_pending";
}

export function generateMfaPreAuthToken(userId: number): string {
  return jwt.sign({ mfaUserId: userId, purpose: "mfa_pending" } satisfies MfaPreAuthPayload, JWT_SECRET, {
    expiresIn: "5m",
  });
}

export function verifyMfaPreAuthToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Partial<MfaPreAuthPayload>;
    if (payload.purpose !== "mfa_pending" || typeof payload.mfaUserId !== "number") return null;
    return payload.mfaUserId;
  } catch {
    return null;
  }
}

function authError(
  res: Response,
  status: 401 | 403,
  code: "UNAUTHORIZED" | "FORBIDDEN",
  message: string,
) {
  res.status(status).json(failure(code, message));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    authError(res, 401, "UNAUTHORIZED", "غير مصرح — يرجى تسجيل الدخول");
    return;
  }

  const token = authHeader.slice(7);

  let payload: SessionTokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as SessionTokenPayload;
  } catch {
    authError(res, 401, "UNAUTHORIZED", "الجلسة منتهية — يرجى تسجيل الدخول مجدداً");
    return;
  }

  try {
    // ✅ الفحص الحقيقي: نجيب الجلسة والمستخدم مع بعض، طازة من قاعدة البيانات،
    // في كل طلب — مش من التوكن. ده اللي بيضمن التفعيل الفوري لأي تغيير.
    const [row] = await db
      .select({
        sessionId: loginSessionsTable.id,
        revokedAt: loginSessionsTable.revokedAt,
        userId: systemUsersTable.id,
        username: systemUsersTable.username,
        role: systemUsersTable.role,
        status: systemUsersTable.status,
        scopeId: systemUsersTable.scopeId,
      })
      .from(loginSessionsTable)
      .innerJoin(systemUsersTable, eq(loginSessionsTable.userId, systemUsersTable.id))
      .where(eq(loginSessionsTable.id, payload.sessionId))
      .limit(1);

    if (!row || row.revokedAt !== null) {
      authError(res, 401, "UNAUTHORIZED", "تم تسجيل الخروج من هذه الجلسة — يرجى تسجيل الدخول مجدداً");
      return;
    }

    if (row.status === "inactive") {
      authError(res, 403, "FORBIDDEN", "هذا الحساب موقوف — يرجى التواصل مع المدير");
      return;
    }

    // الأدوار القديمة لم تعد صالحة حتى لو بقيت قيمة قديمة في قاعدة البيانات.
    // يجب إعادة تعيين الحساب إلى أحد الأدوار التشغيلية المعتمدة.
    if (!(USER_ROLES as readonly string[]).includes(row.role)) {
      authError(res, 403, "FORBIDDEN", "دور الحساب لم يعد معتمدًا — يرجى إعادة تعيين دور المستخدم");
      return;
    }

    req.user = { userId: row.userId, username: row.username, role: row.role, sessionId: row.sessionId, scopeId: row.scopeId };

    // تحديث آخر نشاط — مش لازم ننتظره، مايأثرش على سرعة الطلب
    db.update(loginSessionsTable)
      .set({ lastActiveAt: new Date() })
      .where(eq(loginSessionsTable.id, row.sessionId))
      .catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      authError(res, 401, "UNAUTHORIZED", "غير مصرح");
      return;
    }
    let effectiveRoles = [req.user.role];
    try {
      effectiveRoles = await getEffectiveRoles(req.user.userId);
    } catch {
      // A delegation lookup outage must not remove the user's original access.
    }
    // ✅ رئيس مجلس الإدارة (chairman) له صلاحية كاملة على كل إجراء في كل
    // شاشة، بلا استثناء — بدل ما يعتمد الأمر على إضافة "chairman" يدويًا
    // في requireRole/requirePermission لكل مسار على حدة (زي ما حصل ونسي
    // مسار إنشاء طلب الإنتاج قبل كده)، البوابة موحّدة هنا في مكان واحد
    // فمفيش مسار جديد أو قديم ممكن ينسى يديله صلاحية.
    if (effectiveRoles.includes("chairman")) {
      next();
      return;
    }
    if (!roles.some((role) => effectiveRoles.includes(role))) {
      authError(res, 403, "FORBIDDEN", "ليس لديك صلاحية للقيام بهذا الإجراء");
      return;
    }
    next();
  };
}

// ✨ requirePermission: زي requireRole بالظبط، لكن قبل ما يرجع للدور
// الافتراضي، بيتأكد الأول لو المستخدم عنده استثناء صريح (permission
// override) نشط على الإجراء ده — سواء منح صلاحية إضافية أو سحب صلاحية
// كان مفروض يكون عنده. ده اللي بيسمح بتفويض دقيق (زرار واحد بعينه) أو
// تفويض مؤقت (بتاريخ انتهاء) من غير ما نلمس نظام الأدوار الأساسي خالص.
export function requirePermission(actionKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      authError(res, 401, "UNAUTHORIZED", "غير مصرح");
      return;
    }
    try {
      const [override] = await db
        .select({ allowed: permissionOverridesTable.allowed })
        .from(permissionOverridesTable)
        .where(
          and(
            eq(permissionOverridesTable.userId, req.user.userId),
            eq(permissionOverridesTable.actionKey, actionKey),
            isNull(permissionOverridesTable.revokedAt),
            or(isNull(permissionOverridesTable.expiresAt), gt(permissionOverridesTable.expiresAt, new Date())),
          ),
        )
        .limit(1);

      if (override) {
        if (override.allowed) {
          next();
        } else {
          authError(res, 403, "FORBIDDEN", "صلاحيتك لهذا الإجراء موقوفة حاليًا");
        }
        return;
      }

      // مفيش استثناء — نرجع للدور الافتراضي المسجّل في سجل الإجراءات
      const action = findAction(actionKey);
       const defaultRoles =
         action?.defaultRoles ?? getDefaultRolesForPermission(actionKey);
      let effectiveRoles = [req.user.role];
      try {
        effectiveRoles = await getEffectiveRoles(req.user.userId);
      } catch {
        // Safe fallback to the database-backed original role.
      }
      // ✅ نفس بوابة صلاحية chairman الموحّدة الموجودة في requireRole —
      // بعد التأكد إن مفيش استثناء صريح موقّف الصلاحية دي بالتحديد لصاحبها
      // (الفحص فوق)، رئيس مجلس الإدارة يعدّي مباشرة من غير حاجة لإدراج
      // "chairman" في defaultRoles ولا انتظار تفويض.
      if (effectiveRoles.includes("chairman")) {
        next();
        return;
      }
      if (defaultRoles.some((role) => effectiveRoles.includes(role)) || effectiveRoles.includes(actionKey)) {
        next();
        return;
      }

      // ✅ إصلاح حرج: نظام "التفويض" (delegations table + واجهة إدارته
      // الكاملة في governance.ts) كان موجود بالكامل — إنشاء، عرض، إلغاء،
      // حتى دالة findActiveDelegation نفسها — لكن غير مستخدم في أي مكان
      // خالص. يعني مدير يفوّض صلاحية لموظف، التفويض يتسجل في قاعدة
      // البيانات بنجاح، لكن الموظف يفضل مرفوض 403 بالظبط زي قبل التفويض،
      // لأن requirePermission (نقطة التحقق الحقيقية الوحيدة) ماكانش بيسأل
      // عن التفويضات خالص. دلوقتي بيتحقق منها كـ fallback أخير بعد فشل
      // الدور الافتراضي — وكل استخدام فعلي للتفويض بيتسجل في audit_events
      // فورًا (بدون ما يعطّل الطلب لو فشل التسجيل نفسه لأي سبب).
      const delegation = await findActiveDelegation(req.user.userId, actionKey);
      if (delegation) {
        writeAuditEvent({
          actorUserId: req.user.userId,
          actorName: req.user.username,
          actionKey,
          resourceType: "delegated_access",
          decision: "granted_via_delegation",
          delegationId: delegation.id,
          reason: `تم السماح بالإجراء عن طريق تفويض من المستخدم رقم ${delegation.grantorUserId}`,
        }).catch(() => {
          // فشل تسجيل التدقيق لا يوقف طلب المستخدم الشرعي — بس نطبع تحذير
          console.warn(`[Governance] فشل تسجيل حدث تدقيق للتفويض ${delegation.id}`);
        });
        next();
        return;
      }

      authError(res, 403, "FORBIDDEN", "ليس لديك صلاحية للقيام بهذا الإجراء");
    } catch (err) {
      next(err);
    }
  };
}
