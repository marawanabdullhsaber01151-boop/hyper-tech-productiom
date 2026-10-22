/** @format */

// تثبيت: npm install express-rate-limit
import rateLimit from "express-rate-limit";

/** حماية من Brute Force على صفحة تسجيل الدخول */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: Number(process.env.LOGIN_RATE_MAX) || 10, // 10 محاولات فقط لكل IP (قابلة للضبط للاختبارات)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "محاولات كثيرة — حاول مرة أخرى بعد 15 دقيقة",
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
