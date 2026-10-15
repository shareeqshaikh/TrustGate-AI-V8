import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import {
  usersRepo,
  ordersRepo,
  subscriptionsRepo,
  apiKeysRepo,
} from "../storage/json-repository.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const accountRouter = Router();

// GET /api/v1/account - Retrieve user profile, active subscription, orders, and key metadata
accountRouter.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  // 1. Fetch user orders
  const orders = await ordersRepo.find((o) => o.userId === user.id);

  // 2. Fetch current subscription
  const subscriptions = await subscriptionsRepo.find((s) => s.userId === user.id);
  const activeSub = subscriptions.find(
    (s) => s.status === "ACTIVE" && new Date(s.expiresAt) > new Date()
  ) || null;

  // 3. Fetch API keys
  const keys = await apiKeysRepo.find((k) => k.userId === user.id);
  const latestKey = keys.length > 0 ? keys[keys.length - 1] : null;

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
    subscription: activeSub,
    orders: orders.reverse(),
    apiKey: latestKey
      ? {
          id: latestKey.id,
          prefix: latestKey.prefix,
          last4: latestKey.last4,
          revoked: latestKey.revoked,
          createdAt: latestKey.createdAt,
          hasOneTimeReveal: !!latestKey.oneTimePlaintextKey,
        }
      : null,
  });
});

// GET /api/v1/account/reveal-key/:id - One-time reveal endpoint (deletes plaintext after first read)
accountRouter.get(
  "/reveal-key/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const key = await apiKeysRepo.getById(req.params.id);
    if (!key || key.userId !== req.user!.id) {
      res.status(404).json({ error: "API key not found" });
      return;
    }

    if (!key.oneTimePlaintextKey) {
      res.status(410).json({
        error:
          "This API key has already been revealed and is no longer available in plaintext. Only the SHA-256 hash is stored on the server.",
        code: "KEY_ALREADY_REVEALED",
      });
      return;
    }

    const plaintext = key.oneTimePlaintextKey;

    // Immediately delete the plaintext key from the server repository
    await apiKeysRepo.update(key.id, {
      oneTimePlaintextKey: undefined,
    });

    res.json({
      keyId: key.id,
      plaintextKey: plaintext,
      message:
        "Please copy this key now. It will never be displayed again and has been removed from server storage.",
    });
  }
);

// POST /api/v1/account/revoke-key/:id - Revoke API key
accountRouter.post(
  "/revoke-key/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const key = await apiKeysRepo.getById(req.params.id);
    if (!key || key.userId !== req.user!.id) {
      res.status(404).json({ error: "API key not found" });
      return;
    }

    await apiKeysRepo.update(key.id, {
      revoked: true,
      oneTimePlaintextKey: undefined,
    });

    res.json({ message: "API key revoked successfully." });
  }
);

// POST /api/v1/account/regenerate-key - Regenerate API key for active subscription
accountRouter.post(
  "/regenerate-key",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;

    // Find active, unexpired subscription
    const subscriptions = await subscriptionsRepo.find((s) => s.userId === user.id);
    const activeSub = subscriptions.find(
      (s) => s.status === "ACTIVE" && new Date(s.expiresAt) > new Date()
    );

    if (!activeSub) {
      res.status(400).json({
        error: "Cannot regenerate key without an active, non-expired subscription.",
      });
      return;
    }

    // Revoke previous keys
    const oldKeys = await apiKeysRepo.find((k) => k.userId === user.id && !k.revoked);
    for (const oldKey of oldKeys) {
      await apiKeysRepo.update(oldKey.id, { revoked: true, oneTimePlaintextKey: undefined });
    }

    // Generate new key
    const randomBytes = crypto.randomBytes(32).toString("base64url");
    const plaintextKey = `tg_live_${randomBytes}`;
    const hash = crypto.createHash("sha256").update(plaintextKey).digest("hex");
    const prefix = plaintextKey.substring(0, 12);
    const last4 = plaintextKey.slice(-4);
    const now = new Date().toISOString();

    const apiKeyId = `key_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const newKey = await apiKeysRepo.create({
      id: apiKeyId,
      userId: user.id,
      subscriptionId: activeSub.id,
      hash,
      prefix,
      last4,
      revoked: false,
      createdAt: now,
      oneTimePlaintextKey: plaintextKey,
    });

    res.json({
      message: "New API key generated successfully.",
      apiKey: {
        id: newKey.id,
        prefix: newKey.prefix,
        last4: newKey.last4,
        plaintextKey,
      },
    });
  }
);
