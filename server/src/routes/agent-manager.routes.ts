import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware.js";
import { AgentManagerService } from "../services/agent-manager/agent-manager.service.js";
import { CommandParserService } from "../services/agent-manager/command-parser.service.js";
import {
  UpdateAgentConfigSchema,
  RunAgentTaskSchema,
  EmergencyStopSchema,
} from "../types/agent-manager.types.js";

export const agentManagerRouter = Router();

// Enforce authentication & admin privileges on ALL Agent Manager routes
agentManagerRouter.use(requireAuth, requireAdmin);

const CommandRequestSchema = z.object({
  command: z.string().min(1, "Command text is required"),
  confirmed: z.boolean().optional().default(false),
});

/**
 * POST /api/v1/admin/agents/command
 * Natural language command dispatcher for the administrative command box.
 * Transforms text into whitelisted registered operations, checks permissions & emergency stop,
 * asks confirmation for destructive operations, and executes against the real backend.
 */
agentManagerRouter.post("/command", async (req: Request, res: Response): Promise<void> => {
  try {
    const { command, confirmed } = CommandRequestSchema.parse(req.body);

    // 1. Parse command into whitelisted steps
    const parsedSteps = await CommandParserService.parseCommand(command);

    // 2. Detect destructive steps requiring confirmation
    const destructiveSteps = parsedSteps.filter((s) => s.requiresConfirmation);
    if (destructiveSteps.length > 0 && !confirmed) {
      res.json({
        command,
        parsedSteps,
        requiresConfirmation: true,
        confirmationPrompt: `The command contains ${destructiveSteps.length} destructive action(s) requiring admin confirmation:\n${destructiveSteps
          .map((s) => `• ${s.description}`)
          .join("\n")}`,
        destructiveSteps,
        results: [],
      });
      return;
    }

    // 3. Execute steps sequentially with real backend enforcement
    const results: Array<{
      stepIndex: number;
      agentId: string;
      operation: string;
      status: "SUCCESS" | "FAILED" | "BLOCKED";
      summary: string;
      data?: any;
      error?: string;
    }> = [];

    const adminUser = { id: req.user!.id, email: req.user!.email };

    for (let i = 0; i < parsedSteps.length; i++) {
      const step = parsedSteps[i];

      // Re-check emergency stop for every step
      const emergencyStop = await AgentManagerService.getEmergencyStopState();
      if (
        emergencyStop.active &&
        step.operation !== "RESUME_EMERGENCY_STOP" &&
        step.operation !== "LIST_AGENT_STATES"
      ) {
        results.push({
          stepIndex: i + 1,
          agentId: step.agentId,
          operation: step.operation,
          status: "BLOCKED",
          summary: `Blocked by active Emergency Stop (${emergencyStop.reason || "Administrative hold"}).`,
          error: "EMERGENCY_STOP_ACTIVE",
        });
        continue;
      }

      // Handle Manager-level Toggle
      if (step.agentId === "manager" && step.operation === "TOGGLE_AGENT") {
        try {
          const updated = await AgentManagerService.toggleAgent(
            step.params.agentId,
            step.params.enabled,
            { email: adminUser.email }
          );
          results.push({
            stepIndex: i + 1,
            agentId: step.params.agentId,
            operation: step.operation,
            status: "SUCCESS",
            summary: `Agent '${step.params.agentId}' ${step.params.enabled ? "enabled" : "disabled"} successfully.`,
            data: updated,
          });
        } catch (err: any) {
          results.push({
            stepIndex: i + 1,
            agentId: step.params.agentId,
            operation: step.operation,
            status: "FAILED",
            summary: err.message || `Failed to toggle agent ${step.params.agentId}`,
            error: err.message,
          });
        }
        continue;
      }

      // Handle Manager Emergency Stop directly
      if (step.operation === "TRIGGER_EMERGENCY_STOP") {
        try {
          const stopRes = await AgentManagerService.triggerEmergencyStop(
            step.params.reason || "Triggered via command box",
            adminUser
          );
          results.push({
            stepIndex: i + 1,
            agentId: step.agentId,
            operation: step.operation,
            status: "SUCCESS",
            summary: `Emergency stop activated. Cancelled ${stopRes.cancelledTasksCount} running task(s).`,
            data: stopRes,
          });
        } catch (err: any) {
          results.push({
            stepIndex: i + 1,
            agentId: step.agentId,
            operation: step.operation,
            status: "FAILED",
            summary: err.message || "Failed to trigger emergency stop",
            error: err.message,
          });
        }
        continue;
      }

      // Handle Manager Emergency Resume directly
      if (step.operation === "RESUME_EMERGENCY_STOP") {
        try {
          const resumeRes = await AgentManagerService.resumeEmergencyStop(adminUser);
          results.push({
            stepIndex: i + 1,
            agentId: step.agentId,
            operation: step.operation,
            status: "SUCCESS",
            summary: "Emergency stop resumed successfully. Normal operations restored.",
            data: resumeRes,
          });
        } catch (err: any) {
          results.push({
            stepIndex: i + 1,
            agentId: step.agentId,
            operation: step.operation,
            status: "FAILED",
            summary: err.message || "Failed to resume emergency stop",
            error: err.message,
          });
        }
        continue;
      }

      // Standard Agent Task Execution
      try {
        // Re-check agent enabled state
        const config = await AgentManagerService.getAgentConfig(step.agentId);
        if (!config.enabled) {
          results.push({
            stepIndex: i + 1,
            agentId: step.agentId,
            operation: step.operation,
            status: "BLOCKED",
            summary: `Agent '${step.agentId}' is currently disabled. Enable the agent before running operations.`,
            error: "AGENT_DISABLED",
          });
          continue;
        }

        const task = await AgentManagerService.executeAgentTask(
          step.agentId,
          step.operation,
          step.params,
          adminUser
        );

        results.push({
          stepIndex: i + 1,
          agentId: step.agentId,
          operation: step.operation,
          status: task.status === "COMPLETED" ? "SUCCESS" : "FAILED",
          summary: task.resultSummary || task.errorMessage || `Task executed with status: ${task.status}`,
          data: task.resultData,
          error: task.errorMessage,
        });
      } catch (err: any) {
        results.push({
          stepIndex: i + 1,
          agentId: step.agentId,
          operation: step.operation,
          status: "FAILED",
          summary: err.message || `Failed to execute task ${step.operation} on ${step.agentId}`,
          error: err.message,
        });
      }
    }

    res.json({
      command,
      parsedSteps,
      requiresConfirmation: false,
      results,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message, code: "VALIDATION_ERROR" });
      return;
    }
    res.status(err.status || 400).json({
      error: err.message || "Failed to process command",
      code: err.code || "COMMAND_EXECUTION_ERROR",
    });
  }
});


/**
 * GET /api/v1/admin/agents/overview
 * High-level dashboard summary & statistics
 */
agentManagerRouter.get("/overview", async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = await AgentManagerService.getOverviewStats();
    res.json(stats);
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to load agent overview statistics",
      code: err.code || "AGENT_OVERVIEW_ERROR",
    });
  }
});

/**
 * GET /api/v1/admin/agents
 * List all registered agents with runtime health and configuration
 */
agentManagerRouter.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const agents = await AgentManagerService.getAllAgentsMetadata();
    res.json({ agents });
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to load registered agents",
      code: err.code || "AGENT_LIST_ERROR",
    });
  }
});

/**
 * GET /api/v1/admin/agents/tasks/history
 * List task execution history with filtering and search
 */
agentManagerRouter.get("/tasks/history", async (req: Request, res: Response): Promise<void> => {
  try {
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const result = await AgentManagerService.getTaskHistory({
      agentId,
      status,
      search,
      limit,
      offset,
    });

    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to fetch task history",
      code: err.code || "TASK_HISTORY_ERROR",
    });
  }
});

/**
 * POST /api/v1/admin/agents/emergency-stop
 * Trigger Emergency Stop across all agents
 */
agentManagerRouter.post("/emergency-stop", async (req: Request, res: Response): Promise<void> => {
  try {
    const { reason } = EmergencyStopSchema.parse(req.body);
    const result = await AgentManagerService.triggerEmergencyStop(reason, {
      id: req.user!.id,
      email: req.user!.email,
    });
    res.json({
      message: "Emergency stop activated. All agent actions halted.",
      ...result,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message, code: "VALIDATION_ERROR" });
      return;
    }
    res.status(err.status || 500).json({
      error: err.message || "Failed to trigger emergency stop",
      code: err.code || "EMERGENCY_STOP_ERROR",
    });
  }
});

/**
 * POST /api/v1/admin/agents/emergency-resume
 * Resume operations after Emergency Stop
 */
agentManagerRouter.post("/emergency-resume", async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await AgentManagerService.resumeEmergencyStop({
      id: req.user!.id,
      email: req.user!.email,
    });
    res.json({
      message: "Emergency stop resumed. Agent operations enabled.",
      state,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to resume from emergency stop",
      code: err.code || "EMERGENCY_RESUME_ERROR",
    });
  }
});

/**
 * POST /api/v1/admin/agents/tasks/:taskId/cancel
 * Cancel a specific running task
 */
agentManagerRouter.post("/tasks/:taskId/cancel", async (req: Request, res: Response): Promise<void> => {
  try {
    const task = await AgentManagerService.cancelTask(req.params.taskId, {
      email: req.user!.email,
    });
    res.json({ message: "Task cancelled successfully", task });
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to cancel task",
      code: err.code || "TASK_CANCEL_ERROR",
    });
  }
});

/**
 * GET /api/v1/admin/agents/:id
 * Retrieve details and status for a single agent
 */
agentManagerRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const agent = await AgentManagerService.getAgentMetadata(req.params.id);
    if (!agent) {
      res.status(404).json({ error: "Agent not found", code: "NOT_FOUND" });
      return;
    }
    res.json({ agent });
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to load agent details",
      code: err.code || "AGENT_DETAILS_ERROR",
    });
  }
});

/**
 * POST /api/v1/admin/agents/:id/toggle
 * Enable or disable an agent
 */
agentManagerRouter.post("/:id/toggle", async (req: Request, res: Response): Promise<void> => {
  try {
    const enabled = Boolean(req.body.enabled);
    const updated = await AgentManagerService.toggleAgent(req.params.id, enabled, {
      email: req.user!.email,
    });
    res.json({
      message: `Agent '${req.params.id}' ${enabled ? "enabled" : "disabled"} successfully.`,
      config: updated,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({
      error: err.message || "Failed to toggle agent",
      code: err.code || "AGENT_TOGGLE_ERROR",
    });
  }
});

/**
 * PUT /api/v1/admin/agents/:id/config
 * Update configuration for an agent
 */
agentManagerRouter.put("/:id/config", async (req: Request, res: Response): Promise<void> => {
  try {
    const updates = UpdateAgentConfigSchema.parse(req.body);
    const updated = await AgentManagerService.updateAgentConfig(
      req.params.id,
      updates,
      { email: req.user!.email }
    );
    res.json({
      message: `Agent '${req.params.id}' configuration updated.`,
      config: updated,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message, code: "VALIDATION_ERROR" });
      return;
    }
    res.status(err.status || 500).json({
      error: err.message || "Failed to update agent config",
      code: err.code || "AGENT_CONFIG_ERROR",
    });
  }
});

/**
 * POST /api/v1/admin/agents/:id/tasks
 * Trigger a task execution on an agent
 */
agentManagerRouter.post("/:id/tasks", async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskType, params } = RunAgentTaskSchema.parse(req.body);
    const executionTask = await AgentManagerService.executeAgentTask(
      req.params.id,
      taskType,
      params,
      { id: req.user!.id, email: req.user!.email }
    );
    res.status(executionTask.status === "FAILED" ? 400 : 200).json({
      message: `Task '${taskType}' execution completed with status: ${executionTask.status}.`,
      task: executionTask,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message, code: "VALIDATION_ERROR" });
      return;
    }
    res.status(err.status || 500).json({
      error: err.message || "Failed to execute agent task",
      code: err.code || "TASK_EXECUTION_ERROR",
    });
  }
});
