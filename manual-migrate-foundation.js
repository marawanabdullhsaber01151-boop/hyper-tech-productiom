// Run once against an existing deployment:
//   DATABASE_URL="..." node manual-migrate-foundation.js
//
// The project keeps additive production migrations in migrations/ rather than
// Drizzle's generated baseline directory. This runner applies 0021 atomically
// and is safe to run again.
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const sqlFile = path.join(__dirname, "migrations", "0021_foundation_inventory_link.sql");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const statements = fs.readFileSync(sqlFile, "utf8")
      .split(/--> statement-breakpoint/g)
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter(Boolean);
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    console.log("Foundation migration 0021 applied successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Foundation migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Foundation migration failed:", error.message);
  process.exitCode = 1;
});