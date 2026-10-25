/** @format */

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import foundationRouter from "./routes/foundation";

import productionWorkflowRoutes from "./routes/production-workflow";
import productionLifecycleRoutes from "./routes/production-lifecycle";
import authRouter from "./routes/auth";
import dashboardRouter from "./routes/dashboard";
import accessRouter from "./routes/access";
import inventoryRouter from "./routes/inventory";
import contactsRouter from "./routes/contacts";
import salesRouter from "./routes/sales";
import bomRouter from "./routes/bom";
import qualityRouter from "./routes/quality";
import movementsRouter from "./routes/movements";
import purchasesRouter from "./routes/purchases";
import settingsRouter from "./routes/settings";
import stateRouter from "./routes/state";
import notificationsRouter from "./routes/notifications";
import productionRequestsRouter from "./routes/production-requests";
import portalRouter from "./routes/portal";
import portalOrdersRouter from "./routes/portal-orders";
import portalTeamRouter from "./routes/portal-team";
import portalJoinRouter from "./routes/portal-join";
import portalRecoveryRouter from "./routes/portal-recovery";
import portalCompaniesAdminRouter from "./routes/portal-companies-admin";
import portalCompaniesListRouter from "./routes/portal-companies-list";
import portalApplicationsAdminRouter from "./routes/portal-applications-admin";
import portalActivationAdminRouter from "./routes/portal-activation-admin";
import portalOrdersAdminRouter from "./routes/portal-orders-admin";
import priceInquiriesRouter from "./routes/price-inquiries";
import portalCustomersAdminRouter from "./routes/portal-customers-admin";
import governanceRouter from "./routes/governance";
import operationsRouter from "./routes/operations";
import operationsControlRouter from "./routes/operations-control";
import operationsManagerRouter from "./routes/operations-manager";
import productionCycleRouter from "./routes/production-cycle";
import engineeringRouter from "./routes/engineering";
import productionExecutionRouter from "./routes/production-execution";
import planningRouter from "./routes/planning";
import navRouter from "./routes/nav";
import portalChatRouter from "./routes/portal-chat";
import chatStaffRouter from "./routes/chat-staff";
import { LEGACY_CONTACTS_PATH, LEGACY_HOME_PATHS, LEGACY_INVENTORY_PATH, LEGACY_MATERIAL_PATH, LEGACY_MOVEMENTS_PATH, MATERIAL_REDIRECT_TARGET, LEGACY_PORTAL_PATHS, LEGACY_SALES_PATH, STAFF_HOME_PATH, chatStaffRedirectTarget, portalRedirectTarget, salesRedirectTarget, inventoryRedirectTarget, contactsRedirectTarget } from "./lib/legacyRedirects";
import healthRouter from "./routes/health";

import { errorHandler, notFound } from "./middleware/errorHandler";
import { apiRateLimiter } from "./middleware/rateLimiter";
import { requestLogger } from "./middleware/requestLogger";
import { requestContext } from "./middleware/requestContext";
import { mutationAudit } from "./middleware/mutationAudit";
import { logger } from "./lib/logger";
import { apiEnvelope } from "./middleware/apiEnvelope";
import { validatePortalPublicUrl } from "./lib/portalConfig";
import { resolveTrustProxy } from "./lib/trustProxy";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// خلف بروكسي Vercel: من غير الإعداد ده req.ip بيبقى عنوان البروكسي فكل المستخدمين بيتشاركوا
// نفس عدّاد الـrate-limit وسجل التدقيق بيسجّل IP غلط. التفاصيل في lib/trustProxy.ts.
app.set("trust proxy", resolveTrustProxy(process.env));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
        ],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginEmbedderPolicy: false,
  }),
);

const corsOrigin =
  process.env.CORS_ORIGIN ?
    process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : process.env.NODE_ENV === "production" ? []
  : true;

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Correlation-Id",
      "Idempotency-Key",
      "If-Match-Version",
    ],
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);
app.use(apiEnvelope);
app.use(requestLogger);
app.use(mutationAudit);

app.get("/api/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

const apiRouter = express.Router();
apiRouter.use(apiRateLimiter);
apiRouter.use(healthRouter);
apiRouter.use(productionLifecycleRoutes);
apiRouter.use(productionWorkflowRoutes);
apiRouter.use(productionCycleRouter);
apiRouter.use(engineeringRouter);
apiRouter.use(productionExecutionRouter);
apiRouter.use(planningRouter);
apiRouter.use(authRouter);
apiRouter.use(dashboardRouter);
apiRouter.use(accessRouter);
apiRouter.use(inventoryRouter);
apiRouter.use(contactsRouter);
apiRouter.use(salesRouter);
// The legacy /production-orders route is intentionally not mounted.
// production_workflow_orders is the single production source of truth.
// Keep src/routes/production.ts and its schema only until the data migration
// and external-caller audit are complete; do not re-register this router.
apiRouter.use(bomRouter);
apiRouter.use(qualityRouter);
apiRouter.use(movementsRouter);
apiRouter.use(purchasesRouter);
apiRouter.use(settingsRouter);
apiRouter.use(foundationRouter);
apiRouter.use(stateRouter);
apiRouter.use(productionRequestsRouter);
apiRouter.use(notificationsRouter);
apiRouter.use(portalRecoveryRouter);
apiRouter.use(portalRouter);
apiRouter.use(portalJoinRouter);
apiRouter.use(portalTeamRouter);
apiRouter.use(portalCompaniesListRouter);
apiRouter.use(portalCompaniesAdminRouter);
apiRouter.use(portalApplicationsAdminRouter);
apiRouter.use(portalActivationAdminRouter);
apiRouter.use(portalOrdersAdminRouter);
apiRouter.use(portalOrdersRouter);
apiRouter.use(priceInquiriesRouter);
apiRouter.use(portalCustomersAdminRouter);
apiRouter.use(governanceRouter);
apiRouter.use(operationsRouter);
apiRouter.use(operationsControlRouter);
apiRouter.use(operationsManagerRouter);
apiRouter.use(navRouter);
apiRouter.use(portalChatRouter);
apiRouter.use(chatStaffRouter);

app.use("/api/v1", apiRouter);
app.use("/api/v1", notFound);

const frontendPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

/** الواجهة الجديدة (/v2): الملفات اللي ليها hash بتتخزّن سنة، والـ HTML عمره ما يتخزّن. */
const v2StaticOptions = {
  setHeaders(res: express.Response, filePath: string) {
    if (filePath.includes(`${path.sep}v2${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
};
app.get(LEGACY_HOME_PATHS, (_req, res) => res.redirect(302, STAFF_HOME_PATH));
app.get(LEGACY_SALES_PATH, (req, res) => res.redirect(302, salesRedirectTarget(req.originalUrl.split("?")[1] ?? "")));
app.get(LEGACY_INVENTORY_PATH, (req, res) => res.redirect(302, inventoryRedirectTarget(req.originalUrl.split("?")[1] ?? "")));
app.get(LEGACY_CONTACTS_PATH, (req, res) => res.redirect(302, contactsRedirectTarget(req.originalUrl.split("?")[1] ?? "")));
app.get(LEGACY_MATERIAL_PATH, (_req, res) => res.redirect(302, MATERIAL_REDIRECT_TARGET));
app.get(LEGACY_MOVEMENTS_PATH, (req, res) => res.redirect(302, inventoryRedirectTarget(req.originalUrl.split("?")[1] ?? "", true)));
app.get("/chat-staff.html", (req, res) => res.redirect(302, chatStaffRedirectTarget(req.query.c)));
app.get(LEGACY_PORTAL_PATHS, (req, res) => {
  const target = portalRedirectTarget(req.path, req.originalUrl.split("?")[1] ?? "");
  if (target) res.redirect(302, target);
  else res.status(404).end();
});
app.use("/v2", express.static(path.join(frontendPath, "v2"), v2StaticOptions));
app.use("/api", express.static(frontendPath));
app.use(express.static(frontendPath));
app.get(/^\/v2\/(?!assets\/).*/, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(frontendPath, "v2", "index.html"), (err) => (err ? next() : undefined));
});
app.get("/*splat", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"), (err) => {
    if (err) {
      res.status(200).json({
        message: "Hyper-Tech ERP API is running",
        apiBase: "/api/v1",
      });
    }
  });
});

app.use(errorHandler);

export function startServer(port = PORT) {
  validatePortalPublicUrl(process.env.PORTAL_PUBLIC_URL, process.env.NODE_ENV);
  return app.listen(port, "0.0.0.0", () => {
    logger.info("Hyper-Tech ERP started", {
      port: PORT,
      env: process.env.NODE_ENV || "development",
    });

    if (process.env.NODE_ENV !== "production") {
      console.log("   [DEV] Login: POST /api/v1/auth/login");
      console.log(
        '   [DEV] { "username": "admin", "password": "Admin@123" }\n',
      );
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startServer();
}

export default app;
