/** @format */
/**
 * Database-backed authentication for wholesale portal customers.
 *
 * Portal tokens are opaque reference tokens, not JWTs. Keeping only the
 * reference in the client and the session state in PostgreSQL lets us revoke
 * a session immediately and apply sliding expiry safely.
 */
import { Request, Response, NextFunction } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import {
  portalCustomersTable,
  portalSessionsTable,
} from "../db/schema";

export interface PortalAuthPayload {
  portalCustomerId: number;
  phone: string;
  sessionId: number;
}

export interface CreatePortalSessionOptions {
  rememberMe?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PortalSessionAuthRecord {
  id: number;
  portalCustomerId: number;
  phone: string;
  rememberMe: boolean;
  expiresAt: Date;
}

export interface PortalSessionStore {
  createSession(
    portalCustomerId: number,
    options: CreatePortalSessionOptions,
    now: Date,
  ): Promise<string>;
  findAndTouch(
    sessionToken: string,
    now: Date,
  ): Promise<PortalSessionAuthRecord | null>;
  revokeSession(sessionToken: string, now: Date): Promise<boolean>;
}

declare global {
  namespace Express {
    interface Request {
      portalCustomer?: PortalAuthPayload;
    }
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

function sessionLifetimeMs(rememberMe: boolean): number {
  return rememberMe ? THIRTY_DAYS_MS : ONE_DAY_MS;
}

/**
 * Keeps the label deliberately coarse. User-Agent strings are untrusted and
 * should not be copied wholesale into an admin-facing sessions screen.
 */
export function getPortalDeviceLabel(userAgent?: string | null): string | null {
  if (!userAgent) return null;

  const browser =
    /Edg\//i.test(userAgent) ? "Edge"
    : /OPR\//i.test(userAgent) ? "Opera"
    : /Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent) ? "Chrome"
    : /Firefox\//i.test(userAgent) ? "Firefox"
    : /Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent) ? "Safari"
    : /MSIE|Trident\//i.test(userAgent) ? "Internet Explorer"
    : "متصفح";

  const platform =
    /Android/i.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS"
    : /Windows/i.test(userAgent) ? "Windows"
    : /Macintosh|Mac OS/i.test(userAgent) ? "macOS"
    : /Linux/i.test(userAgent) ? "Linux"
    : null;

  return platform ? `${browser} على ${platform}` : browser;
}

const databasePortalSessionStore: PortalSessionStore = {
  async createSession(portalCustomerId, options, now) {
    const rememberMe = options.rememberMe === true;
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + sessionLifetimeMs(rememberMe));

    const [created] = await db
      .insert(portalSessionsTable)
      .values({
        portalCustomerId,
        sessionToken,
        rememberMe,
        deviceLabel: getPortalDeviceLabel(options.userAgent),
        ipAddress: options.ip ?? null,
        lastActiveAt: now,
        expiresAt,
        createdAt: now,
      })
      .returning({ sessionToken: portalSessionsTable.sessionToken });

    if (!created) {
      throw new Error("تعذر إنشاء جلسة بوابة العملاء");
    }
    return created.sessionToken;
  },

  async findAndTouch(sessionToken, now) {
    const [match] = await db
      .select({
        session: portalSessionsTable,
        customer: {
          id: portalCustomersTable.id,
          phone: portalCustomersTable.phone,
        },
      })
      .from(portalSessionsTable)
      .innerJoin(
        portalCustomersTable,
        eq(portalSessionsTable.portalCustomerId, portalCustomersTable.id),
      )
      .where(
        and(
          eq(portalSessionsTable.sessionToken, sessionToken),
          eq(portalCustomersTable.isActive, true),
          isNull(portalSessionsTable.revokedAt),
          gt(portalSessionsTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!match) return null;

    const expiresAt = new Date(
      now.getTime() + sessionLifetimeMs(match.session.rememberMe),
    );
    const [touched] = await db
      .update(portalSessionsTable)
      .set({
        lastActiveAt: now,
        expiresAt,
      })
      .where(
        and(
          eq(portalSessionsTable.id, match.session.id),
          isNull(portalSessionsTable.revokedAt),
          gt(portalSessionsTable.expiresAt, now),
        ),
      )
      .returning({ id: portalSessionsTable.id });

    // The conditional update closes the small race where a session is
    // revoked or expires between the read and the sliding-expiry update.
    if (!touched) return null;

    return {
      id: match.session.id,
      portalCustomerId: match.customer.id,
      phone: match.customer.phone,
      rememberMe: match.session.rememberMe,
      expiresAt,
    };
  },

  async revokeSession(sessionToken) {
    const [revoked] = await db
      .update(portalSessionsTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(portalSessionsTable.sessionToken, sessionToken),
          isNull(portalSessionsTable.revokedAt),
        ),
      )
      .returning({ id: portalSessionsTable.id });
    return Boolean(revoked);
  },
};

export async function createPortalSession(
  portalCustomerId: number,
  options: CreatePortalSessionOptions = {},
  store: PortalSessionStore = databasePortalSessionStore,
): Promise<string> {
  return store.createSession(portalCustomerId, options, new Date());
}

export async function revokePortalSession(
  sessionToken: string,
  store: PortalSessionStore = databasePortalSessionStore,
): Promise<boolean> {
  return store.revokeSession(sessionToken, new Date());
}

type PortalSessionUpdateExecutor = Pick<typeof db, "update">;

export async function revokeAllPortalSessions(
  portalCustomerId: number,
  executor: PortalSessionUpdateExecutor = db,
  now = new Date(),
): Promise<number> {
  const revoked = await executor
    .update(portalSessionsTable)
    .set({ revokedAt: now })
    .where(
      and(
        eq(portalSessionsTable.portalCustomerId, portalCustomerId),
        isNull(portalSessionsTable.revokedAt),
      ),
    )
    .returning({ id: portalSessionsTable.id });

  return revoked.length;
}

export function getAuthenticatedPortalCustomerId(
  req: Pick<Request, "portalCustomer">,
): number {
  const portalCustomerId = req.portalCustomer?.portalCustomerId;
  if (
    typeof portalCustomerId !== "number" ||
    !Number.isSafeInteger(portalCustomerId) ||
    portalCustomerId <= 0
  ) {
    throw Object.assign(new Error("جلسة بوابة العملاء غير صالحة"), {
      status: 401,
      code: "INVALID_PORTAL_CUSTOMER_SESSION",
    });
  }
  return portalCustomerId;
}

export function createPortalAuthMiddleware(
  store: PortalSessionStore = databasePortalSessionStore,
) {
  return async function portalAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: { message: "غير مصرح — يرجى تسجيل الدخول" } });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      res
        .status(401)
        .json({ error: { message: "غير مصرح — يرجى تسجيل الدخول" } });
      return;
    }

    try {
      const session = await store.findAndTouch(token, new Date());
      if (!session) {
        res
          .status(401)
          .json({ error: { message: "الجلسة منتهية — يرجى تسجيل الدخول مجدداً" } });
        return;
      }

      req.portalCustomer = {
        portalCustomerId: session.portalCustomerId,
        phone: session.phone,
        sessionId: session.id,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requirePortalAuth = createPortalAuthMiddleware();