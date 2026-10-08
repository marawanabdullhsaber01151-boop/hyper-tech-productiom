/**
 * Plan 02 — creates user + owner member + company code for every legacy
 * portal company. Idempotent. Usage:
 *   npm run db:migrate:identity            (dry run, changes nothing)
 *   npm run db:migrate:identity -- --apply (does it)
 * Conflicts are reported, never auto-merged. Secrets are never printed.
 */
import "dotenv/config";
import { asc } from "drizzle-orm";
import { db } from "../src/db";
import { portalCustomersTable } from "../src/db/schema";
import { provisionCompanyIdentity } from "../src/lib/portalIdentityProvisioning";

const apply = process.argv.includes("--apply");

async function main() {
  const companies = await db
    .select({ id: portalCustomersTable.id, name: portalCustomersTable.companyName })
    .from(portalCustomersTable)
    .orderBy(asc(portalCustomersTable.id));

  const counts = { created: 0, exists: 0, conflict: 0, missing: 0, emailSkipped: 0 };
  const problems: string[] = [];

  for (const c of companies) {
    // Dry run: do the real work inside a transaction and roll it back.
    const outcome = await db
      .transaction(async (tx) => {
        const r = await provisionCompanyIdentity(tx as never, c.id);
        if (!apply) throw Object.assign(new Error("rollback"), { result: r });
        return r;
      })
      .catch((e: unknown) => {
        if (e && typeof e === "object" && "result" in e) {
          return (e as { result: Awaited<ReturnType<typeof provisionCompanyIdentity>> }).result;
        }
        throw e;
      });
    counts[outcome.status] += 1;
    if (outcome.status === "created" && outcome.emailSkipped) {
      counts.emailSkipped += 1;
      problems.push(`شركة ${c.id} (${c.name}): الإيميل مستخدم عند مستخدم آخر، اتسجّل بدون إيميل`);
    }
    if (outcome.status === "conflict") {
      problems.push(`شركة ${c.id} (${c.name}): ${outcome.reason}`);
    }
  }

  console.log(apply ? "تم التنفيذ (apply)" : "تشغيل تجريبي (dry-run) — مفيش حاجة اتغيّرت");
  console.log(`الشركات: ${companies.length}`);
  console.log(
    `اتعمل لها هوية: ${counts.created} | جاهزة من قبل: ${counts.exists} | تعارض: ${counts.conflict} | مش موجودة: ${counts.missing}`,
  );
  for (const p of problems) console.log(" - " + p);
  if (counts.conflict > 0) process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error("فشل:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
