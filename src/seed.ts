/** @format */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { systemSettingsTable, systemUsersTable } from "./db/schema";

/**
 * ✅ تهيئة أولية فقط — بدون أي بيانات تجريبية تجارية.
 * يضبط الحد الأدنى اللازم لتشغيل النظام: إعدادات الشركة الافتراضية + أول حساب مدير كامل.
 * مفاتيح الإعدادات هنا مطابقة تمامًا لِـ ALLOWED_SETTING_KEYS في src/routes/settings.ts —
 * أي تعديل في القائمة هناك لازم ينعكس هنا كمان لتفادي تضارب الأسماء.
 */
async function seed() {
  console.log("🌱 بدء التهيئة الأولية للنظام...\n");

  // ─── إعدادات النظام الافتراضية ──────────────────────────────────────────────
  await db
    .insert(systemSettingsTable)
    .values([
      { key: "company_name", value: "هايبر تك للتصنيع" },
      { key: "currency", value: "EGP" },
      { key: "currency_symbol", value: "ج.م" },
      { key: "vat_rate", value: "14" },
      { key: "vat_enabled", value: "true" },
      { key: "language", value: "ar" },
      { key: "company_phone", value: "" },
      { key: "company_address", value: "" },
      { key: "company_email", value: "" },
      { key: "fiscal_year_start", value: "01-01" },
    ])
    .onConflictDoNothing();
  console.log("  ✓ إعدادات النظام الافتراضية");

  // ─── أول حساب مدير كامل ──────────────────────────────────────────────────────
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      "SEED_ADMIN_PASSWORD مطلوب في .env — حدد كلمة مرور قوية لأول حساب مدير قبل تشغيل db:seed.",
    );
  }

  const created = await db
    .insert(systemUsersTable)
    .values({
      username: "admin",
      passwordHash: await bcrypt.hash(adminPassword, 12),
      fullName: "مدير النظام",
      role: "chairman",
      status: "active",
    })
    .onConflictDoNothing()
    .returning();

  if (created.length > 0) {
    console.log("  ✓ تم إنشاء حساب المدير الكامل الأول (admin)");
  } else {
    console.log("  • حساب admin موجود بالفعل — لم يتم إنشاء حساب جديد");
  }

  console.log(
    "\n✅ التهيئة الأولية اكتملت — النظام جاهز بدون أي بيانات تجريبية.",
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ فشلت التهيئة الأولية:", err);
  process.exit(1);
});
