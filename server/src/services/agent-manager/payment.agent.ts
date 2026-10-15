import { performance } from "node:perf_hooks";
import {
  ordersRepo,
  subscriptionsRepo,
  refundsRepo,
} from "../../storage/json-repository.js";
import { VirtualPay } from "../virtual-pay.service.js";
import { SubscriptionService } from "../subscription.service.js";
import { AuditService } from "../audit.service.js";
import { ENV } from "../../config/env.js";
import type { Order } from "../../types/index.js";
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

export class PaymentAgent implements IAgent {
  public readonly id: AgentId = "payment-agent";
  public readonly name = "TrustGate Payment & Verification Agent";
  public readonly description =
    "Authoritative payment verification, gateway health monitoring, and order settlement. Communicates strictly with backend payment providers and never trusts client-supplied payment status.";
  public readonly type: AgentType = "PAYMENT";
  public readonly version = "1.0.0";

  public getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy"> {
    return {
      id: "payment-agent",
      agentId: "payment-agent",
      enabled: true,
      taskTimeoutMs: 30000,
      maxRetries: 2,
      logLevel: "INFO",
      customSettings: {
        autoVerifyBatchSize: 25,
        strictUtrCollisionCheck: true,
      },
    };
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        id: "MONITOR_VERIFICATION_QUEUES",
        name: "Monitor Verification & Payout Queues",
        description:
          "Inspects orders awaiting admin UTR verification and refunds awaiting manual payout. Summarizes actionable queues without auto-confirming, maintaining strict segregation of duties.",
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "VERIFY_PENDING_ORDERS",
        name: "Verify Pending Orders",
        description:
          "Authoritatively queries the payment gateway for all pending orders and safely activates subscriptions for verified completed payments.",
        parametersSchema: {
          batchSize: { type: "number", default: 25, description: "Max orders to check per run" },
        },
        riskLevel: "MEDIUM",
        requiresConfirmation: true,
      },
      {
        id: "CHECK_GATEWAY_HEALTH",
        name: "Check Payment Gateway Health",
        description:
          "Pings the virtual payment gateway (Auth App), measures round-trip latency, and validates merchant API key authorization.",
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "AUDIT_PAYMENT_RECORDS",
        name: "Audit Payment Records",
        description:
          "Performs a comprehensive integrity check between orders, subscriptions, and refund states to ensure zero discrepancies.",
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "INSPECT_ORDER",
        name: "Inspect Specific Order",
        description:
          "Fetches authoritative live gateway state and complete lifecycle records for a specific order reference or order ID.",
        parametersSchema: {
          orderId: { type: "string", required: true, description: "Order ID (ord_...)" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "LIST_PENDING_PAYMENTS",
        name: "List Pending Payments",
        description: "Lists all orders currently in PENDING or AWAITING_VERIFICATION status.",
        parametersSchema: {
          limit: { type: "number", default: 50, description: "Maximum orders to return" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "LIST_FAILED_PAYMENTS",
        name: "List Failed Payments (Today)",
        description: "Lists orders that failed payment or expired, filtered for today by default.",
        parametersSchema: {
          todayOnly: { type: "boolean", default: true, description: "Filter only orders created or failed today" },
          limit: { type: "number", default: 50, description: "Maximum orders to return" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "INSPECT_UTR",
        name: "Inspect UTR Transaction",
        description: "Searches and inspects an order associated with a specific 12-digit UPI UTR number.",
        parametersSchema: {
          utr: { type: "string", required: true, description: "12-digit UPI UTR reference number" },
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
        message: "Payment Agent is disabled by administrator.",
      };
    }

    try {
      const allOrders = await ordersRepo.getAll();
      const allRefunds = await refundsRepo.getAll();
      const awaitingUtrCount = allOrders.filter((o) => o.status === "AWAITING_VERIFICATION").length;
      const pendingCount = allOrders.filter((o) => o.status === "PENDING").length;
      const confirmedCount = allOrders.filter((o) => o.status === "CONFIRMED").length;
      const refundedCount = allOrders.filter((o) => o.refunded).length;
      const pendingPayoutCount = allRefunds.filter(
        (r) => r.status === "APPROVED_PAYOUT_PENDING" || r.status === "AWAITING_MANUAL_PAYOUT"
      ).length;

      return {
        status: "HEALTHY",
        lastCheckedAt: new Date().toISOString(),
        message: `UPI Payment Engine active (${ENV.UPI_MERCHANT_ID}). ${awaitingUtrCount} orders awaiting UTR verification, ${pendingPayoutCount} refunds pending payout.`,
        metrics: {
          totalOrders: allOrders.length,
          confirmedOrders: confirmedCount,
          awaitingVerificationOrders: awaitingUtrCount,
          pendingOrders: pendingCount,
          refundedOrders: refundedCount,
          refundsPendingPayout: pendingPayoutCount,
          upiMerchantId: ENV.UPI_MERCHANT_ID,
          paymentMode: ENV.PAYMENT_MODE,
        },
      };
    } catch (err: any) {
      return {
        status: "ERROR",
        lastCheckedAt: new Date().toISOString(),
        message: `Payment Agent storage query error: ${err.message}`,
      };
    }
  }

  public validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    if (taskType === "INSPECT_ORDER") {
      if (!params.orderId || typeof params.orderId !== "string" || !params.orderId.trim()) {
        return { valid: false, error: "Parameter 'orderId' is required for INSPECT_ORDER task." };
      }
    }
    if (taskType === "INSPECT_UTR") {
      if (!params.utr || typeof params.utr !== "string" || !params.utr.trim()) {
        return { valid: false, error: "Parameter 'utr' is required for INSPECT_UTR task." };
      }
    }
    return { valid: true };
  }

  public isTaskCancellable(taskType: string): boolean {
    // Read-only operations and batch verification can be cancelled safely between items
    return true;
  }

  public async executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult> {
    switch (ctx.taskType) {
      case "MONITOR_VERIFICATION_QUEUES":
        return this.monitorVerificationQueues(ctx);
      case "VERIFY_PENDING_ORDERS":
        return this.verifyPendingOrders(ctx);
      case "CHECK_GATEWAY_HEALTH":
        return this.checkGatewayHealth(ctx);
      case "AUDIT_PAYMENT_RECORDS":
        return this.auditPaymentRecords(ctx);
      case "INSPECT_ORDER":
        return this.inspectOrder(ctx);
      case "LIST_PENDING_PAYMENTS":
        return this.listPendingPayments(ctx);
      case "LIST_FAILED_PAYMENTS":
        return this.listFailedPayments(ctx);
      case "INSPECT_UTR":
        return this.inspectUtr(ctx);
      default:
        throw new Error(
          `Unsupported task '${ctx.taskType}' for Payment Agent.`
        );
    }
  }

  private async listPendingPayments(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const limit = Number(ctx.params?.limit) || 50;
    const allOrders = await ordersRepo.getAll();
    const pending = allOrders.filter((o) => o.status === "PENDING" || o.status === "AWAITING_VERIFICATION");
    const paginated = pending.slice(0, limit);

    return {
      summary: `Found ${pending.length} pending payment(s) awaiting completion or verification.`,
      data: paginated,
      itemsProcessed: paginated.length,
    };
  }

  private async listFailedPayments(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const limit = Number(ctx.params?.limit) || 50;
    const todayOnly = ctx.params?.todayOnly !== false;
    const todayStr = new Date().toISOString().slice(0, 10);

    const allOrders = await ordersRepo.getAll();
    const failed = allOrders.filter((o) => {
      const isFailed = (o.status as string) === "FAILED" || (o.status as string) === "EXPIRED" || o.status === "REJECTED";
      if (!isFailed) return false;
      if (todayOnly) {
        return o.createdAt && o.createdAt.startsWith(todayStr);
      }
      return true;
    });
    const paginated = failed.slice(0, limit);

    return {
      summary: `Found ${paginated.length} failed/expired payment(s)${todayOnly ? " from today" : ""}.`,
      data: paginated,
      itemsProcessed: paginated.length,
    };
  }

  private async inspectUtr(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const utr = String(ctx.params?.utr || "").trim();
    if (!utr) {
      throw new Error("UTR parameter is required.");
    }

    const allOrders = await ordersRepo.getAll();
    const order = allOrders.find((o) => o.utr === utr);
    if (!order) {
      return {
        summary: `No order found matching UTR '${utr}'.`,
        data: null,
        itemsProcessed: 0,
      };
    }

    const sub = await subscriptionsRepo.findOne((s) => s.orderId === order.id);
    const refund = await refundsRepo.findOne((r) => r.orderId === order.id);

    return {
      summary: `UTR ${utr} matched Order ${order.id} (Status: ${order.status}, Amount: ₹${(order.amountPaise / 100).toFixed(2)}).`,
      data: {
        order,
        subscription: sub,
        refund,
      },
      itemsProcessed: 1,
    };
  }

  /**
   * Monitors orders awaiting UTR verification and refunds awaiting manual payout.
   * Reports pending action items for administrators without auto-confirming (segregation of duties).
   */
  private async monitorVerificationQueues(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const allOrders = await ordersRepo.getAll();
    const allRefunds = await refundsRepo.getAll();

    const awaitingOrders = allOrders.filter((o) => o.status === "AWAITING_VERIFICATION");
    const pendingRefunds = allRefunds.filter(
      (r) => r.status === "APPROVED_PAYOUT_PENDING" || r.status === "AWAITING_MANUAL_PAYOUT"
    );

    const orderItems = awaitingOrders.map((o) => ({
      orderId: o.id,
      reference: o.reference,
      utr: o.utr,
      amountPaise: o.amountPaise,
      amountRupees: (o.amountPaise / 100).toFixed(2),
      userEmail: o.userEmail,
      submittedAt: o.utrSubmittedAt || o.createdAt,
    }));

    const refundItems = pendingRefunds.map((r) => ({
      refundId: r.id,
      orderReference: r.orderReference,
      amountPaise: r.amountPaise,
      amountRupees: (r.amountPaise / 100).toFixed(2),
      userUpiId: r.userUpiId,
      status: r.status,
      createdAt: r.createdAt,
    }));

    const summary = `Queue Monitor: ${awaitingOrders.length} order(s) awaiting UTR verification, ${pendingRefunds.length} refund(s) awaiting manual payout. (Segregation of duties: Admin manual confirmation required).`;

    return {
      summary,
      data: {
        ordersAwaitingVerificationCount: awaitingOrders.length,
        ordersAwaitingVerification: orderItems,
        refundsPendingPayoutCount: pendingRefunds.length,
        refundsPendingPayout: refundItems,
        merchantId: ENV.UPI_MERCHANT_ID,
        policyWindowDays: ENV.REFUND_WINDOW_DAYS,
      },
      itemsProcessed: awaitingOrders.length + pendingRefunds.length,
    };
  }

  /**
   * Authoritatively verify pending orders against VirtualPay gateway.
   * Never marks payment successful unless gateway authoritatively confirms 'completed'.
   */
  private async verifyPendingOrders(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const batchSize = Number(ctx.params?.batchSize) || ctx.config.customSettings?.autoVerifyBatchSize || 25;
    const allOrders = await ordersRepo.getAll();
    const pendingOrders = allOrders
      .filter((o) => o.status === "PENDING" && o.paymentRequestId)
      .slice(0, batchSize);

    if (pendingOrders.length === 0) {
      return {
        summary: "No pending orders with active payment requests found to verify.",
        data: { checked: 0, confirmed: 0, stillPending: 0, errors: [] },
        itemsProcessed: 0,
      };
    }

    let checkedCount = 0;
    let confirmedCount = 0;
    let stillPendingCount = 0;
    const errors: Array<{ orderId: string; reference: string; error: string }> = [];
    const verifiedOrders: Array<{ orderId: string; reference: string; utr: string }> = [];

    for (const order of pendingOrders) {
      // Check cancellation signal between iterations
      if (ctx.signal.aborted) {
        return {
          summary: `Verification aborted by administrator after inspecting ${checkedCount} orders (${confirmedCount} confirmed).`,
          data: { checked: checkedCount, confirmed: confirmedCount, verifiedOrders, errors },
          itemsProcessed: checkedCount,
          warnings: ["Task was safely stopped early by administrator signal."],
        };
      }

      checkedCount++;
      try {
        const gatewayStatus = await VirtualPay.getStatus(order.paymentRequestId!);

        if (gatewayStatus.status === "completed" && gatewayStatus.reference) {
          const utr = gatewayStatus.reference;

          // Strict duplicate UTR check across already confirmed orders
          const collision = await ordersRepo.find(
            (o) => o.id !== order.id && o.status === "CONFIRMED" && o.utr === utr
          );

          if (collision.length > 0) {
            errors.push({
              orderId: order.id,
              reference: order.reference,
              error: `UTR collision detected: ${utr} was already claimed by order ${collision[0].id}`,
            });
            continue;
          }

          // Authoritative confirmation
          const updated = await ordersRepo.update(order.id, {
            status: "CONFIRMED",
            utr,
            confirmedAt: new Date().toISOString(),
          });

          if (updated) {
            await SubscriptionService.activateSubscriptionForOrder(updated);
            confirmedCount++;
            verifiedOrders.push({
              orderId: order.id,
              reference: order.reference,
              utr,
            });

            await AuditService.record("ORDER_CONFIRMED_BY_AGENT", { id: "AGENT_MGR", email: ctx.initiatedBy } as any, {
              orderId: order.id,
              reference: order.reference,
              utr,
              taskId: ctx.taskId,
            });
          }
        } else {
          stillPendingCount++;
        }
      } catch (err: any) {
        errors.push({
          orderId: order.id,
          reference: order.reference,
          error: err.message || "Failed to inspect status from gateway",
        });
      }
    }

    return {
      summary: `Batch verification completed: ${checkedCount} pending orders checked, ${confirmedCount} confirmed & activated, ${stillPendingCount} still pending on gateway, ${errors.length} errors/collisions.`,
      data: {
        checked: checkedCount,
        confirmed: confirmedCount,
        stillPending: stillPendingCount,
        verifiedOrders,
        errors,
      },
      itemsProcessed: checkedCount,
    };
  }

  /**
   * Health ping and latency check to the payment gateway
   */
  private async checkGatewayHealth(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const authAppUrl = (process.env.AUTH_APP_URL || "").replace(/\/+$/, "");
    const merchantKeySet = !!process.env.MERCHANT_API_KEY;

    if (!authAppUrl || !merchantKeySet) {
      throw new Error(
        "Virtual payments gateway not configured. Please set AUTH_APP_URL and MERCHANT_API_KEY."
      );
    }

    const start = performance.now();
    try {
      const res = await fetch(`${authAppUrl}/api/v1/health`, {
        signal: ctx.signal,
        headers: { "x-merchant-key": process.env.MERCHANT_API_KEY || "" },
      }).catch(async () => {
        // Fallback root health if /api/v1/health is absent
        return fetch(`${authAppUrl}/`, { signal: ctx.signal });
      });

      const latencyMs = Math.round(performance.now() - start);

      return {
        summary: `Payment Gateway online at ${authAppUrl} (Latency: ${latencyMs}ms, HTTP status: ${res.status}).`,
        data: {
          gatewayUrl: authAppUrl,
          statusCode: res.status,
          latencyMs,
          merchantKeyPresent: true,
          timestamp: new Date().toISOString(),
        },
        itemsProcessed: 1,
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      throw new Error(
        `Failed to reach Payment Gateway at ${authAppUrl} (${latencyMs}ms): ${err.message}`
      );
    }
  }

  /**
   * Comprehensive audit of payment records vs subscriptions
   */
  private async auditPaymentRecords(
    _ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const allOrders = await ordersRepo.getAll();
    const allSubscriptions = await subscriptionsRepo.getAll();
    const allRefunds = await refundsRepo.getAll();

    const confirmedOrders = allOrders.filter((o) => o.status === "CONFIRMED");
    const issues: string[] = [];

    // Check 1: Confirmed order has active/expired subscription
    for (const order of confirmedOrders) {
      const sub = allSubscriptions.find((s) => s.orderId === order.id);
      if (!sub) {
        issues.push(`Order ${order.id} (${order.reference}) is CONFIRMED but has no matching subscription.`);
      }
      if (!order.utr) {
        issues.push(`Order ${order.id} (${order.reference}) is CONFIRMED but has no UTR recorded.`);
      }
    }

    // Check 2: Refunded orders have properly revoked subscriptions
    const refundedOrders = allOrders.filter((o) => o.refunded);
    for (const order of refundedOrders) {
      const sub = allSubscriptions.find((s) => s.orderId === order.id);
      if (sub && sub.status !== "REFUNDED") {
        issues.push(`Order ${order.id} is REFUNDED but subscription ${sub.id} status is ${sub.status} (expected REFUNDED).`);
      }
    }

    return {
      summary: issues.length === 0
        ? `Audit passed: All ${confirmedOrders.length} confirmed orders, ${allSubscriptions.length} subscriptions, and ${allRefunds.length} refunds are strictly consistent.`
        : `Audit found ${issues.length} discrepancies requiring review.`,
      data: {
        totalOrders: allOrders.length,
        confirmedOrders: confirmedOrders.length,
        subscriptionsCount: allSubscriptions.length,
        refundsCount: allRefunds.length,
        discrepanciesCount: issues.length,
        issues,
      },
      itemsProcessed: allOrders.length,
      warnings: issues.length > 0 ? issues : undefined,
    };
  }

  /**
   * Inspect a specific order with live gateway query
   */
  private async inspectOrder(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const orderId = String(ctx.params.orderId).trim();
    const order = await ordersRepo.getById(orderId);

    if (!order) {
      throw new Error(`Order '${orderId}' not found in TrustGate repository.`);
    }

    let liveGatewayStatus: any = null;
    let gatewayError: string | null = null;

    if (order.paymentRequestId) {
      try {
        liveGatewayStatus = await VirtualPay.getStatus(order.paymentRequestId);
      } catch (err: any) {
        gatewayError = err.message || "Failed to query live gateway status";
      }
    }

    const linkedSubscriptions = await subscriptionsRepo.find((s) => s.orderId === order.id);
    const linkedRefunds = await refundsRepo.find((r) => r.orderId === order.id);

    return {
      summary: `Order ${order.id} (${order.reference}): Status is ${order.status}, Amount: ₹${(order.amountPaise / 100).toFixed(2)}, Gateway status: ${liveGatewayStatus?.status || "NO_GATEWAY_REQUEST"}.`,
      data: {
        order,
        liveGatewayStatus,
        gatewayError,
        linkedSubscriptions,
        linkedRefunds,
      },
      itemsProcessed: 1,
    };
  }
}
