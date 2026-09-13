/**
 * Read-only sales/inventory integrity report.
 *
 * This script never updates production data. It reports:
 *  1. shipped/paid order items without a matching outbound stock movement
 *     (including partial deductions);
 *  2. inventory reservations that exceed the quantity justified by confirmed
 *     sales orders.
 *
 * Usage:
 *   node scripts/sales-integrity-check.mjs
 */

import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL مش موجودة — التقرير لم يُنفَّذ.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: process.env.PGSSL_STRICT === "true" }
      : false,
});

const missingStockMovementsQuery = `
  SELECT
    so.id,
    so.order_number AS "orderNumber",
    so.status,
    soi.id AS "itemId",
    soi.inventory_item_id AS "inventoryItemId",
    ii.name AS "inventoryItemName",
    soi.qty::numeric AS "requestedQty",
    COALESCE(SUM(
      CASE
        WHEN sm.movement_type = 'out' THEN sm.qty::numeric
        ELSE 0
      END
    ), 0)::numeric AS "outboundQty"
  FROM sales_orders so
  INNER JOIN sales_order_items soi ON soi.order_id = so.id
  INNER JOIN inventory_items ii ON ii.id = soi.inventory_item_id
  LEFT JOIN stock_movements sm
    ON sm.reference_type = 'sales_order'
   AND sm.reference_id = so.id
   AND sm.inventory_item_id = soi.inventory_item_id
  WHERE so.status IN ('shipped', 'paid')
  GROUP BY
    so.id, so.order_number, so.status, soi.id,
    soi.inventory_item_id, ii.name, soi.qty
  HAVING COALESCE(SUM(
    CASE
      WHEN sm.movement_type = 'out' THEN sm.qty::numeric
      ELSE 0
    END
  ), 0) < soi.qty::numeric
  ORDER BY so.id, soi.id;
`;

const orphanedReservationsQuery = `
  SELECT
    ii.id AS "inventoryItemId",
    ii.code,
    ii.name,
    ii.reserved_qty::numeric AS "reservedQty",
    COALESCE(SUM(
      CASE
        WHEN so.status = 'confirmed' THEN soi.qty::numeric
        ELSE 0
      END
    ), 0)::numeric AS "confirmedQty",
    (
      ii.reserved_qty::numeric - COALESCE(SUM(
        CASE
          WHEN so.status = 'confirmed' THEN soi.qty::numeric
          ELSE 0
        END
      ), 0)::numeric
    )::numeric AS "excessReservedQty"
  FROM inventory_items ii
  LEFT JOIN sales_order_items soi
    ON soi.inventory_item_id = ii.id
  LEFT JOIN sales_orders so
    ON so.id = soi.order_id
  GROUP BY ii.id, ii.code, ii.name, ii.reserved_qty
  HAVING ii.reserved_qty::numeric > 0
     AND ii.reserved_qty::numeric > COALESCE(SUM(
       CASE
         WHEN so.status = 'confirmed' THEN soi.qty::numeric
         ELSE 0
       END
     ), 0)::numeric
  ORDER BY ii.id;
`;

try {
  const [missingStockMovements, orphanedReservations] = await Promise.all([
    pool.query(missingStockMovementsQuery),
    pool.query(orphanedReservationsQuery),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    missingStockMovements: missingStockMovements.rows,
    orphanedReservations: orphanedReservations.rows,
    summary: {
      missingStockMovementItems: missingStockMovements.rowCount,
      orphanedReservationItems: orphanedReservations.rowCount,
    },
  };

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error("❌ تعذر تنفيذ تقرير سلامة المبيعات:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}