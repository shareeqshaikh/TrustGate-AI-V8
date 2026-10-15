import { z } from "zod";
import { EmailService } from "../email/email.service.js";
import { ReminderSchedulerService } from "../reminder-scheduler.service.js";
import { EmailAgentService } from "../email-agent.service.js";
import { emailLogsRepo } from "../../storage/json-repository.js";
import { ENV } from "../../config/env.js";
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

const TestEmailParamSchema = z.object({
  toEmail: z.string().email("Valid recipient email is required"),
  subject: z.string().min(1).max(150),
  heading: z.string().min(1).max(100),
  body: z.string().min(1).max(2000),
});

const GenerateDraftParamSchema = z.object({
  campaignType: z.enum(["PROMOTIONAL", "RENEWAL_REMINDER", "ANNOUNCEMENT", "CUSTOM"]).default("PROMOTIONAL"),
  goal: z.string().min(3).max(500),
  tone: z.enum(["PROFESSIONAL", "FRIENDLY", "URGENT", "PERSUASIVE"]).default("PROFESSIONAL"),
});

export class EmailAgent implements IAgent {
  public readonly id: AgentId = "email-agent";
  public readonly name = "TrustGate Email Automation & Delivery Agent";
  public readonly description =
    "Controls automated expiry reminders, email delivery provider health, and AI copywriting assistance. Strictly sanitizes inputs and hides sensitive provider credentials.";
  public readonly type: AgentType = "COMMUNICATION";
  public readonly version = "1.0.0";

  public getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy"> {
    return {
      id: "email-agent",
      agentId: "email-agent",
      enabled: true,
      taskTimeoutMs: 45000,
      maxRetries: 1,
      logLevel: "INFO",
      customSettings: {
        dryRun: ENV.EMAIL_DRY_RUN,
        reminderDaysBefore: ENV.REMINDER_DAYS_BEFORE || 7,
        provider: ENV.EMAIL_PROVIDER || "dryrun",
        enableBackgroundScheduler: true,
      },
    };
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        id: "TRIGGER_REMINDER_SCAN",
        name: "Run Expiry Reminder Scan",
        description:
          "Executes a scan for subscriptions expiring within the 7-day window and dispatches notification emails idempotently.",
        riskLevel: "MEDIUM",
        requiresConfirmation: true,
      },
      {
        id: "TEST_PROVIDER_HEALTH",
        name: "Test Email Provider Health",
        description:
          "Verifies active provider connection (Gmail OAuth, SMTP, Resend, or Dry-Run) without exposing secrets.",
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "SEND_TEST_EMAIL",
        name: "Send Single Test Email",
        description:
          "Sends a branded test message to verify deliverability and layout to a specific recipient address.",
        parametersSchema: {
          toEmail: { type: "string", required: true, description: "Recipient email" },
          subject: { type: "string", default: "[Test] TrustGate Delivery Test" },
          heading: { type: "string", default: "Email System Operational Test" },
          body: { type: "string", default: "This is a diagnostic message sent from TrustGate Agent Manager." },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "GENERATE_AI_DRAFT",
        name: "Generate Email Draft",
        description:
          "Generates a production email copy draft using Ollama AI with automatic deterministic fallback if offline.",
        parametersSchema: {
          campaignType: { type: "enum", options: ["PROMOTIONAL", "RENEWAL_REMINDER", "ANNOUNCEMENT", "CUSTOM"] },
          goal: { type: "string", required: true, description: "Main goal or announcement points" },
          tone: { type: "enum", options: ["PROFESSIONAL", "FRIENDLY", "URGENT", "PERSUASIVE"] },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "LIST_DELIVERY_LOGS",
        name: "List Delivery Logs",
        description: "Retrieves recent outgoing email delivery logs, status codes, and provider responses.",
        parametersSchema: {
          limit: { type: "number", default: 50, description: "Maximum logs to return" },
          status: { type: "string", description: "Filter by status: DELIVERED, FAILED, DRY_RUN" },
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
        message: "Email Agent is disabled by administrator.",
      };
    }

    try {
      const providerStatus = await EmailService.getProviderStatus();
      const logs = await emailLogsRepo.getAll();
      const deliveredCount = logs.filter((l) => l.status === "DELIVERED").length;
      const failedCount = logs.filter((l) => l.status === "FAILED").length;
      const dryRunCount = logs.filter((l) => l.status === "DRY_RUN").length;

      const isHealthy = providerStatus.configured;

      return {
        status: isHealthy ? "HEALTHY" : "DEGRADED",
        lastCheckedAt: new Date().toISOString(),
        message: `Provider: ${providerStatus.provider.toUpperCase()} (Dry-Run: ${providerStatus.dryRun ? "ON" : "OFF"}). ${providerStatus.details}`,
        metrics: {
          provider: providerStatus.provider,
          dryRun: providerStatus.dryRun,
          configured: providerStatus.configured,
          totalDeliveryLogs: logs.length,
          deliveredEmails: deliveredCount,
          failedEmails: failedCount,
          dryRunEmails: dryRunCount,
        },
      };
    } catch (err: any) {
      return {
        status: "ERROR",
        lastCheckedAt: new Date().toISOString(),
        message: `Failed to inspect email provider: ${err.message}`,
      };
    }
  }

  public validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    if (taskType === "SEND_TEST_EMAIL") {
      const parsed = TestEmailParamSchema.safeParse(params);
      if (!parsed.success) {
        return { valid: false, error: parsed.error.errors[0]?.message };
      }
    }
    if (taskType === "GENERATE_AI_DRAFT") {
      const parsed = GenerateDraftParamSchema.safeParse(params);
      if (!parsed.success) {
        return { valid: false, error: parsed.error.errors[0]?.message };
      }
    }
    return { valid: true };
  }

  public isTaskCancellable(taskType: string): boolean {
    // Single email send cannot be recalled once sent, but reminder scan and draft generation can be cancelled
    return taskType !== "SEND_TEST_EMAIL";
  }

  public async executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult> {
    switch (ctx.taskType) {
      case "TRIGGER_REMINDER_SCAN":
        return this.runReminderScan(ctx);
      case "TEST_PROVIDER_HEALTH":
        return this.testProviderHealth(ctx);
      case "SEND_TEST_EMAIL":
        return this.sendTestEmail(ctx);
      case "GENERATE_AI_DRAFT":
        return this.generateDraft(ctx);
      case "LIST_DELIVERY_LOGS":
        return this.listDeliveryLogs(ctx);
      default:
        throw new Error(
          `Unsupported task '${ctx.taskType}' for Email Agent.`
        );
    }
  }

  private async listDeliveryLogs(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const limit = Number(ctx.params?.limit) || 50;
    const allLogs = await emailLogsRepo.getAll();
    let filtered = allLogs;
    if (ctx.params?.status) {
      filtered = filtered.filter((l) => l.status === String(ctx.params.status).toUpperCase());
    }
    const recent = filtered.slice(-limit).reverse();

    return {
      summary: `Retrieved ${recent.length} email delivery log(s).`,
      data: recent,
      itemsProcessed: recent.length,
    };
  }

  private async runReminderScan(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    if (ctx.signal.aborted) {
      return {
        summary: "Task aborted prior to scan execution.",
        itemsProcessed: 0,
        warnings: ["Cancelled by administrator."],
      };
    }

    const stats = await ReminderSchedulerService.runReminderScan(true);

    return {
      summary: `Reminder scan completed: ${stats.scanned} subscriptions analyzed, ${stats.reminded} reminders dispatched, ${stats.skipped} skipped (renewed/already sent), ${stats.errors} errors.`,
      data: stats,
      itemsProcessed: stats.scanned,
      warnings: stats.errors > 0 ? [`${stats.errors} reminder emails encountered delivery errors.`] : undefined,
    };
  }

  private async testProviderHealth(
    _ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const status = await EmailService.getProviderStatus();

    // Never leak passwords, OAuth tokens or private keys
    return {
      summary: `Email Provider '${status.provider.toUpperCase()}': ${status.details}`,
      data: {
        provider: status.provider,
        dryRun: status.dryRun,
        configured: status.configured,
        details: status.details,
        timestamp: new Date().toISOString(),
      },
      itemsProcessed: 1,
    };
  }

  private async sendTestEmail(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const { toEmail, subject, heading, body } = TestEmailParamSchema.parse(ctx.params);

    const html = EmailService.renderBrandedHtml({
      heading,
      body,
      callToActionText: "Open TrustGate Dashboard",
      callToActionUrl: ENV.FRONTEND_URL || "http://localhost:5173",
      isTransactional: true,
    });

    const provider = EmailService.getActiveProvider();
    const result = await provider.sendEmail({
      to: toEmail,
      subject: `[TEST] ${subject}`,
      html,
      idempotencyKey: `agent_test_${ctx.taskId}`,
    });

    if (!result.success && !result.dryRun) {
      throw new Error(`Email provider error: ${result.errorMessage || "Unknown dispatch failure"}`);
    }

    return {
      summary: result.dryRun
        ? `Dry-run test email simulated for ${toEmail}. Preview captured in delivery logs.`
        : `Live test email successfully delivered to ${toEmail} via ${provider.name}.`,
      data: {
        recipient: toEmail,
        provider: provider.id,
        dryRun: !!result.dryRun,
        messageId: result.messageId,
        previewText: result.preview?.text,
      },
      itemsProcessed: 1,
    };
  }

  private async generateDraft(
    ctx: AgentExecutionContext
  ): Promise<AgentTaskExecutionResult> {
    const { campaignType, goal, tone } = GenerateDraftParamSchema.parse(ctx.params);

    const draft = await EmailAgentService.generateDraft({
      campaignType,
      goal,
      tone,
    });

    return {
      summary: `Email draft generated for '${campaignType}' campaign (Subject: "${draft.subject}").`,
      data: draft,
      itemsProcessed: 1,
    };
  }
}
