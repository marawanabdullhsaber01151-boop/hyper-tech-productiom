import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("اتصال سكربتات الهجرة بقاعدة بدون SSL (CI)", () => {
  for (const file of ["scripts/run-migrations.mjs", "scripts/migration-preflight.mjs"]) {
    it(`${file}: PGSSLMODE=disable بيقفل SSL، والافتراضي (Neon) لسه SSL`, () => {
      const src = read(file);
      expect(src).toContain('process.env.PGSSLMODE === "disable" ? false');
      expect(src).toContain('process.env.PGSSL_STRICT === "true" ? true');
      expect(src).toContain("{ rejectUnauthorized: false }");
    });
  }
});
