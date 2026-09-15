import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * ✨ إضافة: مفيش أي أثر لأي طلب داخل على السيرفر كان موجود قبل كده خالص —
 * لو حصلت محاولة اختراق متكررة، أو endpoint معيّن بيبطّئ النظام، أو مستخدم
 * بيعمل نفس الغلطة كتير، مفيش أي طريقة تعرف بيها ده غير الصدفة. الميدلوير
 * ده بيسجّل كل طلب: الطريقة، المسار، كود الرد، والوقت اللي استغرقه —
 * ومهم أكتر: بيسجّل الردود البطيئة (>1 ثانية) كـ warning تلقائيًا، عشان
 * تلاقط أي endpoint بيبدأ يبطّئ قبل ما يبقى مشكلة حقيقية.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const meta = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      userId: req.user?.userId,
      correlationId: req.correlationId,
    };

    if (res.statusCode >= 500) {
      logger.error(`${req.method} ${req.originalUrl} → ${res.statusCode}`, meta);
    } else if (res.statusCode >= 400) {
      logger.warn(`${req.method} ${req.originalUrl} → ${res.statusCode}`, meta);
    } else if (durationMs > 1000) {
      // ✨ رد بطيء (أكتر من ثانية) حتى لو نجح — إنذار مبكر قبل ما يبقى مشكلة أداء حقيقية
      logger.warn(`استجابة بطيئة: ${req.method} ${req.originalUrl} استغرقت ${durationMs}ms`, meta);
    } else if (process.env.NODE_ENV !== "production") {
      logger.info(`${req.method} ${req.originalUrl} → ${res.statusCode}`, { durationMs });
    }
  });

  next();
}
