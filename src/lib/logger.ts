/**
 * ✨ Logger منظم — بديل console.log/console.error المبعثر في كل مكان.
 * مقصود إننا منضفش أي مكتبة خارجية (winston/pino) هنا — عشان نتجنب أي
 * dependency جديدة تحتاج npm install قبل ما نتأكد من توافقها مع بيئة
 * التشغيل الفعلية. الشكل موحّد وقابل للقراءة الآلية (JSON) في production،
 * وقابل للقراءة البشرية في development.
 *
 * الاستخدام:
 *   import { logger } from "./lib/logger";
 *   logger.info("تم إنشاء أمر بيع", { orderId, userId });
 *   logger.error("فشل الاتصال بقاعدة البيانات", { error: err.message });
 */

type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };

  if (process.env.NODE_ENV === "production") {
    // ✅ في production: سطر JSON واحد لكل حدث — قابل للبحث/التجميع بسهولة
    // في أي أداة مراقبة سجلات (Railway logs, Datadog, CloudWatch...)
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } else {
    // في development: شكل مقروء بسرعة أثناء الشغل
    const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️ " : "ℹ️ ";
    const metaStr = meta ? " " + JSON.stringify(meta) : "";
    const line = `${prefix} [${entry.timestamp}] ${message}${metaStr}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
