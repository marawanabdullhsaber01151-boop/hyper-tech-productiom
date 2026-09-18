/** @format */

import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  engineeringProductsTable,
  engineeringRoutingsTable,
} from "./engineering";
import { planningCapacityLoadsTable } from "./planning";
import { productionOperationConfirmationsTable } from "./production-execution";
import { bomRecipesTable } from "./bom";
import { inventoryItemsTable } from "./inventory";

// Phase 4 (Governance & Portal project) — Foundation linkage audit.
//
// These columns all store what are semantically Foundation master-data ids.
// Several of them used to be bare integers with no foreign key at all, so
// nothing stopped them pointing at a deleted or non-existent record. This
// test pins every link the audit established, so a future refactor can't
// quietly drop one and reintroduce the same class of bug.

/** Returns the names of the tables a given column has a foreign key to. */
function referencedTablesFor(table: any, columnName: string): string[] {
  const config = getTableConfig(table);
  return config.foreignKeys
    .filter((fk) => {
      const ref = fk.reference();
      return ref.columns.some((c: any) => c.name === columnName);
    })
    .map((fk) => getTableConfig(fk.reference().foreignTable).name);
}

describe("Foundation linkage (Phase 4 audit)", () => {
  const cases: Array<{
    label: string;
    table: any;
    column: string;
    expectedTarget: string;
  }> = [
    {
      label: "engineering_routings.work_center_id",
      table: engineeringRoutingsTable,
      column: "work_center_id",
      expectedTarget: "foundation_work_centers",
    },
    {
      label: "engineering_routings.machine_id",
      table: engineeringRoutingsTable,
      column: "machine_id",
      expectedTarget: "foundation_machines",
    },
    {
      label: "planning_capacity_loads.work_center_id",
      table: planningCapacityLoadsTable,
      column: "work_center_id",
      expectedTarget: "foundation_work_centers",
    },
    {
      label: "planning_capacity_loads.machine_id",
      table: planningCapacityLoadsTable,
      column: "machine_id",
      expectedTarget: "foundation_machines",
    },
    {
      label: "planning_capacity_loads.shift_id",
      table: planningCapacityLoadsTable,
      column: "shift_id",
      expectedTarget: "foundation_shifts",
    },
    {
      label: "production_operation_confirmations.machine_id",
      table: productionOperationConfirmationsTable,
      column: "machine_id",
      expectedTarget: "foundation_machines",
    },
    {
      label: "engineering_products.foundation_item_id",
      table: engineeringProductsTable,
      column: "foundation_item_id",
      expectedTarget: "foundation_items",
    },
    // Established in earlier phases — pinned here so the whole picture is
    // covered by one test.
    {
      label: "bom_recipes.foundation_item_id (Phase 1)",
      table: bomRecipesTable,
      column: "foundation_item_id",
      expectedTarget: "foundation_items",
    },
    {
      label: "inventory_items.foundation_item_id (migration 0021)",
      table: inventoryItemsTable,
      column: "foundation_item_id",
      expectedTarget: "foundation_items",
    },
  ];

  for (const { label, table, column, expectedTarget } of cases) {
    it(`${label} is linked to ${expectedTarget}`, () => {
      expect(referencedTablesFor(table, column)).toContain(expectedTarget);
    });
  }

  it("every Foundation link is nullable, so a legacy row is never blocked", () => {
    // The whole audit used additive, nullable links on purpose: unmatched
    // legacy rows must keep working rather than failing a deploy.
    const nullableChecks: Array<[string, any, string]> = [
      ["bom_recipes", bomRecipesTable, "foundation_item_id"],
      ["engineering_products", engineeringProductsTable, "foundation_item_id"],
      ["inventory_items", inventoryItemsTable, "foundation_item_id"],
      ["engineering_routings", engineeringRoutingsTable, "work_center_id"],
      ["planning_capacity_loads", planningCapacityLoadsTable, "shift_id"],
    ];
    for (const [tableName, table, columnName] of nullableChecks) {
      const column = getTableConfig(table).columns.find(
        (c) => c.name === columnName,
      );
      expect(column, `${tableName}.${columnName} should exist`).toBeDefined();
      expect(
        column!.notNull,
        `${tableName}.${columnName} must stay nullable`,
      ).toBe(false);
    }
  });
});
