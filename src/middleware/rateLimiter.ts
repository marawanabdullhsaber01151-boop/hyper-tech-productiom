/** @format */

// تثبيت: npm install express-rate-limit
import rateLimit from "express-rate-limit";

/** حماية من Brute Force على صفحة تسجيل الدخول */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10, // 10 محاولات فقط لكل IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "محاولات كثيرة — حاول مرة أخرى بعد 15 دقيقة",
    },
  },
});

/** حد منفصل لطلبات OTP على مستوى IP + المعرّف، لمنع الإرسال المتكرر المكلف */
export const otpRequestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    const identifier =
      typeof req.body?.identifier === "string" ?
        req.body.identifier.trim().replace(/\s+/g, "").toLowerCase()
      : "missing";
    return `${req.ip || "unknown"}:${identifier}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "OTP_REQUEST_RATE_LIMIT_EXCEEDED",
      message: "تم تجاوز الحد المسموح لطلبات الأكواد — حاول مرة أخرى بعد ساعة",
    },
  },
});

/** حماية عامة على جميع مسارات الـ API */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 300, // 300 طلب للدقيقة لكل IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "طلبات كثيرة جداً — حاول مرة أخرى بعد قليل",
    },
  },
});
