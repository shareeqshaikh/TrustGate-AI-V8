import crypto from "node:crypto";
import { apiKeysRepo, subscriptionsRepo, usersRepo } from "../../storage/json-repository.js";
import type {
  AgentCapability,
  AgentConfigRecord,
  AgentHealth,
  AgentId,
  AgentType,
} from "../../types/agent-manager.types.js";
import type {
  IAgent,
  AgentExecutionContext,
  AgentTaskExecutionResult,
} from "./agent.interface.js";

export class ApiKeyManagerAgent implements IAgent {
  public readonly id: AgentId = "api-key-agent";
  public readonly name = "TrustGate API Key Manager";
  public readonly description =
    "Security manager for developer API credentials. Authoritative revocation, rotation, and prefix/last4-only inspection. Cryptographic hashes and plaintext are never leaked.";
  public readonly type: AgentType = "SECURITY";
  public readonly version = "1.0.0";

  public getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy"> {
    return {
      id: "api-key-agent",
      agentId: "api-key-agent",
      enabled: true,
      taskTimeoutMs: 30000,
      maxRetries: 1,
      logLevel: "INFO",
      customSettings: {
        allowKeyRegeneration: true,
      },
    };
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        id: "LIST_KEYS",
        name: "List API Keys (Sanitized)",
        description: "Lists API keys with prefix, last4, status, and creation date. Never returns hashes or plaintext secrets.",
        parametersSchema: {
          userId: { type: "string", description: "Filter by user ID" },
          status: { type: "string", description: "Filter by status: ACTIVE or REVOKED" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "REVOKE_KEY",
        name: "Revoke API Key",
        description: "Immediately revokes an active API key, blocking any future authenticated merchant requests with that key.",
        parametersSchema: {
          keyId: { type: "string", required: true, description: "API key ID to revoke (key_...)" },
        },
        riskLevel: "HIGH",
        requiresConfirmation: true,
      },
      {
        id: "REGENERATE_KEY",
        name: "Regenerate API Key",
        description: "Generates a new API key for the user's active subscription, revokes previous keys, displays the plaintext key once, and immediately wipes plaintext from persistent storage.",
        parametersSchema: {
          userId: { type: "string", description: "User ID to regenerate key for" },
          keyId: { type: "string", description: "Existing Key ID to regenerate" },
        },
        riskLevel: "HIGH",
        requiresConfirmation: true,
      },
    ];
  }

  public async getHealth(config: AgentConfigRecord): Promise<AgentHealth> {
    if (!config.enabled) {
      return {
        status: "STOPPED",
        lastCheckedAt: new Date().toISOString(),
        message: "API Key Manager is currently disabled by administrator configuration.",
      };
    }
    const allKeys = await apiKeysRepo.getAll();
    const activeKeys = allKeys.filter((k) => !k.revoked);

    return {
      status: "HEALTHY",
      lastCheckedAt: new Date().toISOString(),
      message: "API Key Manager operational. Keys secured with SHA-256.",
      metrics: {
        totalKeys: allKeys.length,
        activeKeys: activeKeys.length,
        revokedKeys: allKeys.length - activeKeys.length,
      },
    };
  }

  public validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    if (taskType === "REVOKE_KEY") {
      if (!params.keyId) {
        return { valid: false, error: "keyId is required for REVOKE_KEY." };
      }
    }
    if (taskType === "REGENERATE_KEY") {
      if (!params.userId && !params.keyId) {
        return { valid: false, error: "Either userId or keyId is required for REGENERATE_KEY." };
      }
    }
    return { valid: true };
  }

  public isTaskCancellable(taskType: string): boolean {
    return taskType === "LIST_KEYS";
  }

  public async executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult> {
    const { taskType, params } = ctx;

    if (taskType === "LIST_KEYS") {
      const allKeys = await apiKeysRepo.getAll();
      let filtered = allKeys;

      if (params.userId) {
        filtered = filtered.filter((k) => k.userId === params.userId);
      }
      if (params.status) {
        const wantRevoked = String(params.status).toUpperCase() === "REVOKED";
        filtered = filtered.filter((k) => k.revoked === wantRevoked);
      }

      // CRITICAL: Strict sanitization - NEVER return hash or plaintextKey
      const sanitized = filtered.map((k) => ({
        id: k.id,
        userId: k.userId,
        prefix: k.prefix,
        last4: k.last4,
        revoked: k.revoked,
        status: k.revoked ? "REVOKED" : "ACTIVE",
        createdAt: k.createdAt,
      }));

      return {
        summary: `Retrieved ${sanitized.length} sanitized API key record(s). Plaintext keys and hashes are safely masked.`,
        data: sanitized,
        itemsProcessed: sanitized.length,
      };
    }

    if (taskType === "REVOKE_KEY") {
      const keyId = String(params.keyId);
      const existing = await apiKeysRepo.getById(keyId);
      if (!existing) {
        throw new Error(`API key '${keyId}' not found.`);
      }
      if (existing.revoked) {
        return {
          summary: `API key ${existing.prefix}...${existing.last4} was already revoked.`,
          data: { id: existing.id, prefix: existing.prefix, last4: existing.last4, revoked: true },
          itemsProcessed: 1,
        };
      }

      await apiKeysRepo.update(keyId, {
        revoked: true,
        oneTimePlaintextKey: undefined,
      });

      return {
        summary: `API key ${existing.prefix}...${existing.last4} revoked successfully.`,
        data: { id: existing.id, prefix: existing.prefix, last4: existing.last4, revoked: true },
        itemsProcessed: 1,
      };
    }

    if (taskType === "REGENERATE_KEY") {
      let targetUserId = params.userId ? String(params.userId) : null;

      if (!targetUserId && params.keyId) {
        const refKey = await apiKeysRepo.getById(String(params.keyId));
        if (refKey) {
          targetUserId = refKey.userId;
        }
      }

      if (!targetUserId) {
        throw new Error("Could not determine user for key regeneration.");
      }

      // Verify user has active, unexpired subscription
      const subscriptions = await subscriptionsRepo.find((s) => s.userId === targetUserId);
      const activeSub = subscriptions.find(
        (s) => s.status === "ACTIVE" && new Date(s.expiresAt) > new Date()
      );

      if (!activeSub) {
        throw new Error(`Cannot regenerate key: User '${targetUserId}' does not have an active, non-expired subscription.`);
      }

      // Revoke old keys
      const oldKeys = await apiKeysRepo.find((k) => k.userId === targetUserId && !k.revoked);
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

      const created = await apiKeysRepo.create({
        id: apiKeyId,
        userId: targetUserId,
        subscriptionId: activeSub.id,
        hash,
        prefix,
        last4,
        revoked: false,
        createdAt: now,
        oneTimePlaintextKey: undefined, // Immediately erase from persistent repository
      });

      return {
        summary: `New API key generated successfully for user ${targetUserId}: ${prefix}...${last4}. Plaintext key is displayed once below and immediately erased from database storage.`,
        data: {
          id: created.id,
          userId: targetUserId,
          prefix: created.prefix,
          last4: created.last4,
          plaintextKey, // Shown once in response
          warning: "Copy this key now. It is erased from persistent storage and cannot be viewed again.",
        },
        itemsProcessed: 1,
      };
    }

    throw new Error(`Unsupported task type '${taskType}' for API Key Manager`);
  }
}
