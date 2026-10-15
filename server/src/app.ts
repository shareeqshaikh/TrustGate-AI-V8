import "./config/env.js";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieSession from "cookie-session";
import { authMiddleware } from "./middleware/auth.middleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { orderRouter } from "./routes/order.routes.js";
import { accountRouter } from "./routes/account.routes.js";
import { pingRouter } from "./routes/ping.routes.js";
import { refundRouter } from "./routes/refund.routes.js";
import { emailCampaignRouter } from "./routes/email-campaign.routes.js";
import { unsubscribeRouter } from "./routes/unsubscribe.routes.js";
import { gmailOAuthRouter } from "./routes/gmail-oauth.routes.js";
import { agentManagerRouter } from "./routes/agent-manager.routes.js";

export const app = express();

// Trust proxy for local development and containers
app.set("trust proxy", 1);

// JSON body parsing
app.use(express.json());

// CORS configuration supporting session credentials
app.use(
  cors({
    origin: (_origin, callback) => callback(null, true),
    credentials: true,
  })
);

// Cookie session configuration
app.use(
  cookieSession({
    name: "trustgate_session",
    keys: [process.env.SESSION_SECRET || "trustgate_lite_secret_key_v1"],
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
    secure: false, // http in local dev
  })
);

// Attach authenticated user to req.user
app.use(authMiddleware);

// Health check endpoint
app.get("/api/v1/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    service: "TrustGate Lite Gateway",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Mount Lite API routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1", orderRouter);
app.use("/api/v1/account", accountRouter);
app.use("/api/v1/refunds", refundRouter);
app.use("/api/v1/admin/refunds", refundRouter);
app.use("/api/v1/admin/email", emailCampaignRouter);
app.use("/api/v1/admin/agents", agentManagerRouter);
app.use("/api/v1/unsubscribe", unsubscribeRouter);
app.use("/api/email", gmailOAuthRouter);
app.use("/api/v1", pingRouter);

// Centralized error handling
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Central Error Handler]:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    code: err.code || "SERVER_ERROR",
  });
});
