import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { Mutex } from "async-mutex";
import {
  agentConfigsRepo,
  agentExecutionsRepo,
  emergencyStopRepo,
} from "../../storage/json-repository.js";
import { AgentRegistry } from "./agent-registry.js";
import { AuditService } from "../audit.service.js";
import { OllamaAgentsService } from "../ollama-agents.service.js";
import type {
  AgentConfigRecord,
  AgentExecutionTask,
  AgentMetadata,
  AgentOverviewStats,
  EmergencyStopRecord,
} from "../../types/agent-manager.types.js";
import type { AgentExecutionContext } from "./agent.interface.js";

interface RunningTaskHandle {
  taskId: string;
  agentId: string;
  taskType: string;
  controller: AbortController;
  cancellable: boolean;
  startTime: number;
}

export class AgentManagerService {
  private static taskMutex = new Mutex();
  private static activeRunningTasks: Map<string, RunningTaskHandle> = new Map();

  /**
   * Emergency Stop State retrieval
   */
  public static async getEmergencyStopState(): Promise<EmergencyStopRecord> {
    const existing = await emergencyStopRepo.getById("active_emergency_stop");
    if (existing) {
      return existing;
    }
    const defaultState: EmergencyStopRecord = {
      id: "active_emergency_stop",
      active: false,
    };
    return emergencyStopRepo.create(defaultState);
  }

  /**
   * Trigger Emergency Stop: immediately suspends all new tasks and cancels supported running operations
   */
  public static async triggerEmergencyStop(
    reason: string,
    adminUser: { id: string; email: string }
  ): Promise<{
    state: EmergencyStopRecord;
    cancelledTasksCount: number;
    uncancellableOperations: string[];
  }> {
    const uncancellableOperations: string[] = [];
    let cancelledCount = 0;

    // Inspect in-progress tasks
    for (const [taskId, handle] of this.activeRunningTasks.entries()) {
      if (handle.cancellable) {
        handle.controller.abort();
        cancelledCount++;
        // Update persisted record
        await agentExecutionsRepo.update(taskId, {
          status: "CANCELLED",
          endTime: new Date().toISOString(),
          errorMessage: `Terminated by Emergency Stop: ${reason}`,
        });
      } else {
        uncancellableOperations.push(
          `Task ${taskId} (${handle.agentId} - ${handle.taskType}): Non-cancellable atomic operation in progress.`
        );
      }
    }
    this.activeRunningTasks.clear();

    const now = new Date().toISOString();
    const updatedState = await emergencyStopRepo.update("active_emergency_stop", {
      active: true,
      triggeredAt: now,
      triggeredBy: adminUser.email,
      reason,
      uncancellableOperations,
    });

    await AuditService.record("EMERGENCY_STOP_ACTIVATED", adminUser as any, {
      reason,
      cancelledTasksCount: cancelledCount,
      uncancellableOperations,
    });

    return {
      state: updatedState!,
      cancelledTasksCount: cancelledCount,
      uncancellableOperations,
    };
  }

  /**
   * Resume operations after Emergency Stop
   */
  public static async resumeEmergencyStop(
    adminUser: { id: string; email: string }
  ): Promise<EmergencyStopRecord> {
    const now = new Date().toISOString();
    const updated = await emergencyStopRepo.update("active_emergency_stop", {
      active: false,
      resumedAt: now,
      resumedBy: adminUser.email,
    });

    await AuditService.record("EMERGENCY_STOP_RESUMED", adminUser as any, {
      resumedAt: now,
    });

    return updated!;
  }

  /**
   * Get or initialize configuration for an agent
   */
  public static async getAgentConfig(agentId: string): Promise<AgentConfigRecord> {
    const existing = await agentConfigsRepo.getById(agentId);
    if (existing) {
      return existing;
    }

    const registry = AgentRegistry.getInstance();
    const agent = registry.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' is not registered in the system.`);
    }

    const defaultConfig: AgentConfigRecord = {
      ...agent.getDefaultConfig(),
      updatedAt: new Date().toISOString(),
      updatedBy: "SYSTEM",
    };

    return agentConfigsRepo.create(defaultConfig);
  }

  /**
   * Update configuration for an agent
   */
  public static async updateAgentConfig(
    agentId: string,
    updates: Partial<AgentConfigRecord>,
    adminUser: { email: string }
  ): Promise<AgentConfigRecord> {
    const current = await this.getAgentConfig(agentId);
    const sanitizedUpdates: Partial<AgentConfigRecord> = {};

    if (typeof updates.enabled === "boolean") {
      sanitizedUpdates.enabled = updates.enabled;
    }
    if (typeof updates.taskTimeoutMs === "number") {
      sanitizedUpdates.taskTimeoutMs = Math.max(1000, Math.min(updates.taskTimeoutMs, 300000));
    }
    if (typeof updates.maxRetries === "number") {
      sanitizedUpdates.maxRetries = Math.max(0, Math.min(updates.maxRetries, 5));
    }
    if (updates.logLevel) {
      sanitizedUpdates.logLevel = updates.logLevel;
    }
    if (updates.customSettings && typeof updates.customSettings === "object") {
      sanitizedUpdates.customSettings = {
        ...current.customSettings,
        ...updates.customSettings,
      };
    }

    sanitizedUpdates.updatedAt = new Date().toISOString();
    sanitizedUpdates.updatedBy = adminUser.email;

    const updated = await agentConfigsRepo.update(agentId, sanitizedUpdates);

    await AuditService.record("AGENT_CONFIG_UPDATED", { id: "ADMIN", email: adminUser.email } as any, {
      agentId,
      updates: sanitizedUpdates,
    });

    return updated!;
  }

  /**
   * Toggle agent enabled/disabled state
   */
  public static async toggleAgent(
    agentId: string,
    enabled: boolean,
    adminUser: { email: string }
  ): Promise<AgentConfigRecord> {
    return this.updateAgentConfig(agentId, { enabled }, adminUser);
  }

  /**
   * Get metadata and live status for a single agent
   */
  public static async getAgentMetadata(agentId: string): Promise<AgentMetadata | null> {
    const registry = AgentRegistry.getInstance();
    const agent = registry.getAgent(agentId);
    if (!agent) {
      return null;
    }

    const config = await this.getAgentConfig(agentId);
    const health = await agent.getHealth(config);

    // Compute execution statistics
    const allExecutions = await agentExecutionsRepo.find((e) => e.agentId === agentId);
    const successCount = allExecutions.filter((e) => e.status === "COMPLETED").length;
    const failureCount = allExecutions.filter((e) => e.status === "FAILED").length;
    const lastExecution = allExecutions.length > 0 ? allExecutions[allExecutions.length - 1] : null;

    // Check if any task is currently running
    const hasRunningTask = Array.from(this.activeRunningTasks.values()).some(
      (h) => h.agentId === agentId
    );

    let status = health.status;
    if (!config.enabled) {
      status = "STOPPED";
    } else if (hasRunningTask) {
      status = "RUNNING_TASK";
    }

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      type: agent.type,
      version: agent.version,
      enabled: config.enabled,
      status,
      health,
      capabilities: agent.getCapabilities(),
      config,
      lastExecution,
      statistics: {
        totalTasksRun: allExecutions.length,
        successCount,
        failureCount,
        lastRunAt: lastExecution?.startTime,
      },
    };
  }

  /**
   * Get metadata for all registered agents
   */
  public static async getAllAgentsMetadata(): Promise<AgentMetadata[]> {
    const registry = AgentRegistry.getInstance();
    const agents = registry.getAllAgents();
    const metadataList: AgentMetadata[] = [];

    for (const agent of agents) {
      const meta = await this.getAgentMetadata(agent.id);
      if (meta) {
        metadataList.push(meta);
      }
    }

    return metadataList;
  }

  /**
   * Get high-level overview statistics for dashboard
   */
  public static async getOverviewStats(): Promise<AgentOverviewStats> {
    const agents = await this.getAllAgentsMetadata();
    const emergencyStop = await this.getEmergencyStopState();
    const aiProvider = await OllamaAgentsService.checkHealth();
    const allExecutions = await agentExecutionsRepo.getAll();

    const enabledAgents = agents.filter((a) => a.enabled).length;
    const disabledAgents = agents.length - enabledAgents;
    const runningTasks = this.activeRunningTasks.size;
    const failedTasks = allExecutions.filter((e) => e.status === "FAILED").length;
    const completedTasks = allExecutions.filter((e) => e.status === "COMPLETED").length;

    const recentActivity = allExecutions.slice(-10).reverse();

    return {
      totalAgents: agents.length,
      enabledAgents,
      disabledAgents,
      runningTasks,
      failedTasks,
      completedTasks,
      emergencyStop: {
        active: emergencyStop.active,
        triggeredAt: emergencyStop.triggeredAt,
        triggeredBy: emergencyStop.triggeredBy,
        reason: emergencyStop.reason,
      },
      aiProvider,
      recentActivity,
    };
  }

  /**
   * Execute a supported task on an agent with full auditing, timeout, and emergency stop enforcement
   */
  public static async executeAgentTask(
    agentId: string,
    taskType: string,
    params: Record<string, any>,
    adminUser: { id: string; email: string }
  ): Promise<AgentExecutionTask> {
    // 1. Check Emergency Stop
    const emergencyStop = await this.getEmergencyStopState();
    if (emergencyStop.active) {
      throw Object.assign(
        new Error(
          `EMERGENCY_STOP_ACTIVE: All agent operations are suspended. Reason: ${
            emergencyStop.reason || "Administrative hold"
          }`
        ),
        { status: 403, code: "EMERGENCY_STOP_ACTIVE" }
      );
    }

    // 2. Locate Agent
    const registry = AgentRegistry.getInstance();
    const agent = registry.getAgent(agentId);
    if (!agent) {
      throw Object.assign(new Error(`Agent '${agentId}' is not registered.`), {
        status: 404,
        code: "AGENT_NOT_FOUND",
      });
    }

    // 3. Check Enabled Status
    const config = await this.getAgentConfig(agentId);
    if (!config.enabled) {
      throw Object.assign(
        new Error(`Agent '${agent.name}' is currently disabled. Enable the agent before running tasks.`),
        { status: 400, code: "AGENT_DISABLED" }
      );
    }

    // 4. Validate Task Policy & Parameters
    const validation = agent.validateTaskParams(taskType, params);
    if (!validation.valid) {
      throw Object.assign(
        new Error(validation.error || `Invalid task parameters for ${taskType}`),
        { status: 400, code: "INVALID_PARAMETERS" }
      );
    }

    // 5. Validate Capability
    const capabilities = agent.getCapabilities();
    const capability = capabilities.find((c) => c.id === taskType);
    if (!capability) {
      throw Object.assign(
        new Error(
          `Agent '${agent.name}' does not support task type '${taskType}'. Supported tasks: ${capabilities
            .map((c) => c.id)
            .join(", ")}`
        ),
        { status: 400, code: "UNSUPPORTED_TASK" }
      );
    }

    // 5. Prevent duplicate concurrent execution of the exact same task type on this agent
    const isAlreadyRunning = Array.from(this.activeRunningTasks.values()).some(
      (h) => h.agentId === agentId && h.taskType === taskType
    );
    if (isAlreadyRunning) {
      throw Object.assign(
        new Error(`Task '${taskType}' is already actively running on '${agent.name}'. Please wait for completion.`),
        { status: 409, code: "TASK_ALREADY_RUNNING" }
      );
    }

    // 6. Create Execution Record
    const taskId = `task_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const cancellable = agent.isTaskCancellable(taskType);
    const controller = new AbortController();

    const executionRecord: AgentExecutionTask = {
      id: taskId,
      agentId,
      agentName: agent.name,
      taskType,
      status: "RUNNING",
      startTime: new Date().toISOString(),
      initiatedBy: adminUser.email,
      params,
      cancellable,
    };

    await agentExecutionsRepo.create(executionRecord);

    const handle: RunningTaskHandle = {
      taskId,
      agentId,
      taskType,
      controller,
      cancellable,
      startTime: performance.now(),
    };
    this.activeRunningTasks.set(taskId, handle);

    // 7. Dispatch execution asynchronously with timeout
    const timeoutMs = config.taskTimeoutMs || 30000;
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const ctx: AgentExecutionContext = {
      taskId,
      taskType,
      initiatedBy: adminUser.email,
      params,
      config,
      signal: controller.signal,
    };

    try {
      const result = await agent.executeTask(ctx);
      clearTimeout(timeoutHandle);
      this.activeRunningTasks.delete(taskId);

      const endTime = new Date().toISOString();
      const durationMs = Math.round(performance.now() - handle.startTime);

      const updated = await agentExecutionsRepo.update(taskId, {
        status: "COMPLETED",
        endTime,
        durationMs,
        resultSummary: result.summary,
        resultData: result.data,
      });

      await AuditService.record("AGENT_TASK_COMPLETED", adminUser as any, {
        taskId,
        agentId,
        taskType,
        durationMs,
        summary: result.summary,
      });

      return updated!;
    } catch (err: any) {
      clearTimeout(timeoutHandle);
      this.activeRunningTasks.delete(taskId);

      const endTime = new Date().toISOString();
      const durationMs = Math.round(performance.now() - handle.startTime);
      const isAbort = controller.signal.aborted;

      const finalStatus = isAbort ? "CANCELLED" : "FAILED";
      const errorMessage = isAbort
        ? `Task timed out or was cancelled after ${timeoutMs}ms.`
        : err.message || "Unknown error during task execution";

      const updated = await agentExecutionsRepo.update(taskId, {
        status: finalStatus,
        endTime,
        durationMs,
        errorMessage,
      });

      await AuditService.record("AGENT_TASK_FAILED", adminUser as any, {
        taskId,
        agentId,
        taskType,
        durationMs,
        error: errorMessage,
      });

      return updated!;
    }
  }

  /**
   * Cancel an in-progress task
   */
  public static async cancelTask(
    taskId: string,
    adminUser: { email: string }
  ): Promise<AgentExecutionTask> {
    const handle = this.activeRunningTasks.get(taskId);
    if (!handle) {
      const task = await agentExecutionsRepo.getById(taskId);
      if (!task) {
        throw Object.assign(new Error(`Task '${taskId}' not found.`), { status: 404 });
      }
      return task; // already finished
    }

    if (!handle.cancellable) {
      throw Object.assign(
        new Error(
          `Task '${taskId}' is marked non-cancellable because it is an atomic committed operation.`
        ),
        { status: 400 }
      );
    }

    handle.controller.abort();
    this.activeRunningTasks.delete(taskId);

    const updated = await agentExecutionsRepo.update(taskId, {
      status: "CANCELLED",
      endTime: new Date().toISOString(),
      errorMessage: `Manually cancelled by ${adminUser.email}`,
    });

    await AuditService.record("AGENT_TASK_CANCELLED", { id: "ADMIN", email: adminUser.email } as any, {
      taskId,
    });

    return updated!;
  }

  /**
   * Query execution history with filtering and pagination
   */
  public static async getTaskHistory(options: {
    agentId?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: AgentExecutionTask[]; total: number }> {
    const all = await agentExecutionsRepo.getAll();
    let filtered = all.reverse();

    if (options.agentId) {
      filtered = filtered.filter((t) => t.agentId === options.agentId);
    }
    if (options.status && options.status !== "ALL") {
      filtered = filtered.filter((t) => t.status === options.status);
    }
    if (options.search) {
      const q = options.search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.taskType.toLowerCase().includes(q) ||
          t.agentName.toLowerCase().includes(q) ||
          (t.resultSummary && t.resultSummary.toLowerCase().includes(q))
      );
    }

    const total = filtered.length;
    const offset = Math.max(0, options.offset || 0);
    const limit = Math.min(100, Math.max(1, options.limit || 20));

    return {
      tasks: filtered.slice(offset, offset + limit),
      total,
    };
  }
}
