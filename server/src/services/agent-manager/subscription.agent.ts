import { subscriptionsRepo, usersRepo, ordersRepo } from "../../storage/json-repository.js";
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

export class SubscriptionManagerAgent implements IAgent {
  public readonly id: AgentId = "subscription-agent";
  public readonly name = "TrustGate Subscription Manager";
  public readonly description =
    "Authoritative read-only inspection of user subscription lifecycles, active plans, expiration windows, and renewal statuses.";
  public readonly type: AgentType = "AUTOMATION";
  public readonly version = "1.0.0";

  public getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy"> {
    return {
      id: "subscription-agent",
      agentId: "subscription-agent",
      enabled: true,
      taskTimeoutMs: 30000,
      maxRetries: 1,
      logLevel: "INFO",
      customSettings: {
        defaultExpiryWindowDays: 7,
      },
    };
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        id: "LIST_SUBSCRIPTIONS",
        name: "List Subscriptions",
        description: "Lists active and past subscriptions with optional status and pagination filters.",
        parametersSchema: {
          status: { type: "string", description: "Filter by status: ACTIVE, EXPIRED, CANCELLED" },
          limit: { type: "number", default: 50, description: "Maximum records to return" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "INSPECT_SUBSCRIPTION",
        name: "Inspect Specific Subscription",
        description: "Retrieves complete lifecycle and owner information for a specific subscription or user.",
        parametersSchema: {
          subscriptionId: { type: "string", description: "Subscription ID (sub_...)" },
          userId: { type: "string", description: "User ID to inspect" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "LIST_EXPIRING",
        name: "List Expiring Subscriptions",
        description: "Lists active subscriptions expiring within the designated threshold window (default 7 days).",
        parametersSchema: {
          days: { type: "number", default: 7, description: "Days window from now" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
    ];
  }

  public async getHealth(config: AgentConfigRecord): Promise<AgentHealth> {
    if (!config.enabled) {
      return {
        status: "STOPPED",
        lastCheckedAt: new Date().toISOString(),
        message: "Subscription Manager is currently disabled by administrator configuration.",
      };
    }
    const allSubs = await subscriptionsRepo.getAll();
    const activeSubs = allSubs.filter((s) => s.status === "ACTIVE" && new Date(s.expiresAt) > new Date());

    return {
      status: "HEALTHY",
      lastCheckedAt: new Date().toISOString(),
      message: "Subscription repository operational.",
      metrics: {
        totalSubscriptions: allSubs.length,
        activeSubscriptions: activeSubs.length,
      },
    };
  }

  public validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    if (taskType === "INSPECT_SUBSCRIPTION") {
      if (!params.subscriptionId && !params.userId) {
        return { valid: false, error: "Either subscriptionId or userId is required for INSPECT_SUBSCRIPTION." };
      }
    }
    return { valid: true };
  }

  public isTaskCancellable(_taskType: string): boolean {
    return true;
  }

  public async executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult> {
    const { taskType, params } = ctx;

    if (taskType === "LIST_SUBSCRIPTIONS") {
      const allSubs = await subscriptionsRepo.getAll();
      let filtered = allSubs;
      if (params.status) {
        filtered = filtered.filter((s) => s.status.toUpperCase() === String(params.status).toUpperCase());
      }
      const limit = Number(params.limit) || 50;
      const paginated = filtered.slice(0, limit);

      return {
        summary: `Retrieved ${paginated.length} subscription(s)${params.status ? ` with status ${params.status}` : ""}.`,
        data: paginated,
        itemsProcessed: paginated.length,
      };
    }

    if (taskType === "INSPECT_SUBSCRIPTION") {
      const allSubs = await subscriptionsRepo.getAll();
      let sub = params.subscriptionId ? allSubs.find((s) => s.id === params.subscriptionId) : null;
      if (!sub && params.userId) {
        sub = allSubs.find((s) => s.userId === params.userId && s.status === "ACTIVE") || allSubs.find((s) => s.userId === params.userId);
      }
      if (!sub) {
        throw new Error(`Subscription not found for query: ${JSON.stringify(params)}`);
      }

      const user = await usersRepo.getById(sub.userId);
      const orders = await ordersRepo.find((o) => o.id === sub.orderId || o.userId === sub.userId);

      return {
        summary: `Subscription ${sub.id} is ${sub.status}. Plan: ${sub.planId}, expires: ${sub.expiresAt}.`,
        data: {
          subscription: sub,
          user: user ? { id: user.id, email: user.email, name: user.name } : null,
          orders,
        },
        itemsProcessed: 1,
      };
    }

    if (taskType === "LIST_EXPIRING") {
      const days = Number(params.days) || 7;
      const now = new Date();
      const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const allSubs = await subscriptionsRepo.getAll();
      const expiring = allSubs.filter((s) => {
        if (s.status !== "ACTIVE") return false;
        const exp = new Date(s.expiresAt);
        return exp > now && exp <= windowEnd;
      });

      return {
        summary: `Found ${expiring.length} active subscription(s) expiring within ${days} days.`,
        data: expiring,
        itemsProcessed: expiring.length,
      };
    }

    throw new Error(`Unsupported task type '${taskType}' for Subscription Manager`);
  }
}
