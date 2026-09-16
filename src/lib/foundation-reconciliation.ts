/** @format */

export type FoundationIntegritySeverity = "blocker" | "warning";

export type FoundationIntegrityIssue = {
  code:
    | "inventory_missing_foundation_link"
    | "inventory_foundation_missing"
    | "inventory_foundation_code_mismatch"
    | "conversion_invalid"
    | "location_parent_missing"
    | "location_cycle"
    | "work_center_location_missing"
    | "machine_work_center_missing";
  severity: FoundationIntegritySeverity;
  entityType: string;
  entityId: number;
  message: string;
  details?: Record<string, unknown>;
};

export type FoundationInventoryAuditRow = {
  id: number;
  code: string | null;
  foundationItemId: number | null;
  foundationItemExists: boolean;
  foundationCode: string | null;
};

export type FoundationConversionAuditRow = {
  id: number;
  itemId: number;
  fromUnit: string;
  toUnit: string;
  factor: string;
};

export type FoundationLocationAuditRow = {
  id: number;
  parentId: number | null;
};

export type FoundationWorkCenterAuditRow = {
  id: number;
  locationId: number | null;
  locationExists: boolean;
};

export type FoundationMachineAuditRow = {
  id: number;
  workCenterId: number;
  workCenterExists: boolean;
};

export type FoundationIntegrityInput = {
  inventory: FoundationInventoryAuditRow[];
  conversions: FoundationConversionAuditRow[];
  locations: FoundationLocationAuditRow[];
  workCenters: FoundationWorkCenterAuditRow[];
  machines: FoundationMachineAuditRow[];
};

function issue(
  code: FoundationIntegrityIssue["code"],
  entityType: string,
  entityId: number,
  message: string,
  details?: Record<string, unknown>,
  severity: FoundationIntegritySeverity = "blocker",
): FoundationIntegrityIssue {
  return { code, severity, entityType, entityId, message, details };
}

function detectLocationCycles(
  locations: FoundationLocationAuditRow[],
): FoundationIntegrityIssue[] {
  const parentById = new Map(locations.map((location) => [location.id, location.parentId]));
  const issues: FoundationIntegrityIssue[] = [];

  for (const location of locations) {
    if (location.parentId !== null && !parentById.has(location.parentId)) {
      issues.push(
        issue(
          "location_parent_missing",
          "location",
          location.id,
          "الموقع مرتبط بأب غير موجود",
          { parentId: location.parentId },
        ),
      );
      continue;
    }

    const visited = new Set<number>();
    let cursor: number | null = location.id;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        issues.push(
          issue(
            "location_cycle",
            "location",
            location.id,
            "شجرة المواقع تحتوي على دورة",
            { cycleAt: cursor },
          ),
        );
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  return issues;
}

export function findFoundationIntegrityIssues(
  input: FoundationIntegrityInput,
): FoundationIntegrityIssue[] {
  const issues: FoundationIntegrityIssue[] = [];

  for (const row of input.inventory) {
    if (row.foundationItemId === null && row.code) {
      issues.push(
        issue(
          "inventory_missing_foundation_link",
          "inventory_item",
          row.id,
          "رصيد المخزون له كود دون ربط بتعريف Foundation",
          { code: row.code },
          "warning",
        ),
      );
    } else if (row.foundationItemId !== null && !row.foundationItemExists) {
      issues.push(
        issue(
          "inventory_foundation_missing",
          "inventory_item",
          row.id,
          "الرصيد يشير إلى تعريف Foundation غير موجود",
          { foundationItemId: row.foundationItemId },
        ),
      );
    } else if (
      row.foundationItemId !== null &&
      row.code !== null &&
      row.foundationCode !== null &&
      row.code !== row.foundationCode
    ) {
      issues.push(
        issue(
          "inventory_foundation_code_mismatch",
          "inventory_item",
          row.id,
          "كود المخزون لا يطابق كود تعريف Foundation المرتبط",
          { inventoryCode: row.code, foundationCode: row.foundationCode },
        ),
      );
    }
  }

  for (const row of input.conversions) {
    const factor = Number(row.factor);
    if (
      !Number.isFinite(factor) ||
      factor <= 0 ||
      row.fromUnit.trim() === row.toUnit.trim()
    ) {
      issues.push(
        issue(
          "conversion_invalid",
          "unit_conversion",
          row.id,
          "تحويل الوحدات يحتوي معاملًا غير صالح أو وحدتي قياس متطابقتين",
          {
            itemId: row.itemId,
            fromUnit: row.fromUnit,
            toUnit: row.toUnit,
            factor: row.factor,
          },
        ),
      );
    }
  }

  issues.push(...detectLocationCycles(input.locations));

  for (const row of input.workCenters) {
    if (row.locationId !== null && !row.locationExists) {
      issues.push(
        issue(
          "work_center_location_missing",
          "work_center",
          row.id,
          "مركز العمل مرتبط بموقع غير موجود",
          { locationId: row.locationId },
        ),
      );
    }
  }

  for (const row of input.machines) {
    if (!row.workCenterExists) {
      issues.push(
        issue(
          "machine_work_center_missing",
          "machine",
          row.id,
          "الماكينة مرتبطة بمركز عمل غير موجود",
          { workCenterId: row.workCenterId },
        ),
      );
    }
  }

  return issues;
}

export function summarizeFoundationIssues(issues: FoundationIntegrityIssue[]) {
  return {
    total: issues.length,
    blockers: issues.filter((item) => item.severity === "blocker").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
    byCode: issues.reduce<Record<string, number>>((counts, item) => {
      counts[item.code] = (counts[item.code] ?? 0) + 1;
      return counts;
    }, {}),
  };
}