import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

// Isolated temporary test data directory
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `trustgate_agent_mgr_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
);

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.EMAIL_PROVIDER = "dryrun";
process.env.EMAIL_DRY_RUN = "true";

import { ENV } from "../src/config/env.js";
ENV.EMAIL_PROVIDER = "dryrun";
ENV.EMAIL_DRY_RUN = true;
ENV.DATA_DIR = TEST_DATA_DIR;

import { app } from "../src/app.js";
import {
  usersRepo,
  ordersRepo,
  subscriptionsRepo,
  apiKeysRepo,
  refundsRepo,
  agentConfigsRepo,
  agentExecutionsRepo,
  emergencyStopRepo,
  auditRepo,
} from "../src/storage/json-repository.js";
import { seedAdminAccount } from "../src/utils/roles.js";
import { AgentRegistry } from "../src/services/agent-manager/agent-registry.js";
import { AgentManagerService } from "../src/services/agent-manager/agent-manager.service.js";
import type { Order, Subscription } from "../src/types/index.js";

let adminAgent: any;
let userAgent: any;
let adminUserId: string;
let normalUserId: string;

beforeAll(async () => {
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }

  process.env.ADMIN_EMAIL = "shareeqshaikh194@gmail.com";
  process.env.ADMIN_PASSWORD = "adminPassword123";
  await seedAdminAccount();

  adminAgent = request.agent(app);
  userAgent = request.agent(app);

  // Login admin
  const adminLogin = await adminAgent.post("/api/v1/auth/login").send({
    email: "shareeqshaikh194@gmail.com",
    password: "adminPassword123",
  });
  adminUserId = adminLogin.body.user.id;

  // Register and login normal user
  const userRegister = await userAgent.post("/api/v1/auth/register").send({
    name: "Regular Dev",
    email: "dev@example.com",
    password: "userPassword123",
  });
  normalUserId = userRegister.body.user.id;
});

afterAll(async () => {
  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Cleanup error:", err);
  }
});

describe("TrustGate Central Agent Manager Test Suite", () => {
  // -------------------------------------------------------------
  // 1. Agent Registry & Discovery
  // -------------------------------------------------------------
  it("registers all 6 core agents in AgentRegistry by default", async () => {
    const registry = AgentRegistry.getInstance();
    expect(registry.hasAgent("payment-agent")).toBe(true);
    expect(registry.hasAgent("email-agent")).toBe(true);
    expect(registry.hasAgent("subscription-agent")).toBe(true);
    expect(registry.hasAgent("api-key-agent")).toBe(true);
    expect(registry.hasAgent("refund-agent")).toBe(true);
    expect(registry.hasAgent("security-agent")).toBe(true);

    const paymentAgent = registry.getAgent("payment-agent");
    expect(paymentAgent?.name).toContain("Payment");
    expect(paymentAgent?.type).toBe("PAYMENT");

    const emailAgent = registry.getAgent("email-agent");
    expect(emailAgent?.name).toContain("Email");
    expect(emailAgent?.type).toBe("COMMUNICATION");

    const subAgent = registry.getAgent("subscription-agent");
    expect(subAgent?.name).toContain("Subscription");
    expect(subAgent?.type).toBe("AUTOMATION");

    const keyAgent = registry.getAgent("api-key-agent");
    expect(keyAgent?.name).toContain("API Key");
    expect(keyAgent?.type).toBe("SECURITY");

    const refundAgent = registry.getAgent("refund-agent");
    expect(refundAgent?.name).toContain("Refund");
    expect(refundAgent?.type).toBe("PAYMENT");

    const securityAgent = registry.getAgent("security-agent");
    expect(securityAgent?.name).toContain("Security");
    expect(securityAgent?.type).toBe("SECURITY");
  });

  // -------------------------------------------------------------
  // 2. Security & Role-Based Authorization
  // -------------------------------------------------------------
  it("strictly enforces admin authorization (401 guest, 403 non-admin)", async () => {
    // Unauthenticated guest -> 401
    const guestRes = await request(app).get("/api/v1/admin/agents");
    expect(guestRes.status).toBe(401);
    expect(guestRes.body.code).toBe("UNAUTHORIZED");

    // Non-admin user -> 403
    const userRes = await userAgent.get("/api/v1/admin/agents");
    expect(userRes.status).toBe(403);
    expect(userRes.body.code).toBe("FORBIDDEN");

    // Admin user -> 200
    const adminRes = await adminAgent.get("/api/v1/admin/agents");
    expect(adminRes.status).toBe(200);
    expect(Array.isArray(adminRes.body.agents)).toBe(true);
    expect(adminRes.body.agents.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------
  // 3. Overview Statistics
  // -------------------------------------------------------------
  it("returns comprehensive overview statistics including AI and Emergency Stop status", async () => {
    const res = await adminAgent.get("/api/v1/admin/agents/overview");
    expect(res.status).toBe(200);
    expect(res.body.totalAgents).toBeGreaterThanOrEqual(2);
    expect(res.body.enabledAgents).toBeGreaterThanOrEqual(2);
    expect(res.body.emergencyStop).toBeDefined();
    expect(res.body.emergencyStop.active).toBe(false);
    expect(res.body.aiProvider).toBeDefined();
    expect(res.body.aiProvider.provider).toBe("Ollama Local LLM");
    // Ollama may be offline in test env, but overview should report it gracefully
    expect(typeof res.body.aiProvider.available).toBe("boolean");
  });

  // -------------------------------------------------------------
  // 4. Agent Enable / Disable Toggling
  // -------------------------------------------------------------
  it("toggles agent enabled status and blocks task execution when disabled", async () => {
    // Disable payment agent
    const disableRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/toggle")
      .send({ enabled: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.config.enabled).toBe(false);

    // Attempt to execute task on disabled agent -> 400
    const taskRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/tasks")
      .send({ taskType: "AUDIT_PAYMENT_RECORDS", params: {} });
    expect(taskRes.status).toBe(400);
    expect(taskRes.body.code).toBe("AGENT_DISABLED");

    // Re-enable payment agent
    const enableRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/toggle")
      .send({ enabled: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.config.enabled).toBe(true);
  });

  // -------------------------------------------------------------
  // 5. Agent Configuration Update
  // -------------------------------------------------------------
  it("updates and validates agent configuration safely", async () => {
    const updateRes = await adminAgent
      .put("/api/v1/admin/agents/payment-agent/config")
      .send({
        taskTimeoutMs: 40000,
        maxRetries: 3,
        logLevel: "DEBUG",
        customSettings: { autoVerifyBatchSize: 50 },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.config.taskTimeoutMs).toBe(40000);
    expect(updateRes.body.config.maxRetries).toBe(3);
    expect(updateRes.body.config.logLevel).toBe("DEBUG");
    expect(updateRes.body.config.customSettings.autoVerifyBatchSize).toBe(50);
  });

  // -------------------------------------------------------------
  // 6. Payment Agent Task Execution & Auditing
  // -------------------------------------------------------------
  it("executes AUDIT_PAYMENT_RECORDS task successfully", async () => {
    // Seed sample order and active subscription
    const sampleOrder: Order = {
      id: "ord_mgr_test_1",
      userId: normalUserId,
      userName: "Regular Dev",
      userEmail: "dev@example.com",
      planId: "monthly",
      amountPaise: 20000,
      reference: "TG-MGRTEST",
      utr: "UTR-TEST-123456",
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    };
    await ordersRepo.create(sampleOrder);

    const sampleSub: Subscription = {
      id: "sub_mgr_test_1",
      userId: normalUserId,
      planId: "monthly",
      orderId: sampleOrder.id,
      startAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ACTIVE",
    };
    await subscriptionsRepo.create(sampleSub);

    const runRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/tasks")
      .send({
        taskType: "AUDIT_PAYMENT_RECORDS",
        params: {},
      });

    expect(runRes.status).toBe(200);
    expect(runRes.body.task.status).toBe("COMPLETED");
    expect(runRes.body.task.resultSummary).toContain("Audit passed");
    expect(runRes.body.task.resultData.confirmedOrders).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------
  // 7. Payment Agent: Inspect Specific Order
  // -------------------------------------------------------------
  it("executes INSPECT_ORDER task and returns complete order details", async () => {
    const runRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/tasks")
      .send({
        taskType: "INSPECT_ORDER",
        params: { orderId: "ord_mgr_test_1" },
      });

    expect(runRes.status).toBe(200);
    expect(runRes.body.task.status).toBe("COMPLETED");
    expect(runRes.body.task.resultData.order.id).toBe("ord_mgr_test_1");
    expect(runRes.body.task.resultData.linkedSubscriptions.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------
  // 8. Email Agent: Provider Health & AI Draft Generation
  // -------------------------------------------------------------
  it("tests email provider health and generates drafts with deterministic fallback", async () => {
    // 1. Health check task
    const healthTaskRes = await adminAgent
      .post("/api/v1/admin/agents/email-agent/tasks")
      .send({
        taskType: "TEST_PROVIDER_HEALTH",
        params: {},
      });
    expect(healthTaskRes.status).toBe(200);
    expect(healthTaskRes.body.task.status).toBe("COMPLETED");
    expect(healthTaskRes.body.task.resultData.provider).toBe("dryrun");

    // 2. AI draft generation task
    const draftTaskRes = await adminAgent
      .post("/api/v1/admin/agents/email-agent/tasks")
      .send({
        taskType: "GENERATE_AI_DRAFT",
        params: {
          campaignType: "RENEWAL_REMINDER",
          goal: "Remind user their API key expires in 3 days",
          tone: "URGENT",
        },
      });
    expect(draftTaskRes.status).toBe(200);
    expect(draftTaskRes.body.task.status).toBe("COMPLETED");
    expect(draftTaskRes.body.task.resultData.subject).toBeDefined();
    expect(draftTaskRes.body.task.resultData.requiresReview).toBe(true);
  }, 15000);

  // -------------------------------------------------------------
  // 9. Email Agent: Expiry Reminder Scan Task
  // -------------------------------------------------------------
  it("executes TRIGGER_REMINDER_SCAN task successfully", async () => {
    const scanTaskRes = await adminAgent
      .post("/api/v1/admin/agents/email-agent/tasks")
      .send({
        taskType: "TRIGGER_REMINDER_SCAN",
        params: {},
      });
    expect(scanTaskRes.status).toBe(200);
    expect(scanTaskRes.body.task.status).toBe("COMPLETED");
    expect(scanTaskRes.body.task.resultData.scanned).toBeDefined();
  });

  // -------------------------------------------------------------
  // 10. Unsupported Task & Parameter Validation
  // -------------------------------------------------------------
  it("rejects unsupported tasks and invalid parameters", async () => {
    // Unsupported task
    const unsupportedRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/tasks")
      .send({
        taskType: "MALICIOUS_DELETE_EVERYTHING",
        params: {},
      });
    expect(unsupportedRes.status).toBe(400);
    expect(unsupportedRes.body.code).toBe("UNSUPPORTED_TASK");

    // Invalid parameters (missing required orderId)
    const invalidParamRes = await adminAgent
      .post("/api/v1/admin/agents/payment-agent/tasks")
      .send({
        taskType: "INSPECT_ORDER",
        params: {}, // Missing orderId
      });
    expect(invalidParamRes.status).toBe(400);
    expect(invalidParamRes.body.code).toBe("INVALID_PARAMETERS");
  });

  // -------------------------------------------------------------
  // 11. Task Execution History Querying
  // -------------------------------------------------------------
  it("queries task execution history with filters", async () => {
    const historyRes = await adminAgent.get(
      "/api/v1/admin/agents/tasks/history?agentId=payment-agent&status=COMPLETED&limit=10"
    );
    expect(historyRes.status).toBe(200);
    expect(Array.isArray(historyRes.body.tasks)).toBe(true);
    expect(historyRes.body.total).toBeGreaterThanOrEqual(1);
    for (const t of historyRes.body.tasks) {
      expect(t.agentId).toBe("payment-agent");
      expect(t.status).toBe("COMPLETED");
    }
  });

  // -------------------------------------------------------------
  // 12. Emergency Stop & Resume Lifecycle
  // -------------------------------------------------------------
  it("activates emergency stop, blocks new tasks, records audit, and resumes cleanly", async () => {
    // 1. Activate Emergency Stop
    const stopRes = await adminAgent
      .post("/api/v1/admin/agents/emergency-stop")
      .send({ reason: "Suspected abnormal gateway latency. Pausing all automations." });

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.state.active).toBe(true);
    expect(stopRes.body.state.reason).toContain("Suspected abnormal");

    // Verify overview reports emergency stop as active
    const overviewRes = await adminAgent.get("/api/v1/admin/agents/overview");
    expect(overviewRes.body.emergencyStop.active).toBe(true);

    // 2. Any subsequent task MUST be rejected immediately
    const blockedTaskRes = await adminAgent
      .post("/api/v1/admin/agents/email-agent/tasks")
      .send({ taskType: "TRIGGER_REMINDER_SCAN", params: {} });
    expect(blockedTaskRes.status).toBe(403);
    expect(blockedTaskRes.body.code).toBe("EMERGENCY_STOP_ACTIVE");

    // 3. Resume Emergency Stop
    const resumeRes = await adminAgent.post("/api/v1/admin/agents/emergency-resume");
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.state.active).toBe(false);

    // 4. Verify tasks are permitted again
    const allowedTaskRes = await adminAgent
      .post("/api/v1/admin/agents/email-agent/tasks")
      .send({ taskType: "TEST_PROVIDER_HEALTH", params: {} });
    expect(allowedTaskRes.status).toBe(200);
    expect(allowedTaskRes.body.task.status).toBe("COMPLETED");

    // 5. Verify audit chain entries exist
    const auditBlocks = await auditRepo.getAll();
    const stopBlock = auditBlocks.find((b) => b.action === "EMERGENCY_STOP_ACTIVATED");
    const resumeBlock = auditBlocks.find((b) => b.action === "EMERGENCY_STOP_RESUMED");
    expect(stopBlock).toBeDefined();
    expect(resumeBlock).toBeDefined();
  });

  // -------------------------------------------------------------
  // 13. Security Gate: Non-Admin Rejected on Command + New Agents
  // -------------------------------------------------------------
  it("rejects non-admin users on command endpoint and all new agent tasks", async () => {
    // Command endpoint
    const cmdRes = await userAgent
      .post("/api/v1/admin/agents/command")
      .send({ command: "Show today's failed payments" });
    expect(cmdRes.status).toBe(403);

    // Subscription Manager
    const subRes = await userAgent
      .post("/api/v1/admin/agents/subscription-agent/tasks")
      .send({ taskType: "LIST_SUBSCRIPTIONS" });
    expect(subRes.status).toBe(403);

    // API Key Manager
    const keyRes = await userAgent
      .post("/api/v1/admin/agents/api-key-agent/tasks")
      .send({ taskType: "LIST_KEYS" });
    expect(keyRes.status).toBe(403);

    // Refund Manager
    const refRes = await userAgent
      .post("/api/v1/admin/agents/refund-agent/tasks")
      .send({ taskType: "LIST_REFUNDS" });
    expect(refRes.status).toBe(403);

    // Security Manager
    const secRes = await userAgent
      .post("/api/v1/admin/agents/security-agent/tasks")
      .send({ taskType: "VIEW_AUDIT_LOG" });
    expect(secRes.status).toBe(403);
  });

  // -------------------------------------------------------------
  // 14. Unknown Operation Rejected
  // -------------------------------------------------------------
  it("rejects unknown operations in command box and agent tasks", async () => {
    // Command box with unknown action
    const unknownCmd = await adminAgent
      .post("/api/v1/admin/agents/command")
      .send({ command: "perform random arbitrary script execution" });
    expect(unknownCmd.status).toBe(400);
    expect(unknownCmd.body.error).toMatch(/unsupported|unknown/i);

    // Agent task with unsupported operation
    const unknownTask = await adminAgent
      .post("/api/v1/admin/agents/subscription-agent/tasks")
      .send({ taskType: "DELETE_ALL_DATA", params: {} });
    expect(unknownTask.status).toBe(400);
    expect(unknownTask.body.error).toContain("does not support task type");
  });

  // -------------------------------------------------------------
  // 15. API Key Manager Sanitization: Never Returns Hash or Plaintext
  // -------------------------------------------------------------
  it("ensures api-key-agent LIST_KEYS never leaks cryptographic hashes or plaintext keys", async () => {
    const testKeyId = `key_leak_test_${Date.now()}`;
    await apiKeysRepo.create({
      id: testKeyId,
      userId: normalUserId,
      subscriptionId: "sub_test_leak",
      hash: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
      prefix: "tg_live_leak",
      last4: "7777",
      revoked: false,
      createdAt: new Date().toISOString(),
      oneTimePlaintextKey: "tg_live_super_secret_plaintext_key_value",
    });

    const res = await adminAgent
      .post("/api/v1/admin/agents/api-key-agent/tasks")
      .send({ taskType: "LIST_KEYS", params: {} });

    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe("COMPLETED");

    const keyList: any[] = res.body.task.resultData;
    expect(Array.isArray(keyList)).toBe(true);

    const foundKey = keyList.find((k) => k.id === testKeyId);
    expect(foundKey).toBeDefined();
    expect(foundKey.prefix).toBe("tg_live_leak");
    expect(foundKey.last4).toBe("7777");
    expect(foundKey.revoked).toBe(false);

    // CRITICAL SECURITY ASSERTIONS: Plaintext and hashes must NEVER be present
    expect(foundKey.hash).toBeUndefined();
    expect(foundKey.plaintextKey).toBeUndefined();
    expect(foundKey.oneTimePlaintextKey).toBeUndefined();

    // Verify all keys returned in list are completely sanitized
    for (const key of keyList) {
      expect((key as any).hash).toBeUndefined();
      expect((key as any).plaintextKey).toBeUndefined();
      expect((key as any).oneTimePlaintextKey).toBeUndefined();
    }
  });

  // -------------------------------------------------------------
  // 16. Refund Manager Cannot Approve Refunds or Mark Paid
  // -------------------------------------------------------------
  it("ensures refund-agent cannot approve refunds or mark them paid", async () => {
    // Attempt to invoke approve operation
    const approveAttempt = await adminAgent
      .post("/api/v1/admin/agents/refund-agent/tasks")
      .send({ taskType: "APPROVE_REFUND", params: { refundId: "ref_1" } });
    expect(approveAttempt.status).toBe(400);
    expect(approveAttempt.body.error).toContain(
      "Refund Manager cannot approve refunds or mark them paid"
    );

    // Attempt to invoke mark paid operation
    const markPaidAttempt = await adminAgent
      .post("/api/v1/admin/agents/refund-agent/tasks")
      .send({ taskType: "MARK_PAID", params: { refundId: "ref_1" } });
    expect(markPaidAttempt.status).toBe(400);
    expect(markPaidAttempt.body.error).toContain(
      "Refund Manager cannot approve refunds or mark them paid"
    );

    // Command box attempt to confirm payment or approve refund
    const cmdForbidden = await adminAgent
      .post("/api/v1/admin/agents/command")
      .send({ command: "approve refund and mark paid" });
    expect(cmdForbidden.status).toBe(400);
    expect(cmdForbidden.body.error).toContain("FORBIDDEN_OPERATION");
  });

  // -------------------------------------------------------------
  // 17. Command Box Works With Ollama Off (Deterministic Rule Parser)
  // -------------------------------------------------------------
  it("executes multi-step commands deterministically with Ollama offline", async () => {
    const commandText = "Disable the Email Agent and show me today's failed payments";

    // 1. Initial invocation without confirmed: true -> returns requiresConfirmation
    const unconfirmedRes = await adminAgent
      .post("/api/v1/admin/agents/command")
      .send({ command: commandText, confirmed: false });

    expect(unconfirmedRes.status).toBe(200);
    expect(unconfirmedRes.body.requiresConfirmation).toBe(true);
    expect(unconfirmedRes.body.destructiveSteps.length).toBeGreaterThanOrEqual(1);
    expect(unconfirmedRes.body.results).toHaveLength(0);

    // 2. Confirmed invocation -> executes both steps
    const confirmedRes = await adminAgent
      .post("/api/v1/admin/agents/command")
      .send({ command: commandText, confirmed: true });

    expect(confirmedRes.status).toBe(200);
    expect(confirmedRes.body.requiresConfirmation).toBe(false);
    expect(confirmedRes.body.results).toHaveLength(2);

    // Step 1: Disable Email Agent
    expect(confirmedRes.body.results[0].agentId).toBe("email-agent");
    expect(confirmedRes.body.results[0].operation).toBe("TOGGLE_AGENT");
    expect(confirmedRes.body.results[0].status).toBe("SUCCESS");

    // Step 2: Show today's failed payments
    expect(confirmedRes.body.results[1].agentId).toBe("payment-agent");
    expect(confirmedRes.body.results[1].operation).toBe("LIST_FAILED_PAYMENTS");
    expect(confirmedRes.body.results[1].status).toBe("SUCCESS");

    // Re-enable Email Agent for subsequent tests
    await adminAgent
      .post("/api/v1/admin/agents/email-agent/toggle")
      .send({ enabled: true });
  });

  // -------------------------------------------------------------
  // 18. Emergency Stop Blocks Commands
  // -------------------------------------------------------------
  it("ensures active emergency stop blocks command box execution", async () => {
    // 1. Trigger Emergency Stop
    await adminAgent
      .post("/api/v1/admin/agents/emergency-stop")
      .send({ reason: "Command box safety lockdown test." });

    // 2. Issue a command
    const cmdRes = await adminAgent
      .post("/api/v1/admin/agents/command")
      .send({ command: "Show today's failed payments" });

    expect(cmdRes.status).toBe(200);
    expect(cmdRes.body.results).toHaveLength(1);
    expect(cmdRes.body.results[0].status).toBe("BLOCKED");
    expect(cmdRes.body.results[0].summary).toContain("Blocked by active Emergency Stop");
    expect(cmdRes.body.results[0].error).toBe("EMERGENCY_STOP_ACTIVE");

    // 3. Resume Emergency Stop
    await adminAgent.post("/api/v1/admin/agents/emergency-resume");
  });
});
