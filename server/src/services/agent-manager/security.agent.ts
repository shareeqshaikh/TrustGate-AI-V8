import { auditRepo } from "../../storage/json-repository.js";
import { AuditService } from "../audit.service.js";
import { AgentManagerService } from "./agent-manager.service.js";
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

export class SecurityManagerAgent implements IAgent {
  public readonly id: AgentId = "security-agent";
  public readonly name = "TrustGate Security & Compliance Manager";
  public readonly description =
    "Centralized security governance: verifies cryptographic SHA-256 audit chains, monitors agent operational states, and triggers or resumes system-wide emergency stops.";
  public readonly type: AgentType = "SECURITY";
  public readonly version = "1.0.0";

  public getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy"> {
    return {
      id: "security-agent",
      agentId: "security-agent",
      enabled: true,
      taskTimeoutMs: 30000,
      maxRetries: 1,
      logLevel: "INFO",
      customSettings: {
        enforceStrictAuditVerification: true,
      },
    };
  }

  public getCapabilities(): AgentCapability[] {
    return [
      {
        id: "VIEW_AUDIT_LOG",
        name: "View Audit Log",
        description: "Retrieves recent cryptographically chained audit blocks.",
        parametersSchema: {
          limit: { type: "number", default: 20, description: "Max blocks to return" },
        },
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "VERIFY_AUDIT_CHAIN",
        name: "Verify Audit Chain Integrity",
        description: "Recalculates SHA-256 hashes across all audit chain blocks to verify tamper-proof historical integrity.",
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "LIST_AGENT_STATES",
        name: "List Agent Runtime States",
        description: "Inspects health, configuration, enabled flags, and active execution status for all registered agents.",
        riskLevel: "LOW",
        requiresConfirmation: false,
      },
      {
        id: "TRIGGER_EMERGENCY_STOP",
        name: "Trigger Emergency Stop",
        description: "Halts all running agent tasks and locks out new background task executions across the platform.",
        parametersSchema: {
          reason: { type: "string", required: true, description: "Reason for activating emergency stop" },
        },
        riskLevel: "HIGH",
        requiresConfirmation: true,
      },
      {
        id: "RESUME_EMERGENCY_STOP",
        name: "Resume Operations from Emergency Stop",
        description: "Lifts the emergency stop lockout and restores normal agent task dispatching.",
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
        message: "Security Manager is disabled by administrator configuration.",
      };
    }

    const stopState = await AgentManagerService.getEmergencyStopState();
    const verification = await AuditService.verifyChain();

    return {
      status: stopState.active ? "DEGRADED" : verification.valid ? "HEALTHY" : "ERROR",
      lastCheckedAt: new Date().toISOString(),
      message: stopState.active
        ? `Emergency stop currently active (${stopState.reason || "Administrative hold"}).`
        : verification.valid
        ? "Audit chain verified intact."
        : "Audit chain hash discrepancy detected!",
      metrics: {
        emergencyStopActive: stopState.active,
        chainBlocks: verification.blockCount,
        chainValid: verification.valid,
      },
    };
  }

  public validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string } {
    if (taskType === "TRIGGER_EMERGENCY_STOP") {
      if (!params.reason || String(params.reason).trim().length < 3) {
        return { valid: false, error: "A descriptive reason (min 3 chars) is required for TRIGGER_EMERGENCY_STOP." };
      }
    }
    return { valid: true };
  }

  public isTaskCancellable(taskType: string): boolean {
    return taskType !== "TRIGGER_EMERGENCY_STOP" && taskType !== "RESUME_EMERGENCY_STOP";
  }

  public async executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult> {
    const { taskType, params, initiatedBy } = ctx;

    if (taskType === "VIEW_AUDIT_LOG") {
      const allBlocks = await auditRepo.getAll();
      const limit = Number(params.limit) || 20;
      const recent = allBlocks.slice(-limit).reverse();

      return {
        summary: `Retrieved ${recent.length} recent audit block(s).`,
        data: recent,
        itemsProcessed: recent.length,
      };
    }

    if (taskType === "VERIFY_AUDIT_CHAIN") {
      const result = await AuditService.verifyChain();
      return {
        summary: result.valid
          ? `Audit chain verification SUCCESS: ${result.blockCount} block(s) cryptographically valid.`
          : `Audit chain verification FAILURE: Hash mismatch detected!`,
        data: result,
        itemsProcessed: result.blockCount,
      };
    }

    if (taskType === "LIST_AGENT_STATES") {
      const agents = await AgentManagerService.getAllAgentsMetadata();
      const summaryItems = agents.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        enabled: a.enabled,
        status: a.status,
        healthMessage: a.health.message,
      }));

      return {
        summary: `Retrieved runtime states for ${agents.length} agent(s).`,
        data: summaryItems,
        itemsProcessed: agents.length,
      };
    }

    if (taskType === "TRIGGER_EMERGENCY_STOP") {
      const reason = String(params.reason || "Triggered via Security Manager");
      const result = await AgentManagerService.triggerEmergencyStop(reason, {
        id: initiatedBy,
        email: initiatedBy,
      });

      return {
        summary: `EMERGENCY STOP ACTIVATED: Reason: "${reason}". Cancelled ${result.cancelledTasksCount} running task(s).`,
        data: result,
        itemsProcessed: 1,
      };
    }

    if (taskType === "RESUME_EMERGENCY_STOP") {
      const state = await AgentManagerService.resumeEmergencyStop({
        id: initiatedBy,
        email: initiatedBy,
      });

      return {
        summary: "Emergency stop resumed successfully. Agent operations restored.",
        data: state,
        itemsProcessed: 1,
      };
    }

    throw new Error(`Unsupported task type '${taskType}' for Security Manager`);
  }
}
