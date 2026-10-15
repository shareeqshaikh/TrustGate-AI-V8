import { z } from "zod";
import { OllamaAgentsService } from "../ollama-agents.service.js";

export interface ParsedCommandStep {
  agentId: string;
  operation: string;
  params: Record<string, any>;
  requiresConfirmation: boolean;
  description: string;
}

export const WhitelistedOperations = [
  // Manager / Global operations
  "TOGGLE_AGENT",
  "EMERGENCY_STOP",
  "RESUME_EMERGENCY_STOP",
  // Payment Agent operations
  "MONITOR_VERIFICATION_QUEUES",
  "VERIFY_PENDING_ORDERS",
  "CHECK_GATEWAY_HEALTH",
  "AUDIT_PAYMENT_RECORDS",
  "INSPECT_ORDER",
  "LIST_PENDING_PAYMENTS",
  "LIST_FAILED_PAYMENTS",
  "INSPECT_UTR",
  // Email Agent operations
  "TRIGGER_REMINDER_SCAN",
  "TEST_PROVIDER_HEALTH",
  "SEND_TEST_EMAIL",
  "GENERATE_AI_DRAFT",
  "LIST_DELIVERY_LOGS",
  // Subscription Agent operations
  "LIST_SUBSCRIPTIONS",
  "INSPECT_SUBSCRIPTION",
  "LIST_EXPIRING",
  // API Key Agent operations
  "LIST_KEYS",
  "REVOKE_KEY",
  "REGENERATE_KEY",
  // Refund Agent operations
  "LIST_REFUNDS",
  "INSPECT_REFUND",
  // Security Agent operations
  "VIEW_AUDIT_LOG",
  "VERIFY_AUDIT_CHAIN",
  "LIST_AGENT_STATES",
  "TRIGGER_EMERGENCY_STOP",
] as const;

export const WhitelistedAgents = [
  "manager",
  "payment-agent",
  "email-agent",
  "subscription-agent",
  "api-key-agent",
  "refund-agent",
  "security-agent",
] as const;

export const ParsedStepSchema = z.object({
  agentId: z.enum(WhitelistedAgents),
  operation: z.enum(WhitelistedOperations),
  params: z.record(z.any()).default({}),
  requiresConfirmation: z.boolean().default(false),
  description: z.string().min(1),
});

export const ParsedStepsArraySchema = z.array(ParsedStepSchema).min(1);

export class CommandParserService {
  /**
   * Main entry point to parse natural language administrative commands.
   * Deterministic keyword/rule parser is always authoritative and works completely offline.
   * If Ollama is reachable, it can assist with classification, but output is strictly
   * validated by Zod against the allowed operations whitelist.
   */
  public static async parseCommand(rawText: string): Promise<ParsedCommandStep[]> {
    const text = String(rawText || "").trim();
    if (!text) {
      throw new Error("Command text is required.");
    }

    // 1. Security Check: Reject shell injection, arbitrary code, URLs, or raw SQL
    this.assertSecuritySafe(text);

    // 2. Reject attempts to breach segregation of duties
    this.assertNoForbiddenActions(text);

    // 3. Try Ollama assistant if online (non-blocking, fast timeout)
    let aiParsedSteps: ParsedCommandStep[] | null = null;
    try {
      const health = await OllamaAgentsService.checkHealth();
      if (health.available) {
        aiParsedSteps = await this.tryOllamaClassification(text);
      }
    } catch {
      // Offline fallback: never fail when Ollama is unreachable
      aiParsedSteps = null;
    }

    if (aiParsedSteps && aiParsedSteps.length > 0) {
      return aiParsedSteps;
    }

    // 4. Deterministic Rule & Keyword Parser (Offline & authoritative)
    return this.parseRuleBased(text);
  }

  /**
   * Enforce strict security guards: No shell, arbitrary code, URLs, or raw SQL
   */
  private static assertSecuritySafe(text: string): void {
    const dangerousPatterns = [
      /(\bcurl\b|\bwget\b|\bexec\b|\bspawn\b|\beval\b)/i,
      /(rm\s+-rf|DROP\s+TABLE|SELECT\s+.*FROM|INSERT\s+INTO|UPDATE\s+.*SET|DELETE\s+FROM)/i,
      /(<script|javascript:|bash\b|cmd\.exe|powershell)/i,
      /(\bhttps?:\/\/)/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(text)) {
        throw new Error(
          "SECURITY_VIOLATION: Command contains forbidden shell, script, URL, or raw SQL execution patterns. Only registered agent operations are permitted."
        );
      }
    }
  }

  /**
   * Architectural Invariant: AI/manager can NEVER confirm payments, mark refunds paid,
   * change roles, or grant permissions.
   */
  private static assertNoForbiddenActions(text: string): void {
    const lower = text.toLowerCase();
    const forbiddenPhrases = [
      "confirm payment",
      "mark paid",
      "mark refund paid",
      "approve refund",
      "change role",
      "make admin",
      "grant admin",
      "grant permission",
    ];

    for (const phrase of forbiddenPhrases) {
      if (lower.includes(phrase)) {
        throw new Error(
          `FORBIDDEN_OPERATION: The Agent Manager cannot perform '${phrase}'. Payments, refund payouts, and role modifications remain strictly in deterministic backend flows.`
        );
      }
    }
  }

  /**
   * Deterministic rule-based parser that breaks multi-clause sentences into discrete steps
   */
  public static parseRuleBased(text: string): ParsedCommandStep[] {
    // Split on clauses: "and", "then", ";", or newlines
    const clauses = text
      .split(/\s+(?:and\s+then|and|then)\s+|[;\n]+/i)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (clauses.length === 0) {
      throw new Error(`Could not parse any actionable steps from command: "${text}"`);
    }

    const steps: ParsedCommandStep[] = [];

    for (const clause of clauses) {
      const step = this.matchSingleClause(clause);
      if (!step) {
        throw new Error(
          `Unknown or unsupported operation: "${clause}". No matching registered agent operation found.`
        );
      }
      steps.push(step);
    }

    return steps;
  }

  private static matchSingleClause(clause: string): ParsedCommandStep | null {
    const lower = clause.toLowerCase();

    // 1. Toggle Agent (Disable / Enable)
    const isDisable = /(disable|turn\s*off|stop|deactivate)\s+(?:the\s+)?([a-z0-9_-]+)/i.test(clause);
    const isEnable = /(enable|turn\s*on|start|activate)\s+(?:the\s+)?([a-z0-9_-]+)/i.test(clause);

    if (isDisable || isEnable) {
      const targetEnabled = !isDisable;
      const agentId = this.extractAgentId(lower);
      if (agentId && agentId !== "manager") {
        return {
          agentId: "manager",
          operation: "TOGGLE_AGENT",
          params: { agentId, enabled: targetEnabled },
          requiresConfirmation: !targetEnabled, // Disabling is destructive -> requires confirmation
          description: `${targetEnabled ? "Enable" : "Disable"} ${agentId}`,
        };
      }
    }

    // 2. Emergency Stop & Resume
    if (lower.includes("emergency stop") || lower.includes("halt all") || lower.includes("halt operations")) {
      const reasonMatch = clause.match(/emergency\s+stop(?:\s+(?:for|because|due\s+to|reason:?)\s+(.*))?/i);
      const reason = reasonMatch?.[1]?.trim() || "Administrative command box trigger";
      return {
        agentId: "security-agent",
        operation: "TRIGGER_EMERGENCY_STOP",
        params: { reason },
        requiresConfirmation: true,
        description: `Activate Emergency Stop: "${reason}"`,
      };
    }

    if (lower.includes("resume emergency") || lower.includes("resume operations") || lower.includes("clear emergency")) {
      return {
        agentId: "security-agent",
        operation: "RESUME_EMERGENCY_STOP",
        params: {},
        requiresConfirmation: true,
        description: "Resume operations from Emergency Stop",
      };
    }

    // 3. Payment Agent
    if (lower.includes("failed payment") || lower.includes("failed order")) {
      const todayOnly = lower.includes("today");
      return {
        agentId: "payment-agent",
        operation: "LIST_FAILED_PAYMENTS",
        params: { todayOnly },
        requiresConfirmation: false,
        description: `List failed payments${todayOnly ? " from today" : ""}`,
      };
    }

    if (lower.includes("pending payment") || lower.includes("pending order") || lower.includes("awaiting verification")) {
      return {
        agentId: "payment-agent",
        operation: "LIST_PENDING_PAYMENTS",
        params: {},
        requiresConfirmation: false,
        description: "List pending payments awaiting completion/verification",
      };
    }

    if (lower.includes("utr")) {
      const utrMatch = clause.match(/\b\d{6,16}\b/);
      if (utrMatch) {
        return {
          agentId: "payment-agent",
          operation: "INSPECT_UTR",
          params: { utr: utrMatch[0] },
          requiresConfirmation: false,
          description: `Inspect UTR transaction ${utrMatch[0]}`,
        };
      }
    }

    if (lower.includes("gateway health") || lower.includes("ping gateway")) {
      return {
        agentId: "payment-agent",
        operation: "CHECK_GATEWAY_HEALTH",
        params: {},
        requiresConfirmation: false,
        description: "Check payment gateway health",
      };
    }

    if (lower.includes("verify pending orders") || lower.includes("verify orders")) {
      return {
        agentId: "payment-agent",
        operation: "VERIFY_PENDING_ORDERS",
        params: { batchSize: 25 },
        requiresConfirmation: true,
        description: "Authoritatively verify pending orders against payment gateway",
      };
    }

    if (lower.includes("verification queue") || lower.includes("monitor queue")) {
      return {
        agentId: "payment-agent",
        operation: "MONITOR_VERIFICATION_QUEUES",
        params: {},
        requiresConfirmation: false,
        description: "Monitor verification and payout queues",
      };
    }

    // 4. API Key Agent
    if (lower.includes("api key") || lower.includes("api keys") || lower.includes("keys")) {
      if (lower.includes("revoke")) {
        const keyMatch = clause.match(/(?:key_\w+|key\s+([a-z0-9_-]+))/i);
        const keyId = keyMatch ? keyMatch[0].replace(/^key\s+/i, "") : "";
        return {
          agentId: "api-key-agent",
          operation: "REVOKE_KEY",
          params: { keyId },
          requiresConfirmation: true,
          description: `Revoke API key ${keyId || "(unspecified)"}`,
        };
      }
      if (lower.includes("regenerate") || lower.includes("rotate")) {
        const userMatch = clause.match(/(?:user_\w+|user\s+([a-z0-9_-]+))/i);
        const userId = userMatch ? userMatch[0].replace(/^user\s+/i, "") : "";
        return {
          agentId: "api-key-agent",
          operation: "REGENERATE_KEY",
          params: { userId },
          requiresConfirmation: true,
          description: `Regenerate API key${userId ? ` for user ${userId}` : ""}`,
        };
      }
      return {
        agentId: "api-key-agent",
        operation: "LIST_KEYS",
        params: {},
        requiresConfirmation: false,
        description: "List sanitized API keys (hashes/plaintext masked)",
      };
    }

    // 5. Subscription Agent
    if (lower.includes("expiring subscription") || lower.includes("expiring") || lower.includes("subscriptions expiring")) {
      const daysMatch = clause.match(/(\d+)\s*days?/i);
      const days = daysMatch ? Number(daysMatch[1]) : 7;
      return {
        agentId: "subscription-agent",
        operation: "LIST_EXPIRING",
        params: { days },
        requiresConfirmation: false,
        description: `List subscriptions expiring within ${days} days`,
      };
    }

    if (lower.includes("subscription") || lower.includes("subscriptions")) {
      return {
        agentId: "subscription-agent",
        operation: "LIST_SUBSCRIPTIONS",
        params: {},
        requiresConfirmation: false,
        description: "List all subscriptions",
      };
    }

    // 6. Refund Agent
    if (lower.includes("refund") || lower.includes("refunds")) {
      return {
        agentId: "refund-agent",
        operation: "LIST_REFUNDS",
        params: {},
        requiresConfirmation: false,
        description: "List refund requests (read-only audit)",
      };
    }

    // 7. Security Agent
    if (lower.includes("audit chain") || lower.includes("verify chain")) {
      return {
        agentId: "security-agent",
        operation: "VERIFY_AUDIT_CHAIN",
        params: {},
        requiresConfirmation: false,
        description: "Verify cryptographic SHA-256 audit chain integrity",
      };
    }

    if (lower.includes("audit log") || lower.includes("audit records") || lower.includes("view audit")) {
      return {
        agentId: "security-agent",
        operation: "VIEW_AUDIT_LOG",
        params: { limit: 20 },
        requiresConfirmation: false,
        description: "View recent audit chain log blocks",
      };
    }

    if (lower.includes("agent state") || lower.includes("agent status") || lower.includes("list agents")) {
      return {
        agentId: "security-agent",
        operation: "LIST_AGENT_STATES",
        params: {},
        requiresConfirmation: false,
        description: "List runtime status and configurations for all agents",
      };
    }

    // 8. Email Agent
    if (lower.includes("delivery log") || lower.includes("email logs") || lower.includes("delivery history")) {
      return {
        agentId: "email-agent",
        operation: "LIST_DELIVERY_LOGS",
        params: { limit: 50 },
        requiresConfirmation: false,
        description: "List outgoing email delivery logs",
      };
    }

    if (lower.includes("email health") || lower.includes("provider health") || lower.includes("email status")) {
      return {
        agentId: "email-agent",
        operation: "TEST_PROVIDER_HEALTH",
        params: {},
        requiresConfirmation: false,
        description: "Test email provider health and connection",
      };
    }

    if (lower.includes("reminder scan") || lower.includes("run reminders") || lower.includes("send reminders")) {
      return {
        agentId: "email-agent",
        operation: "TRIGGER_REMINDER_SCAN",
        params: {},
        requiresConfirmation: true,
        description: "Run automated expiry reminder email scan",
      };
    }

    return null;
  }

  private static extractAgentId(lower: string): string | null {
    if (lower.includes("email")) return "email-agent";
    if (lower.includes("payment")) return "payment-agent";
    if (lower.includes("subscription")) return "subscription-agent";
    if (lower.includes("api key") || lower.includes("key")) return "api-key-agent";
    if (lower.includes("refund")) return "refund-agent";
    if (lower.includes("security")) return "security-agent";
    return null;
  }

  /**
   * Optional Ollama helper: strictly validated by Zod against the allowed whitelist.
   */
  private static async tryOllamaClassification(text: string): Promise<ParsedCommandStep[] | null> {
    const host = OllamaAgentsService.getOllamaHost();
    const model = OllamaAgentsService.getRefundModel();

    const systemPrompt = `You are an administrative intent parser for TrustGate AI Agent Manager.
Return ONLY a valid JSON array of objects with the structure:
[
  {
    "agentId": "manager" | "payment-agent" | "email-agent" | "subscription-agent" | "api-key-agent" | "refund-agent" | "security-agent",
    "operation": "ONE_OF_WHITELISTED_OPS",
    "params": {},
    "requiresConfirmation": boolean,
    "description": "Short description"
  }
]
Allowed operations: ${WhitelistedOperations.join(", ")}.
Destructive operations (TOGGLE_AGENT with enabled:false, REVOKE_KEY, REGENERATE_KEY, EMERGENCY_STOP, VERIFY_PENDING_ORDERS, TRIGGER_REMINDER_SCAN) MUST have requiresConfirmation: true.
Do NOT include any code or explanations. Output ONLY valid JSON.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);

    try {
      const res = await fetch(`${host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: `User command: "${text}"`,
          system: systemPrompt,
          stream: false,
          format: "json",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) return null;

      const data = (await res.json()) as any;
      const rawJson = JSON.parse(data.response || "[]");
      const validated = ParsedStepsArraySchema.safeParse(rawJson);
      if (validated.success) {
        return validated.data as ParsedCommandStep[];
      }
      return null;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }
}
