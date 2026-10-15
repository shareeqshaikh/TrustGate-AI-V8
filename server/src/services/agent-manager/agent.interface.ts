import type {
  AgentCapability,
  AgentConfigRecord,
  AgentHealth,
  AgentId,
  AgentType,
} from "../../types/agent-manager.types.js";

export interface AgentExecutionContext {
  taskId: string;
  taskType: string;
  initiatedBy: string;
  params: Record<string, any>;
  config: AgentConfigRecord;
  signal: AbortSignal;
}

export interface AgentTaskExecutionResult {
  summary: string;
  data?: any;
  itemsProcessed?: number;
  warnings?: string[];
}

export interface IAgent {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
  readonly type: AgentType;
  readonly version: string;

  getDefaultConfig(): Omit<AgentConfigRecord, "updatedAt" | "updatedBy">;
  getCapabilities(): AgentCapability[];
  getHealth(config: AgentConfigRecord): Promise<AgentHealth>;
  validateTaskParams(
    taskType: string,
    params: Record<string, any>
  ): { valid: boolean; error?: string };
  isTaskCancellable(taskType: string): boolean;
  executeTask(ctx: AgentExecutionContext): Promise<AgentTaskExecutionResult>;
}
