/** @format */
/**
 * Phase 04 (delivery 1) — DB-aware side of engineering governance. Pure
 * rules live in ../domain/engineering-governance.ts; this file only does
 * queries and orchestrates them.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  engineeringBomComponentsTable,
  engineeringRoutingsTable,
  engineeringProductVersionsTable,
} from "../db/schema/engineering";
import { foundationItemsTable } from "../db/schema/foundation";
import {
  detectBomCycle,
  findDuplicateOperationNumbers,
  summarizeManufacturabilityIssues,
  validateBomComponentShape,
  validateRoutingStepShape,
  type ManufacturabilityIssue,
} from "../domain/engineering-governance";

// Loose structural transaction type, matching the same workaround already
// used in ../lib/production-lifecycle-transition.ts and
// ../lib/foundation-governance.ts, rather than `typeof db`.
type Executor = {
  select: (...args: any[]) => any;
  update: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  execute: (...args: any[]) => any;
};

export async function fetchBomComponentsWithItems(
  executor: Executor,
  productVersionId: number,
) {
  return executor
    .select({
      id: engineeringBomComponentsTable.id,
      lineNo: engineeringBomComponentsTable.lineNo,
      componentType: engineeringBomComponentsTable.componentType,
      foundationItemId: engineeringBomComponentsTable.foundationItemId,
      subAssemblyProductId: engineeringBomComponentsTable.subAssemblyProductId,
      qty: engineeringBomComponentsTable.qty,
      unit: engineeringBomComponentsTable.unit,
      scrapFactorPct: engineeringBomComponentsTable.scrapFactorPct,
      isAlternate: engineeringBomComponentsTable.isAlternate,
      alternateGroup: engineeringBomComponentsTable.alternateGroup,
      itemActive: foundationItemsTable.active,
      itemCode: foundationItemsTable.code,
      itemName: foundationItemsTable.name,
    })
    .from(engineeringBomComponentsTable)
    .leftJoin(
      foundationItemsTable,
      eq(engineeringBomComponentsTable.foundationItemId, foundationItemsTable.id),
    )
    .where(eq(engineeringBomComponentsTable.productVersionId, productVersionId))
    .orderBy(engineeringBomComponentsTable.lineNo);
}

export async function fetchRoutingSteps(
  executor: Executor,
  productVersionId: number,
) {
  return executor
    .select()
    .from(engineeringRoutingsTable)
    .where(eq(engineeringRoutingsTable.productVersionId, productVersionId))
    .orderBy(engineeringRoutingsTable.operationNo);
}

/**
 * All product -> sub-assembly edges across the whole catalog (every
 * version, not just released ones — deliberately conservative: a cycle
 * that could only occur through a draft version is still worth flagging
 * before that draft is ever approved). Bounded by nothing else in the
 * schema being large enough yet to need pagination; revisit if the
 * engineering catalog grows into the tens of thousands of components.
 */
async function fetchSubAssemblyEdges(executor: Executor) {
  const result = await executor.execute<{ from_product: number; to_product: number }>(sql`
    select distinct v.product_id as from_product, c.sub_assembly_product_id as to_product
    from engineering_bom_components c
    join engineering_product_versions v on v.id = c.product_version_id
    where c.sub_assembly_product_id is not null
  `);
  return result.rows.map((r: { from_product: number; to_product: number }) => ({
    from: r.from_product,
    to: r.to_product,
  }));
}

export type ManufacturabilityResult = {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  issues: ManufacturabilityIssue[];
};

/**
 * Runs every Phase 04 manufacturability check against the version's
 * *currently persisted* components and routing steps: BOM shape (source
 * ambiguity, quantity, unit, scrap factor), inactive materials, routing
 * shape (missing work center, negative time, worker count), duplicate
 * operation numbers, and a whole-catalog BOM-cycle check rooted at this
 * version's own product. Persists the result onto the version row so
 * "has this version been validated since its last edit?" is a plain
 * column read, not a recomputation, everywhere else that needs to know.
 */
export async function runManufacturabilityValidation(
  executor: Executor,
  productVersionId: number,
  productId: number,
): Promise<ManufacturabilityResult> {
  const [components, routingSteps, edges] = await Promise.all([
    fetchBomComponentsWithItems(executor, productVersionId),
    fetchRoutingSteps(executor, productVersionId),
    fetchSubAssemblyEdges(executor),
  ]);

  const issues: ManufacturabilityIssue[] = [];

  for (const component of components as any[]) {
    issues.push(
      ...validateBomComponentShape(
        {
          componentType: component.componentType,
          foundationItemId: component.foundationItemId,
          subAssemblyProductId: component.subAssemblyProductId,
          qty: Number(component.qty),
          unit: component.unit,
          scrapFactorPct: Number(component.scrapFactorPct ?? 0),
        },
        component.lineNo,
      ),
    );
    if (component.foundationItemId != null && component.itemActive === false) {
      issues.push({
        severity: "error",
        code: "INACTIVE_MATERIAL",
        message: `السطر ${component.lineNo}: الصنف "${component.itemCode ?? component.foundationItemId}" غير نشط`,
        context: { lineNo: component.lineNo, foundationItemId: component.foundationItemId },
      });
    }
  }

  if (components.length === 0) {
    issues.push({
      severity: "error",
      code: "EMPTY_BOM",
      message: "لا توجد مكوّنات في قائمة المواد لهذا الإصدار",
    });
  }

  for (const step of routingSteps as any[]) {
    issues.push(
      ...validateRoutingStepShape({
        operationNo: step.operationNo,
        workCenterId: step.workCenterId,
        setupMinutes: step.setupMinutes,
        runMinutesPerUnit: Number(step.runMinutesPerUnit),
        workersRequired: step.workersRequired,
      }),
    );
  }
  const duplicateOps = findDuplicateOperationNumbers(
    (routingSteps as any[]).map((s) => ({
      operationNo: s.operationNo,
      workCenterId: s.workCenterId,
      setupMinutes: s.setupMinutes,
      runMinutesPerUnit: Number(s.runMinutesPerUnit),
      workersRequired: s.workersRequired,
    })),
  );
  for (const opNo of duplicateOps) {
    issues.push({
      severity: "error",
      code: "DUPLICATE_OPERATION",
      message: `رقم العملية ${opNo} مكرر أكثر من مرة`,
      context: { operationNo: opNo },
    });
  }
  if (routingSteps.length === 0) {
    issues.push({
      severity: "warning",
      code: "EMPTY_ROUTING",
      message: "لا توجد عمليات تصنيع (routing) لهذا الإصدار",
    });
  }

  const cycle = detectBomCycle(edges, productId);
  if (cycle) {
    issues.push({
      severity: "error",
      code: "BOM_CYCLE",
      message: `تسلسل دائري في قائمة المواد: ${cycle.join(" → ")}`,
      context: { cycle },
    });
  }

  const summary = summarizeManufacturabilityIssues(issues);
  await executor
    .update(engineeringProductVersionsTable)
    .set({
      validationStatus: summary.passed ? "passed" : "failed",
      validatedAt: new Date(),
      validationIssues: issues,
    })
    .where(eq(engineeringProductVersionsTable.id, productVersionId));

  return { ...summary, issues };
}

/**
 * Real, computable change-impact for an engineering product: other
 * engineering product versions whose BOM consumes it as a sub-assembly.
 * Deliberately does NOT claim to list affected production orders —
 * production orders are driven by bom_recipes, not by this engineering
 * module (see the migration file's header comment and the Phase 04
 * delivery 1 report). Returning a fabricated production-order impact list
 * here would be worse than returning none.
 */
export async function findEngineeringChangeImpact(
  executor: Executor,
  productId: number,
) {
  const result = await executor.execute<{
    product_version_id: number;
    product_id: number;
    version: string;
    status: string;
  }>(sql`
    select distinct v.id as product_version_id, v.product_id, v.version, v.status
    from engineering_bom_components c
    join engineering_product_versions v on v.id = c.product_version_id
    where c.sub_assembly_product_id = ${productId}
    order by v.product_id, v.version
  `);
  return result.rows;
}

/**
 * Freezes the version's currently persisted components and routing steps
 * into the immutable bom_snapshot / routing_snapshot jsonb columns, and
 * marks the version released. Must run inside the same transaction as the
 * status-transition write so a released version's snapshot can never
 * disagree with what its status claims.
 */
export async function freezeVersionSnapshot(
  tx: Executor,
  productVersionId: number,
  releasedById: number | null,
) {
  const [components, routingSteps] = await Promise.all([
    fetchBomComponentsWithItems(tx, productVersionId),
    fetchRoutingSteps(tx, productVersionId),
  ]);
  const [updated] = await tx
    .update(engineeringProductVersionsTable)
    .set({
      status: "released",
      bomSnapshot: components,
      routingSnapshot: routingSteps,
      releasedBy: releasedById,
      releasedAt: new Date(),
    })
    .where(eq(engineeringProductVersionsTable.id, productVersionId))
    .returning();
  return updated;
}
