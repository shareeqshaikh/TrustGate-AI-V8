import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

// Isolated temporary test directory
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `trustgate_email_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
);
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.EMAIL_PROVIDER = "dryrun";
process.env.EMAIL_DRY_RUN = "true";

import { ENV } from "../src/config/env.js";
ENV.EMAIL_PROVIDER = "dryrun";
ENV.EMAIL_DRY_RUN = true;

import { app } from "../src/app.js";
import {
  usersRepo,
  subscriptionsRepo,
  campaignsRepo,
  remindersRepo,
  emailLogsRepo,
} from "../src/storage/json-repository.js";
import { seedAdminAccount } from "../src/utils/roles.js";
import { escapeHtml, EmailService } from "../src/services/email/email.service.js";
import { EmailAgentService } from "../src/services/email-agent.service.js";
import { ReminderSchedulerService } from "../src/services/reminder-scheduler.service.js";
import type { Subscription } from "../src/types/index.js";

let adminAgent: any;
let userAgent: any;

let adminUserId: string;
let normalUserId: string;
let normalUserEmail = "testuser@example.com";

beforeAll(async () => {
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }

  process.env.ADMIN_EMAIL = "shareeqshaikh194@gmail.com";
  process.env.ADMIN_PASSWORD = "adminPassword123";
  await seedAdminAccount();

  adminAgent = request.agent(app);
  userAgent = request.agent(app);

  // Login as admin
  const adminLogin = await adminAgent.post("/api/v1/auth/login").send({
    email: "shareeqshaikh194@gmail.com",
    password: "adminPassword123",
  });
  adminUserId = adminLogin.body.user.id;

  // Register and login normal user
  const userRegister = await userAgent.post("/api/v1/auth/register").send({
    name: "Normal User",
    email: normalUserEmail,
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

describe("TrustGate Email Automation & Expiry Sentinel Tests", () => {
  // -------------------------------------------------------------
  // 1. Admin vs Non-admin Access
  // -------------------------------------------------------------
  it("restricts campaign endpoints to admin only (403 for non-admin, 401 for guest)", async () => {
    // Guest access -> 401
    const guestRes = await request(app).get("/api/v1/admin/email/campaigns");
    expect(guestRes.status).toBe(401);

    // Normal user access -> 403
    const userRes = await userAgent.get("/api/v1/admin/email/campaigns");
    expect(userRes.status).toBe(403);
    expect(userRes.body.code).toBe("FORBIDDEN");

    // Admin access -> 200
    const adminRes = await adminAgent.get("/api/v1/admin/email/campaigns");
    expect(adminRes.status).toBe(200);
    expect(Array.isArray(adminRes.body.campaigns)).toBe(true);
  });

  // -------------------------------------------------------------
  // 2. Campaign Create, Edit, Recipient Count & Delete
  // -------------------------------------------------------------
  let testCampaignId: string;

  it("creates, counts recipients, updates, and manages a campaign draft", async () => {
    // Check recipient count preview
    const countRes = await adminAgent
      .post("/api/v1/admin/email/recipients/count")
      .send({ recipientGroup: "ALL_ELIGIBLE" });
    expect(countRes.status).toBe(200);
    expect(typeof countRes.body.count).toBe("number");
    expect(countRes.body.count).toBeGreaterThanOrEqual(1);

    // Create campaign
    const createRes = await adminAgent.post("/api/v1/admin/email/campaigns").send({
      name: "Q4 Pro Plan Announcement",
      subject: "Exclusive 20% Off Yearly Pro Plans",
      heading: "Upgrade Your API Gateway Today",
      body: "We are thrilled to announce new enterprise rate limits and discounts.",
      callToActionText: "View Plans",
      callToActionUrl: "http://localhost:5173/plans",
      recipientGroup: "ALL_ELIGIBLE",
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.campaign).toBeDefined();
    expect(createRes.body.campaign.status).toBe("DRAFT");
    testCampaignId = createRes.body.campaign.id;

    // Edit draft
    const editRes = await adminAgent
      .put(`/api/v1/admin/email/campaigns/${testCampaignId}`)
      .send({
        subject: "Updated: Exclusive 25% Off Yearly Pro Plans",
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.campaign.subject).toBe("Updated: Exclusive 25% Off Yearly Pro Plans");
  });

  // -------------------------------------------------------------
  // 3. Recipient Filtering (Active vs Expired vs Unsubscribed)
  // -------------------------------------------------------------
  it("accurately filters recipients by subscription status", async () => {
    // Create an expired sub for normal user
    const expiredSub: Subscription = {
      id: `sub_exp_${Date.now()}`,
      userId: normalUserId,
      planId: "monthly",
      orderId: "ord_dummy",
      startAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      status: "EXPIRED",
    };
    await subscriptionsRepo.create(expiredSub);

    const activeRecipients = await EmailService.resolveRecipients("ACTIVE_SUBSCRIBERS");
    const expiredRecipients = await EmailService.resolveRecipients("EXPIRED_SUBSCRIBERS");

    expect(activeRecipients.some((u) => u.id === normalUserId)).toBe(false);
    expect(expiredRecipients.some((u) => u.id === normalUserId)).toBe(true);
  });

  // -------------------------------------------------------------
  // 4. Unsubscribe Enforcement (Opt-Out Compliance)
  // -------------------------------------------------------------
  it("enforces unsubscribe token and excludes opted-out users from promotional campaigns", async () => {
    const user = await usersRepo.getById(normalUserId);
    const token = await EmailService.getOrCreateUnsubscribeToken(user!);

    // Public token check
    const checkRes = await request(app).get(`/api/v1/unsubscribe/${token}`);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.valid).toBe(true);
    expect(checkRes.body.alreadyUnsubscribed).toBe(false);

    // Confirm unsubscribe
    const unsubRes = await request(app).post(`/api/v1/unsubscribe/${token}`);
    expect(unsubRes.status).toBe(200);
    expect(unsubRes.body.success).toBe(true);

    // Verify user is now excluded from promotional recipients
    const eligibleRecipients = await EmailService.resolveRecipients("ALL_ELIGIBLE", undefined, true);
    expect(eligibleRecipients.some((u) => u.id === normalUserId)).toBe(false);

    // Invalid token returns 404
    const invalidRes = await request(app).get("/api/v1/unsubscribe/invalid_token_123456789012345678901234567890");
    expect(invalidRes.status).toBe(404);
  });

  // -------------------------------------------------------------
  // 5. HTML Entity Escaping (Template & XSS Injection Protection)
  // -------------------------------------------------------------
  it("escapes all HTML special characters in template generation", () => {
    const maliciousInput = '<script>alert("xss")</script> & "quotes" \'apostrophe\'';
    const escaped = escapeHtml(maliciousInput);

    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&amp;");
    expect(escaped).toContain("&quot;");
    expect(escaped).toContain("&#039;");

    const html = EmailService.renderBrandedHtml({
      heading: "<marquee>Bad Heading</marquee>",
      body: 'Hello <img src="x" onerror="evil()"/>',
    });
    expect(html).not.toContain("<marquee>");
    expect(html).not.toContain('<img src="x"');
  });

  // -------------------------------------------------------------
  // 6. Campaign Dispatch in Dry-Run Mode & Idempotency
  // -------------------------------------------------------------
  it("dispatches campaign in dry-run mode, logs delivery, and rejects duplicate sends", async () => {
    // Re-enable promotional preference for test dispatch
    await usersRepo.update(normalUserId, {
      emailPreferences: { promotional: true, unsubscribeToken: "dummy_tok" },
    });

    const sendRes = await adminAgent
      .post(`/api/v1/admin/email/campaigns/${testCampaignId}/send`)
      .send({ dryRun: true });

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.campaign.status).toBe("SENT");
    expect(sendRes.body.campaign.dryRun).toBe(true);

    // Verify idempotency: sending again must fail
    const duplicateRes = await adminAgent
      .post(`/api/v1/admin/email/campaigns/${testCampaignId}/send`)
      .send();
    expect(duplicateRes.status).toBe(400);
    expect(duplicateRes.body.error).toContain("already");

    // Verify delivery logs recorded
    const logs = await emailLogsRepo.find((l) => l.campaignId === testCampaignId);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].status).toBe("DRY_RUN");
  });

  // -------------------------------------------------------------
  // 7. 7-Day Expiry Reminder Calculation & Pre-Window Protection
  // -------------------------------------------------------------
  it("detects subscriptions expiring in 7 days and avoids duplicates on restart", async () => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const expiringSub: Subscription = {
      id: `sub_remind_${Date.now()}`,
      userId: normalUserId,
      planId: "monthly",
      orderId: "ord_test_exp",
      startAt: new Date(now.getTime() - 23 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: sevenDaysFromNow,
      status: "ACTIVE",
    };
    await subscriptionsRepo.create(expiringSub);

    // First scan (manual trigger to evaluate)
    const scanResult1 = await ReminderSchedulerService.runReminderScan(true);
    expect(scanResult1.scanned).toBeGreaterThanOrEqual(1);
    expect(scanResult1.reminded).toBeGreaterThanOrEqual(1);

    // Verify reminder record in storage
    const reminder = await remindersRepo.findOne(
      (r) => r.subscriptionId === expiringSub.id && r.targetExpiryDate === sevenDaysFromNow
    );
    expect(reminder).toBeDefined();
    expect(reminder?.status).toBe("SENT");

    // Second scan (simulate server restart / recurring scan): MUST NOT send again
    const scanResult2 = await ReminderSchedulerService.runReminderScan(true);
    expect(scanResult2.reminded).toBe(0); // Duplicate prevented
  });

  // -------------------------------------------------------------
  // 8. Exclusion of Cancelled and Renewed Subscriptions from Reminders
  // -------------------------------------------------------------
  it("excludes cancelled subscriptions and already-renewed users from reminders", async () => {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Cancelled sub
    const cancelledSub: Subscription = {
      id: `sub_cancelled_${Date.now()}`,
      userId: normalUserId,
      planId: "monthly",
      orderId: "ord_cancelled",
      startAt: new Date(now.getTime() - 23 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: sevenDaysFromNow,
      status: "CANCELLED",
    };
    await subscriptionsRepo.create(cancelledSub);

    // Active sub where user already renewed with a newer sub
    const oldSub: Subscription = {
      id: `sub_old_${Date.now()}`,
      userId: normalUserId,
      planId: "monthly",
      orderId: "ord_old",
      startAt: new Date(now.getTime() - 23 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: sevenDaysFromNow,
      status: "ACTIVE",
    };
    await subscriptionsRepo.create(oldSub);

    // Newer renewal sub
    const newerSub: Subscription = {
      id: `sub_renewed_${Date.now()}`,
      userId: normalUserId,
      planId: "yearly",
      orderId: "ord_new",
      startAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: "ACTIVE",
    };
    await subscriptionsRepo.create(newerSub);

    const scanResult = await ReminderSchedulerService.runReminderScan(true);
    // Old sub should be marked SKIPPED_ALREADY_RENEWED
    const oldSubReminder = await remindersRepo.findOne((r) => r.subscriptionId === oldSub.id);
    expect(oldSubReminder?.status).toBe("SKIPPED_ALREADY_RENEWED");
  });

  // -------------------------------------------------------------
  // 9. Ollama Email Agent Fallbacks & Offline Resilience
  // -------------------------------------------------------------
  it("provides deterministic fallbacks when Ollama is offline or returns malformed response", async () => {
    // Direct fallback test
    const fallback = EmailAgentService.getFallbackDraft(
      {
        campaignType: "RENEWAL_REMINDER",
        goal: "Renew your plan before time runs out",
        tone: "URGENT",
      },
      "Ollama Offline Test"
    );

    expect(fallback.subject).toContain("Renewal Reminder");
    expect(fallback.heading).toBeDefined();
    expect(fallback.body).toBeDefined();
    expect(fallback.callToAction).toBeDefined();
    expect(fallback.requiresReview).toBe(true);

    // API endpoint test (with invalid host to test graceful fallback)
    process.env.OLLAMA_HOST = "http://localhost:99999"; // Non-existent host
    const draftRes = await adminAgent
      .post("/api/v1/admin/email/generate-draft")
      .send({
        campaignType: "PROMOTIONAL",
        goal: "Promote new fast inference speed",
        tone: "PROFESSIONAL",
      });

    expect(draftRes.status).toBe(200);
    expect(draftRes.body.draft).toBeDefined();
    expect(draftRes.body.draft.requiresReview).toBe(true);
    delete process.env.OLLAMA_HOST; // Reset
  });

  // -------------------------------------------------------------
  // 10. Rate Limiting Protection on Email Test Endpoint
  // -------------------------------------------------------------
  it("enforces rate limits on /api/v1/admin/email/test endpoint", async () => {
    const payload = {
      toEmail: "test@example.com",
      subject: "Ping",
      heading: "Test Heading",
      body: "Test Body",
    };

    // Send 5 test emails (within limit)
    for (let i = 0; i < 5; i++) {
      await adminAgent.post("/api/v1/admin/email/test").send(payload);
    }

    // 6th test email within the 1-minute window should be rate-limited (429)
    const rateLimitedRes = await adminAgent.post("/api/v1/admin/email/test").send(payload);
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.code).toBe("RATE_LIMITED");
  });
});
