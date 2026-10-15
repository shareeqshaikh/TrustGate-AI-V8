import { z } from "zod";

export type AgentId = "payment-agent" | "email-agent" | string;

export type AgentStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "STOPPED"
  | "RUNNING_TASK"
  | "ERROR";

export type AgentType =
  | "PAYMENT"
  | "COMMUNICATION"
  | "SECURITY"
  | "AUTOMATION"
  | "CUSTOM";

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  parametersSchema?: Record<string, any>;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresConfirmation?: boolean;
}

export interface AgentConfigRecord {
  id: string; // matches agentId
  agentId: string;
  enabled: boolean;
  taskTimeoutMs: number;
  maxRetries: number;
  logLevel: "INFO" | "WARN" | "ERROR" | "DEBUG";
  customSettings: Record<string, any>;
  updatedAt: string;
  updatedBy: string;
}

export interface AgentHealth {
  status: AgentStatus;
  lastCheckedAt: string;
  message: string;
  metrics?: Record<string, any>;
}

export interface AgentExecutionTask {
  id: string;
  agentId: string;
  agentName: string;
  taskType: string;
  status: TaskStatus;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  initiatedBy: string; // admin user email or 'SYSTEM'
  params?: Record<string, any>;
  resultSummary?: string;
  resultData?: any;
  errorMessage?: string;
  cancellable: boolean;
}

export interface EmergencyStopRecord {
  id: string; // "active_emergency_stop"
  active: boolean;
  triggeredAt?: string;
  triggeredBy?: string;
  reason?: string;
  uncancellableOperations?: string[];
  resumedAt?: string;
  resumedBy?: string;
}

export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  version: string;
  enabled: boolean;
  status: AgentStatus;
  health: AgentHealth;
  capabilities: AgentCapability[];
  config: AgentConfigRecord;
  lastExecution?: AgentExecutionTask | null;
  statistics: {
    totalTasksRun: number;
    successCount: number;
    failureCount: number;
    lastRunAt?: string;
  };
}

export interface AgentOverviewStats {
  totalAgents: number;
  enabledAgents: number;
  disabledAgents: number;
  runningTasks: number;
  failedTasks: number;
  completedTasks: number;
  emergencyStop: {
    active: boolean;
    triggeredAt?: string;
    triggeredBy?: string;
    reason?: string;
  };
  aiProvider: {
    available: boolean;
    provider: string;
    model: string;
    details: string;
  };
  recentActivity: AgentExecutionTask[];
}

export const UpdateAgentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  taskTimeoutMs: z.number().int().min(1000).max(300000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  logLevel: z.enum(["INFO", "WARN", "ERROR", "DEBUG"]).optional(),
  customSettings: z.record(z.any()).optional(),
});

export const RunAgentTaskSchema = z.object({
  taskType: z.string().min(1),
  params: z.record(z.any()).optional().default({}),
});

export const EmergencyStopSchema = z.object({
  reason: z.string().min(3).max(500),
});
