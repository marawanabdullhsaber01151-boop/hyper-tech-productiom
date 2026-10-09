import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [preact()],
  resolve: { alias: { "@": path.join(here, "src") } },
  define: { __DEV__: "true" },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
    // ويندوز + jsdom: تشغيل كذا worker (forks) مع بعض كان بيعدّي مهلة الـ 60 ثانية
    // ("Timeout waiting for worker to respond"). threads + عدد محدود + مهل أطول بيحلّها.
    pool: "threads",
    maxWorkers: 2,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 20_000,
    // مكتبات الاختبار بتتحمّل مرة واحدة بدل ما كل ملف يحمّلها
    server: { deps: { inline: [/@testing-library/] } },
  },
});
