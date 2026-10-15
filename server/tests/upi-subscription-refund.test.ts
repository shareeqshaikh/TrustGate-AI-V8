import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

// Isolated temporary test data directory
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `trustgate_upi_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
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
} from "../src/storage/json-repository.js";
import { seedAdminAccount } from "../src/utils/roles.js";
import { AgentManagerService } from "../src/services/agent-manager/agent-manager.service.js";
import { PaymentAgent } from "../src/services/agent-manager/payment.agent.js";
import type { Order } from "../src/types/index.js";

describe("TrustGate AI — UPI QR Subscriptions, UTR Verification, and Auto-Refund Suite", () => {
  let adminAgent: any;
  let userAgent: any;
  let adminUserId: string;
  let customerUserId: string;

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

    // Register customer
    const custRegister = await userAgent.post("/api/v1/auth/register").send({
      name: "Customer User",
      email: "cust@example.com",
      password: "custPassword123",
    });
    customerUserId = custRegister.body.user.id;
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }
  });

  beforeEach(async () => {
    await ordersRepo.clear();
    await subscriptionsRepo.clear();
    await apiKeysRepo.clear();
    await refundsRepo.clear();
  });

  describe("1. Plans and Server-Side Pricing (Paise Only)", () => {
    it("returns primary 7 days (₹2) and 30 days (₹5) plans", async () => {
      const res = await userAgent.get("/api/v1/plans");
      expect(res.status).toBe(200);
      expect(res.body.plans).toBeInstanceOf(Array);
      expect(res.body.plans.length).toBeGreaterThanOrEqual(2);

      const plan7 = res.body.plans.find((p: any) => p.id === "7days");
      expect(plan7).toBeDefined();
      expect(plan7.amountPaise).toBe(200); // ₹2
      expect(plan7.durationDays).toBe(7);

      const plan30 = res.body.plans.find((p: any) => p.id === "30days");
      expect(plan30).toBeDefined();
      expect(plan30.amountPaise).toBe(500); // ₹5
      expect(plan30.durationDays).toBe(30);
    });
  });

  describe("2. Real UPI QR Code Order Creation", () => {
    it("creates order with native UPI URI and QR Data URL (₹2 = 200 paise)", async () => {
      const res = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });

      expect(res.status).toBe(201);
      expect(res.body.order).toBeDefined();
      expect(res.body.order.amountPaise).toBe(200);
      expect(res.body.order.status).toBe("PENDING");
      expect(res.body.order.reference).toMatch(/^TG-[0-9A-F]{6}$/);

      // Verify UPI URI format
      expect(res.body.upiUri).toContain("upi://pay");
      expect(res.body.upiUri).toContain("pa=shareeqshaikh194%40oksbi");
      expect(res.body.upiUri).toContain("am=2.00");
      expect(res.body.upiUri).toContain("cu=INR");
      expect(res.body.upiUri).toContain(`tr=${res.body.order.reference}`);

      // Verify QR Code Data URL
      expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("creates order for 30days plan (₹5 = 500 paise)", async () => {
      const res = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "30days" });

      expect(res.status).toBe(201);
      expect(res.body.order.amountPaise).toBe(500);
      expect(res.body.upiUri).toContain("am=5.00");
    });
  });

  describe("3. 12-digit UTR Verification and Deduplication", () => {
    let order: Order;

    beforeEach(async () => {
      const res = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      order = res.body.order;
    });

    it("rejects invalid UTRs that are not exactly 12 numeric digits", async () => {
      // 11 digits
      const res1 = await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: "12345678901" });
      expect(res1.status).toBe(400);

      // 13 digits
      const res2 = await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: "1234567890123" });
      expect(res2.status).toBe(400);

      // Letters in UTR
      const res3 = await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: "12345678901A" });
      expect(res3.status).toBe(400);
    });

    it("accepts valid 12-digit UTR and sets status to AWAITING_VERIFICATION (no auto-activation)", async () => {
      const validUtr = "428719283741";
      const res = await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: validUtr });

      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe("AWAITING_VERIFICATION");
      expect(res.body.order.utr).toBe(validUtr);
      expect(res.body.order.utrSubmittedAt).toBeDefined();

      // Ensure NO subscription was activated yet
      const subs = await subscriptionsRepo.find((s) => s.orderId === order.id);
      expect(subs.length).toBe(0);
    });

    it("detects and rejects duplicate UTR submission across different orders", async () => {
      const validUtr = "428719283741";
      // First submission
      await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: validUtr });

      // Create second order
      const res2 = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "30days" });
      const order2 = res2.body.order;

      // Attempt duplicate submission
      const dupRes = await userAgent
        .post(`/api/v1/orders/${order2.id}/utr`)
        .send({ utr: validUtr });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error).toContain("already submitted or verified");
    });
  });

  describe("4. Segregation of Duties and Admin Order Confirmation", () => {
    it("enforces segregation of duties: Admin CANNOT confirm their own payment order", async () => {
      // Admin places an order for themselves
      const resOrder = await adminAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      const adminOrder = resOrder.body.order;

      // Submit UTR
      await adminAgent
        .post(`/api/v1/orders/${adminOrder.id}/utr`)
        .send({ utr: "999888777666" });

      // Admin tries to confirm their own order
      const confirmRes = await adminAgent
        .post(`/api/v1/admin/orders/${adminOrder.id}/confirm`);

      expect(confirmRes.status).toBe(403);
      expect(confirmRes.body.code).toBe("ADMIN_CANNOT_CONFIRM_OWN_ORDER");
    });

    it("allows admin to confirm a customer's order and activates subscription with API key", async () => {
      // Customer places order
      const resOrder = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      const custOrder = resOrder.body.order;

      const custUtr = "555444333222";
      await userAgent
        .post(`/api/v1/orders/${custOrder.id}/utr`)
        .send({ utr: custUtr });

      // Admin confirms customer's order
      const confirmRes = await adminAgent
        .post(`/api/v1/admin/orders/${custOrder.id}/confirm`);

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.order.status).toBe("CONFIRMED");
      expect(confirmRes.body.order.confirmedBy).toBe(adminUserId);
      expect(confirmRes.body.subscription).toBeDefined();
      expect(confirmRes.body.subscription.status).toBe("ACTIVE");
      expect(confirmRes.body.apiKey).toBeDefined();
      expect(confirmRes.body.plaintextKey).toMatch(/^tg_live_/);

      // Verify customer can use the key on GET /ping
      const pingRes = await request(app)
        .get("/api/v1/ping")
        .set("Authorization", `Bearer ${confirmRes.body.plaintextKey}`);
      expect(pingRes.status).toBe(200);
      expect(pingRes.body.status).toBe("authorized");
    });

    it("allows admin to reject an order with a reason", async () => {
      const resOrder = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      const custOrder = resOrder.body.order;

      await userAgent
        .post(`/api/v1/orders/${custOrder.id}/utr`)
        .send({ utr: "111222333444" });

      const rejectRes = await adminAgent
        .post(`/api/v1/admin/orders/${custOrder.id}/reject`)
        .send({ reason: "Bank statement shows no incoming credit for this UTR" });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.order.status).toBe("REJECTED");
      expect(rejectRes.body.order.rejectionReason).toBe(
        "Bank statement shows no incoming credit for this UTR"
      );
    });
  });

  describe("5. Deterministic AI Auto-Refund Claim", () => {
    let confirmedOrder: Order;
    let apiKey: string;

    beforeEach(async () => {
      // 1. Create order
      const resOrder = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      const order = resOrder.body.order;

      // 2. Submit UTR
      await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: "777888999000" });

      // 3. Admin confirms
      const confirmRes = await adminAgent
        .post(`/api/v1/admin/orders/${order.id}/confirm`);

      confirmedOrder = confirmRes.body.order;
      apiKey = confirmRes.body.plaintextKey;
    });

    it("auto-approves refund within 7 days, immediately cancels subscription & revokes API key", async () => {
      // Before refund, API key works
      const pingBefore = await request(app)
        .get("/api/v1/ping")
        .set("Authorization", `Bearer ${apiKey}`);
      expect(pingBefore.status).toBe(200);

      // Customer requests refund
      const refundRes = await userAgent
        .post("/api/v1/refunds")
        .send({
          orderId: confirmedOrder.id,
          userUpiId: "customer@okhdfcbank",
          reason: "Testing deterministic auto-refund rule engine",
        });

      expect(refundRes.status).toBe(201);
      expect(refundRes.body.autoApproved).toBe(true);
      expect(refundRes.body.refund.status).toBe("APPROVED_PAYOUT_PENDING");
      expect(refundRes.body.refund.payoutQrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(refundRes.body.refund.payoutUpiUri).toContain("customer%40okhdfcbank");

      // Verify subscription is CANCELLED immediately
      const sub = (await subscriptionsRepo.find((s) => s.orderId === confirmedOrder.id))[0];
      expect(sub.status).toBe("CANCELLED");

      // Verify API key is REVOKED immediately
      const pingAfter = await request(app)
        .get("/api/v1/ping")
        .set("Authorization", `Bearer ${apiKey}`);
      expect(pingAfter.status).toBe(401);
    });

    it("rejects refund claim if UPI ID is invalid", async () => {
      const refundRes = await userAgent
        .post("/api/v1/refunds")
        .send({
          orderId: confirmedOrder.id,
          userUpiId: "invalid-upi-handle",
          reason: "Reason",
        });

      expect(refundRes.status).toBe(400);
      expect(refundRes.body.error).toContain("valid UPI ID");
    });

    it("rejects duplicate refund requests for the same order", async () => {
      // First request
      await userAgent
        .post("/api/v1/refunds")
        .send({
          orderId: confirmedOrder.id,
          userUpiId: "customer@okhdfcbank",
          reason: "First request",
        });

      // Second request
      const dupRes = await userAgent
        .post("/api/v1/refunds")
        .send({
          orderId: confirmedOrder.id,
          userUpiId: "customer@okhdfcbank",
          reason: "Duplicate attempt",
        });

      expect(dupRes.status).toBe(400);
      expect(["ORDER_ALREADY_REFUNDED", "DUPLICATE_REFUND_REQUEST"]).toContain(dupRes.body.code);
    });
  });

  describe("6. Admin Manual Payout and Settlement Tracking", () => {
    let refundId: string;

    beforeEach(async () => {
      // Customer places and gets order confirmed
      const resOrder = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      const order = resOrder.body.order;

      await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: "123123123123" });

      await adminAgent
        .post(`/api/v1/admin/orders/${order.id}/confirm`);

      // Customer claims refund
      const refRes = await userAgent
        .post("/api/v1/refunds")
        .send({
          orderId: order.id,
          userUpiId: "customer@oksbi",
          reason: "Manual payout test",
        });

      refundId = refRes.body.refund.id;
    });

    it("allows admin to record 12-digit payout UTR and marks refund PAID", async () => {
      const payoutUtr = "987654321098";
      const payRes = await adminAgent
        .post(`/api/v1/admin/refunds/${refundId}/mark-paid`)
        .send({ payoutUtr });

      expect(payRes.status).toBe(200);
      expect(payRes.body.refund.status).toBe("PAID");
      expect(payRes.body.refund.payoutUtr).toBe(payoutUtr);
      expect(payRes.body.refund.paidByAdminId).toBe(adminUserId);
    });

    it("rejects payout UTR that is not 12 numeric digits", async () => {
      const payRes = await adminAgent
        .post(`/api/v1/admin/refunds/${refundId}/mark-paid`)
        .send({ payoutUtr: "invalid_utr" });

      expect(payRes.status).toBe(400);
    });
  });

  describe("7. Payment Agent Monitoring in Agent Manager", () => {
    it("reports health with UPI merchant details and verification queues", async () => {
      const agent = new PaymentAgent();
      const config = agent.getDefaultConfig();
      const health = await agent.getHealth(config as any);

      expect(health.status).toBe("HEALTHY");
      expect(health.metrics).toBeDefined();
      expect(health.metrics?.upiMerchantId).toBe("shareeqshaikh194@oksbi");
      expect(health.metrics?.awaitingVerificationOrders).toBeDefined();
      expect(health.metrics?.refundsPendingPayout).toBeDefined();
    });

    it("executes MONITOR_VERIFICATION_QUEUES task without auto-confirming", async () => {
      // Place order in AWAITING_VERIFICATION
      const resOrder = await userAgent
        .post("/api/v1/orders")
        .send({ planId: "7days" });
      const order = resOrder.body.order;

      await userAgent
        .post(`/api/v1/orders/${order.id}/utr`)
        .send({ utr: "654321654321" });

      const taskRes = await adminAgent
        .post("/api/v1/admin/agents/payment-agent/tasks")
        .send({
          taskType: "MONITOR_VERIFICATION_QUEUES",
          params: {},
        });
      expect(taskRes.status).toBe(200);
      expect(taskRes.body.task.status).toBe("COMPLETED");
      expect(taskRes.body.task.resultSummary).toContain("order(s) awaiting UTR verification");
      expect(taskRes.body.task.resultData.ordersAwaitingVerificationCount).toBe(1);

      // Verify the order is STILL in AWAITING_VERIFICATION (segregation of duties maintained)
      const freshOrder = await ordersRepo.getById(order.id);
      expect(freshOrder?.status).toBe("AWAITING_VERIFICATION");
    });
  });
});
