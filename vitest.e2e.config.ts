import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    environment: "node",
    // كل الملفات بتشتغل على قاعدة واحدة وفيها قوايم عامة: التوازي بيعمل سباق، فالملفات بالتتابع
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});