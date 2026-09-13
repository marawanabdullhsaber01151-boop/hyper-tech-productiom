import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/0038_identity_normalization.sql"),
  "utf8",
);

describe("identity normalization migration safety", () => {
  it("is additive, conflict-reporting, and retry-safe by construction", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION");
    expect(migration).toContain("RAISE WARNING");
    expect(migration).not.toMatch(
      /\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE)\b/i,
    );
  });
});