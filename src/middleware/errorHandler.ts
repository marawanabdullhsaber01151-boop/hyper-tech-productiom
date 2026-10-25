/** @format */

import { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { logger } from "../lib/logger";
import { failure } from "../contracts/api-response";
import { isHttpError } from "../contracts/errors";
import { recordErrorEvent } from "../lib/errorEvents";

/**
 * أي error بيتترمي في الكود بالشكل ده:
 *   throw Object.assign(new Error("..."), { status: 404 });
 * ده "domain error" مقصود ومصمم برسالة عربية آمنة تتعرض للمستخدم زي ما هي —
 * مش خطأ داخلي غامض. لازم نحترم الـ status بتاعه ونعرض رسالته زي ما هي،
 * سواء في development أو production.
 */
function isDomainError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number" &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 600
  );
}

// ✨ لمسة: مرجع تتبّع قصير لكل خطأ غير متوقع (500) — بيتسجل في اللوج وبيترجع
// للمستخدم في نفس الوقت. بدل ما المستخدم يقولك "حصل خطأ" ومفيش أي خيط تمسكه،
// بيديك كود زي ERR-8F2K1 تقدر تدوّر بيه في اللوج على اللحظة بالظبط.
function generateErrorRef(): string {
  return "ERR-" + randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    const messages = err.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: `خطأ في البيانات: ${messages}`,
        details: err.errors,
      },
    });
    return;
  }

  // PostgreSQL unique violation
  const pg = findPostgresError(err);
  if (pg && pg.code === "23505") {
    res.status(409).json({
      error: {
        code: "DUPLICATE_ENTRY",
        message: "هذا السجل موجود بالفعل — يرجى التحقق من البيانات المدخلة",
      },
    });
    return;
  }

  // PostgreSQL foreign key violation
  if (pg && pg.code === "23503") {
    res.status(400).json({
      error: {
        code: "FOREIGN_KEY_VIOLATION",
        message: "لا يمكن إجراء هذه العملية — يوجد ارتباط بسجلات أخرى",
      },
    });
    return;
  }

  // ✅ إصلاح جوهري: أخطاء النطاق (404 / 400 / 409 / 422 ...) اللي الكود نفسه
  // بيرميها بقصد ورسالة عربية جاهزة للعرض — كانت بتتجاهل تمامًا وتترجع 500.
  if (isDomainError(err)) {
    const domainError = err as Error & {
      status: number;
      code?: string;
      details?: unknown;
    };
    res
      .status(domainError.status)
      .json(
        failure(domainError.code ?? "DOMAIN_ERROR", domainError.message, {
          details: domainError.details,
        }),
      );
    return;
  }

  // Generic / unexpected server error
  const errorRef = generateErrorRef();
  const message = err instanceof Error ? err.message : "خطأ داخلي في الخادم";
  logger.error(`[${errorRef}] ${message}`, {
    reference: errorRef,
    path: req.originalUrl,
    method: req.method,
    correlationId: req.correlationId,
    stack: err instanceof Error ? err.stack : undefined,
  });
  recordErrorEvent({
    reference: errorRef,
    method: req.method,
    path: req.originalUrl,
    message,
    userId: (req as { user?: { userId?: number } }).user?.userId ?? null,
    correlationId: req.correlationId ?? null,
  });
  res.status(500).json(
    failure(
      "INTERNAL_SERVER_ERROR",
      process.env.NODE_ENV === "development" ? message : "حدث خطأ غير متوقع",
      { reference: errorRef },
    ),
  );
}

/**
 * drizzle-orm (0.4x) بيغلّف خطأ postgres جوّه DrizzleQueryError.cause، فالكود (23505 / 23503)
 * مش بيبقى على الخطأ الخارجي. بنمشي على سلسلة cause عشان نلاقي الخطأ الأصلي،
 * وإلا أي تعارض أو ارتباط كان بيطلع 500 بدل رسالة واضحة.
 */
export function findPostgresError(err: unknown): { code: string; detail?: string } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && typeof cur === "object" && cur !== null; i += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return cur as { code: string; detail?: string };
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json(failure("NOT_FOUND", "المسار غير موجود"));
}
