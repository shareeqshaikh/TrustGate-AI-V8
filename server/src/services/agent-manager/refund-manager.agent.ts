import { refundsRepo, ordersRepo } from "../../storage/json-repository.js";
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

export class RefundManagerAgent implements IAgent {
  public readonly id: AgentId = "refund-agent";
  public readonly name = "TrustGate Refund Manager";
  public readonly description =
    "Read-only inspection and monitoring of refund requests, auto-refund evaluations, and payout queues. Strictly segregated: cannot approve refunds or mark them paid.";
  public readonly type: AgentType = "PAYMENT";
  public readonly version = "1.0.0";

  public getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy"> {
    return {
      id: "refund-agent",
      agentId: "refund-agent",
      enabled: true,
      taskTimeoutMs: 30000,
      maxRetries: 1,
      logLevel: "INFO",
      customSettings: {
        autoMonitorPendingRefunds: true,
      },
    };
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        id: "LIST_REFUNDS",
        name: "List Refund Claims (Read-Only)",
        description: "Lists refund requests with optional status filtering (PENDING, PAID, AUTO_REFUNDED, REJECTED).",
        parametersSchema: {
          status: { type: "string", description: "Filter by status: PENDING, PAID, AUTO_REFUNDED, REJECTED" },
          limit: { type: "number", default: 50, description: "Maximum records to return" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "INSPECT_REFUND",
        name: "Inspect Specific Refund",
        description: "Inspects full lifecycle, AI assessment notes, and order details for a specific refund claim.",
        parametersSchema: {
          refundId: { type: "string", description: "Refund ID (ref_...)" },
          orderId: { type: "string", description: "Associated Order ID (ord_...)" },
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
        message: "Refund Manager is disabled by administrator configuration.",
      };
    }
    const allRefunds = await refundsRepo.getAll();
    const pendingRefunds = allRefunds.filter(
      (r) =>
        r.status === "REQUESTED" ||
        r.status === "APPROVED_PAYOUT_PENDING" ||
        r.status === "AWAITING_MANUAL_PAYOUT" ||
        (r.status as string) === "PENDING"
    );

    return {
      status: "HEALTHY",
      lastCheckedAt: new Date().toISOString(),
      message: "Refund audit repository operational.",
      metrics: {
        totalRefunds: allRefunds.length,
        pendingReviewCount: pendingRefunds.length,
      },
    };
  }

  public validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    const forbidden = ["APPROVE", "PAY", "CONFIRM", "SETTLE", "MARK_PAID", "DISBURSE"];
    const upperType = taskType.toUpperCase();
    for (const term of forbidden) {
      if (upperType.includes(term)) {
        return {
          valid: false,
          error: "Refund Manager cannot approve refunds or mark them paid. Those stay in the existing deterministic flow.",
        };
      }
    }

    if (taskType === "INSPECT_REFUND") {
      if (!params.refundId && !params.orderId) {
        return { valid: false, error: "Either refundId or orderId is required for INSPECT_REFUND." };
      }
    }
    return { valid: true };
  }

  public isTaskCancellable(_taskType: string): boolean {
    return true;
  }

  public async executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult> {
    const { taskType, params } = ctx;

    // Strict invariant: cannot approve or mark paid
    const forbidden = ["APPROVE", "PAY", "CONFIRM", "SETTLE", "MARK_PAID", "DISBURSE"];
    const upperType = taskType.toUpperCase();
    for (const term of forbidden) {
      if (upperType.includes(term)) {
        throw new Error(
          "Refund Manager cannot approve refunds or mark them paid. Those stay in the existing deterministic flow."
        );
      }
    }

    if (taskType === "LIST_REFUNDS") {
      const allRefunds = await refundsRepo.getAll();
      let filtered = allRefunds;
      if (params.status) {
        filtered = filtered.filter((r) => r.status.toUpperCase() === String(params.status).toUpperCase());
      }
      const limit = Number(params.limit) || 50;
      const paginated = filtered.slice(0, limit);

      return {
        summary: `Retrieved ${paginated.length} refund record(s)${params.status ? ` with status ${params.status}` : ""}.`,
        data: paginated,
        itemsProcessed: paginated.length,
      };
    }

    if (taskType === "INSPECT_REFUND") {
      const allRefunds = await refundsRepo.getAll();
      let refund = params.refundId ? allRefunds.find((r) => r.id === params.refundId) : null;
      if (!refund && params.orderId) {
        refund = allRefunds.find((r) => r.orderId === params.orderId) || null;
      }
      if (!refund) {
        throw new Error(`Refund claim not found for query: ${JSON.stringify(params)}`);
      }

      const order = await ordersRepo.getById(refund.orderId);

      return {
        summary: `Refund ${refund.id} is in status ${refund.status} for order ${refund.orderId} (Amount: ₹${(refund.amountPaise / 100).toFixed(2)}).`,
        data: {
          refund,
          order,
        },
        itemsProcessed: 1,
      };
    }

    throw new Error(`Unsupported task type '${taskType}' for Refund Manager`);
  }
}
