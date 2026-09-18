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
import inventoryRouter from "./routes/inventory";
import contactsRouter from "./routes/contacts";
import salesRouter from "./routes/sales";
import bomRouter from "./routes/bom";
import qualityRouter from "./routes/quality";
import movementsRouter from "./routes/movements";
import settingsRouter from "./routes/settings";
import stateRouter from "./routes/state";
import notificationsRouter from "./routes/notifications";
import productionRequestsRouter from "./routes/production-requests";
import portalRouter from "./routes/portal";
import portalOrdersRouter from "./routes/portal-orders";
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
import healthRouter from "./routes/health";

import { errorHandler, notFound } from "./middleware/errorHandler";
import { apiRateLimiter } from "./middleware/rateLimiter";
import { requestLogger } from "./middleware/requestLogger";
import { requestContext } from "./middleware/requestContext";
import { mutationAudit } from "./middleware/mutationAudit";
import { logger } from "./lib/logger";
import { apiEnvelope } from "./middleware/apiEnvelope";
import { validatePortalPublicUrl } from "./lib/portalConfig";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

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
apiRouter.use(settingsRouter);
apiRouter.use(foundationRouter);
apiRouter.use(stateRouter);
apiRouter.use(productionRequestsRouter);
apiRouter.use(notificationsRouter);
apiRouter.use(portalRouter);
apiRouter.use(portalOrdersRouter);
apiRouter.use(priceInquiriesRouter);
apiRouter.use(portalCustomersAdminRouter);
apiRouter.use(governanceRouter);
apiRouter.use(operationsRouter);
apiRouter.use(operationsControlRouter);
apiRouter.use(operationsManagerRouter);
apiRouter.use(navRouter);

app.use("/api/v1", apiRouter);
app.use("/api/v1", notFound);

const frontendPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

app.use("/api", express.static(frontendPath));
app.use(express.static(frontendPath));
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
