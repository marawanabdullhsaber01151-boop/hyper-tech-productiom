/**
 * Vercel's Node.js runtime detects `server.mjs` and captures the HTTP server
 * created here. Keep the Express app itself framework-agnostic in src/index.ts.
 */
import { startServer } from "./dist/index.mjs";

startServer();
