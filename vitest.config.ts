import { defineConfig } from "vitest/config";

/**
 * ✅ اختبارات وحدة (unit tests) بس، من غير أي اتصال بقاعدة بيانات حقيقية.
 * آمن يشتغل في أي بيئة CI من غير أي إعداد إضافي. اختبارات التكامل (اللي
 * محتاجة DB حقيقية) لازم تتحط في ملف تشغيل منفصل (vitest.integration.config.ts)
 * عشان "npm test" العادي يفضل سريع وآمن ويعمل تلقائيًا مع pretest (smoke-test.js).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
