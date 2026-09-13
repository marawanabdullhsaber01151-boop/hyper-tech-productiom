/** @format */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  createChangeRequestSchema,
  createEngineeringProductSchema,
  createProductVersionSchema,
  createRoutingSchema,
  engineeringChangeRequestsTable,
  engineeringProductsTable,
  engineeringProductVersionsTable,
  engineeringRoutingsTable,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseIdParam } from "../lib/validate";

const router = Router();
const engineeringRoles = [
  "chairman",
  "production_manager",
  "production_controller",
  "production_quality_controller",
];

router.get("/engineering/products", requireAuth, requireRole(...engineeringRoles), async (_req, res, next) => {
  try {
    res.json({ data: await db.select().from(engineeringProductsTable).orderBy(ascProductName()) });
  } catch (err) {
    next(err);
  }
});

function ascProductName() {
  return engineeringProductsTable.name;
}

router.post("/engineering/products", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const data = createEngineeringProductSchema.parse(req.body);
    const [product] = await db.insert(engineeringProductsTable).values({
      ...data,
      createdBy: req.user?.userId,
    }).returning();
    res.status(201).json({ data: product });
  } catch (err) {
    next(err);
  }
});

router.get("/engineering/products/:id", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [product] = await db.select().from(engineeringProductsTable).where(eq(engineeringProductsTable.id, id)).limit(1);
    if (!product) {
      res.status(404).json({ error: { message: "المنتج الهندسي غير موجود" } });
      return;
    }
    const versions = await db.select().from(engineeringProductVersionsTable)
      .where(eq(engineeringProductVersionsTable.productId, id))
      .orderBy(desc(engineeringProductVersionsTable.createdAt));
    res.json({ data: { ...product, versions } });
  } catch (err) {
    next(err);
  }
});

router.post("/engineering/products/:id/versions", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const productId = parseIdParam(req.params.id, res);
    if (productId === null) return;
    const data = createProductVersionSchema.parse(req.body);
    const [version] = await db.insert(engineeringProductVersionsTable).values({
      ...data,
      productId,
      createdBy: req.user?.userId,
    }).returning();
    res.status(201).json({ data: version });
  } catch (err) {
    next(err);
  }
});

router.post("/engineering/bom-versions/:id/approve", requireAuth, requireRole("chairman", "production_manager", "production_quality_controller"), async (req, res, next) => {
  try {
    const id = parseIdParam(req.params.id, res);
    if (id === null) return;
    const [version] = await db.update(engineeringProductVersionsTable).set({
      status: "approved",
      approvedBy: req.user?.userId,
      approvedAt: new Date(),
    }).where(eq(engineeringProductVersionsTable.id, id)).returning();
    if (!version) {
      res.status(404).json({ error: { message: "إصدار المنتج غير موجود" } });
      return;
    }
    res.json({ data: version });
  } catch (err) {
    next(err);
  }
});

router.post("/engineering/routings/:versionId/operations", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const productVersionId = parseIdParam(req.params.versionId, res);
    if (productVersionId === null) return;
    const data = createRoutingSchema.parse(req.body);
    const [operation] = await db.insert(engineeringRoutingsTable).values({
      ...data,
      productVersionId,
      runMinutesPerUnit: String(data.runMinutesPerUnit),
    }).returning();
    res.status(201).json({ data: operation });
  } catch (err) {
    next(err);
  }
});

router.get("/engineering/change-requests", requireAuth, requireRole(...engineeringRoles), async (_req, res, next) => {
  try {
    res.json({ data: await db.select().from(engineeringChangeRequestsTable).orderBy(desc(engineeringChangeRequestsTable.createdAt)) });
  } catch (err) {
    next(err);
  }
});

router.post("/engineering/change-requests", requireAuth, requireRole(...engineeringRoles), async (req, res, next) => {
  try {
    const data = createChangeRequestSchema.parse(req.body);
    const [changeRequest] = await db.insert(engineeringChangeRequestsTable).values({
      ...data,
      requestNumber: `ECR-${Date.now()}`,
      requestedBy: req.user?.userId,
    }).returning();
    res.status(201).json({ data: changeRequest });
  } catch (err) {
    next(err);
  }
});

export default router;
