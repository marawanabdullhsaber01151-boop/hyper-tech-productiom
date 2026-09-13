/** @format */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and set your PostgreSQL URL.",
  );
}

// ⚠️ ملاحظة أمان: rejectUnauthorized:false يقبل أي شهادة SSL (حتى المزوّرة).
// شائع مع Railway/Render لأن شهاداتهم غالباً self-signed.
// لو مزود الاستضافة بيدعم شهادة CA حقيقية، حط PGSSL_STRICT=true في .env
// عشان تفعّل التحقق الكامل من الشهادة.
const useStrictSSL = process.env.PGSSL_STRICT === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // إعدادات مناسبة لشركة كبيرة
  max: 20, // حد أقصى 20 connection متزامن
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl:
    process.env.NODE_ENV === "production" ?
      { rejectUnauthorized: useStrictSSL }
    : false,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./schema/foundation";
export { pool };
