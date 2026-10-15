import crypto from "node:crypto";
import { subscriptionsRepo, apiKeysRepo } from "../storage/json-repository.js";
import { PLANS, type Order, type Subscription, type ApiKey } from "../types/index.js";

export class SubscriptionService {
  /**
   * Activates subscription from a confirmed order and generates an API key.
   * Start = server time, Expiry = start + plan duration days.
   */
  static async activateSubscriptionForOrder(order: Order): Promise<{
    subscription: Subscription;
    apiKey: ApiKey;
    plaintextKey: string;
  }> {
    const plan = PLANS[order.planId];
    if (!plan) {
      throw new Error(`Invalid plan: ${order.planId}`);
    }

    const now = new Date();
    const startAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
    ).toISOString();

    // Expire any existing active subscriptions for this user
    const existingSubs = await subscriptionsRepo.find(
      (s) => s.userId === order.userId && s.status === "ACTIVE"
    );
    for (const sub of existingSubs) {
      await subscriptionsRepo.update(sub.id, { status: "EXPIRED" });
    }

    const subscriptionId = `sub_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const subscription: Subscription = {
      id: subscriptionId,
      userId: order.userId,
      planId: order.planId,
      orderId: order.id,
      startAt,
      expiresAt,
      status: "ACTIVE",
    };
    await subscriptionsRepo.create(subscription);

    // Generate API key: tg_live_<32 random bytes base64url>
    const randomBytes = crypto.randomBytes(32).toString("base64url");
    const plaintextKey = `tg_live_${randomBytes}`;
    const hash = crypto.createHash("sha256").update(plaintextKey).digest("hex");
    const prefix = plaintextKey.substring(0, 12);
    const last4 = plaintextKey.slice(-4);

    // Revoke previous active keys for this user
    const existingKeys = await apiKeysRepo.find(
      (k) => k.userId === order.userId && !k.revoked
    );
    for (const key of existingKeys) {
      await apiKeysRepo.update(key.id, { revoked: true });
    }

    const apiKeyId = `key_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const apiKey: ApiKey = {
      id: apiKeyId,
      userId: order.userId,
      subscriptionId,
      hash,
      prefix,
      last4,
      revoked: false,
      createdAt: startAt,
      oneTimePlaintextKey: plaintextKey,
    };
    await apiKeysRepo.create(apiKey);

    return { subscription, apiKey, plaintextKey };
  }
}
