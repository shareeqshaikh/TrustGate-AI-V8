import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { apiKeysRepo, subscriptionsRepo, usersRepo } from "../storage/json-repository.js";

export const pingRouter = Router();

// GET /api/v1/ping - Protected endpoint requiring valid Bearer API key
pingRouter.get("/ping", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Authorization header missing or invalid. Format: 'Bearer tg_live_...'",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const rawKey = authHeader.substring(7).trim();
  if (!rawKey) {
    res.status(401).json({ error: "Empty API key provided", code: "UNAUTHORIZED" });
    return;
  }

  // 1. Calculate SHA-256 hash of provided key
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

  // 2. Query stored key by hash
  const apiKey = await apiKeysRepo.findOne((k) => k.hash === hash);
  if (!apiKey) {
    res.status(401).json({ error: "Invalid API key", code: "INVALID_KEY" });
    return;
  }

  // 3. Check if key is revoked
  if (apiKey.revoked) {
    res.status(401).json({
      error: "This API key has been revoked and cannot be used.",
      code: "KEY_REVOKED",
    });
    return;
  }

  // 4. Verify associated subscription
  const subscription = await subscriptionsRepo.getById(apiKey.subscriptionId);
  if (!subscription || subscription.status !== "ACTIVE") {
    res.status(401).json({
      error: "No active subscription associated with this API key.",
      code: "NO_ACTIVE_SUBSCRIPTION",
    });
    return;
  }

  // 5. Check subscription expiry using server clock
  const now = new Date();
  const expiresAt = new Date(subscription.expiresAt);
  if (now > expiresAt) {
    res.status(401).json({
      error: `Subscription expired on ${subscription.expiresAt}. Please renew plan to restore API access.`,
      code: "SUBSCRIPTION_EXPIRED",
    });
    return;
  }

  const user = await usersRepo.getById(apiKey.userId);

  // Success
  res.json({
    message: "pong",
    status: "authorized",
    userId: apiKey.userId,
    userName: user?.name,
    planId: subscription.planId,
    subscriptionExpiresAt: subscription.expiresAt,
    serverTime: now.toISOString(),
  });
});
