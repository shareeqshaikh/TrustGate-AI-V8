import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Isolated temporary test directory
const TEST_DATA_DIR = path.join(
  os.tmpdir(),
  `trustgate_gmail_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
);

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.ADMIN_EMAIL = "shareeqshaikh194@gmail.com";
process.env.ADMIN_PASSWORD = "adminPassword123";
process.env.GOOGLE_CLIENT_ID = "mock-client-id-12345.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "mock-client-secret-abcdef";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:4000/api/email/oauth/callback";
process.env.EMAIL_TOKEN_ENCRYPTION_KEY = "this_is_a_very_secure_test_key_32chars!";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.GMAIL_DAILY_SEND_CAP = "100";

import { ENV } from "../src/config/env.js";
ENV.EMAIL_TOKEN_ENCRYPTION_KEY = "this_is_a_very_secure_test_key_32chars!";
ENV.GOOGLE_CLIENT_ID = "mock-client-id-12345.apps.googleusercontent.com";
ENV.GOOGLE_CLIENT_SECRET = "mock-client-secret-abcdef";
ENV.GOOGLE_REDIRECT_URI = "http://localhost:4000/api/email/oauth/callback";
ENV.ADMIN_EMAIL = "shareeqshaikh194@gmail.com";
ENV.FRONTEND_URL = "http://localhost:5173";
ENV.GMAIL_DAILY_SEND_CAP = 100;

import { app } from "../src/app.js";
import { gmailTokensRepo } from "../src/storage/json-repository.js";
import { TokenStorageService } from "../src/services/email/token-storage.service.js";
import { GmailEmailProvider } from "../src/services/email/gmail.provider.js";
import { EmailService } from "../src/services/email/email.service.js";
import { seedAdminAccount } from "../src/utils/roles.js";

let adminAgent: any;
let userAgent: any;
let adminUserId: string;
let normalUserId: string;

describe("Gmail OAuth and Provider Integration Test Suite", () => {
  beforeAll(async () => {
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }

    await seedAdminAccount();

    adminAgent = request.agent(app);
    userAgent = request.agent(app);

    // Login admin
    const adminLogin = await adminAgent.post("/api/v1/auth/login").send({
      email: "shareeqshaikh194@gmail.com",
      password: "adminPassword123",
    });
    adminUserId = adminLogin.body.user.id;

    // Register & login normal user
    const userReg = await userAgent.post("/api/v1/auth/register").send({
      name: "Normal User",
      email: "regular_user@example.com",
      password: "userPassword123",
    });
    normalUserId = userReg.body.user.id;
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(TEST_DATA_DIR)) {
        fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. TokenStorageService & AES-256-GCM Security", () => {
    it("should encrypt and decrypt refresh token roundtrip", () => {
      const originalToken = "1//04mock_refresh_token_very_long_string_12345";
      const encrypted = TokenStorageService.encrypt(originalToken);

      expect(encrypted.ciphertextHex).toBeDefined();
      expect(encrypted.ivHex).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.authTagHex).toHaveLength(32); // 16 bytes = 32 hex chars

      const decrypted = TokenStorageService.decrypt(
        encrypted.ciphertextHex,
        encrypted.ivHex,
        encrypted.authTagHex
      );
      expect(decrypted).toBe(originalToken);
    });

    it("should generate unique IV for every encryption of the same plaintext", () => {
      const plaintext = "identical_secret_token";
      const enc1 = TokenStorageService.encrypt(plaintext);
      const enc2 = TokenStorageService.encrypt(plaintext);

      expect(enc1.ivHex).not.toBe(enc2.ivHex);
      expect(enc1.ciphertextHex).not.toBe(enc2.ciphertextHex);
    });

    it("should fail decryption if ciphertext or authTag is tampered with", () => {
      const originalToken = "sensitive_refresh_token";
      const encrypted = TokenStorageService.encrypt(originalToken);

      // Tamper ciphertext
      const tamperedCiphertext =
        encrypted.ciphertextHex.slice(0, -2) + (encrypted.ciphertextHex.slice(-2) === "00" ? "ff" : "00");

      expect(() => {
        TokenStorageService.decrypt(
          tamperedCiphertext,
          encrypted.ivHex,
          encrypted.authTagHex
        );
      }).toThrow();
    });

    it("should throw error if encryption key is missing or shorter than 32 characters", () => {
      const originalKey = ENV.EMAIL_TOKEN_ENCRYPTION_KEY;
      try {
        ENV.EMAIL_TOKEN_ENCRYPTION_KEY = "short_key_under_32";
        expect(() => {
          TokenStorageService.encrypt("secret");
        }).toThrow(/EMAIL_TOKEN_ENCRYPTION_KEY is missing or weak/);
      } finally {
        ENV.EMAIL_TOKEN_ENCRYPTION_KEY = originalKey;
      }
    });

    it("should save and retrieve decrypted token via repository", async () => {
      const testEmail = "shareeqshaikh194@gmail.com";
      const testRefreshToken = "1//04test_refresh_token_for_json_repo";

      await TokenStorageService.saveTokens(testEmail, testRefreshToken);

      const retrieved = await TokenStorageService.getDecryptedRefreshToken();
      expect(retrieved).not.toBeNull();
      expect(retrieved?.connectedEmail).toBe(testEmail);
      expect(retrieved?.refreshToken).toBe(testRefreshToken);

      // Raw record in DB must NOT contain plaintext
      const rawRecord = await gmailTokensRepo.getById("active_gmail_account");
      expect(rawRecord).toBeDefined();
      expect((rawRecord as any).refreshToken).toBeUndefined();
      expect(rawRecord?.encryptedRefreshToken).toBeDefined();
      expect(rawRecord?.encryptedRefreshToken).not.toContain(testRefreshToken);
    });

    it("getStatus should return sanitized telemetry without leaking tokens or keys", async () => {
      const status = await TokenStorageService.getStatus();
      expect(status.connected).toBe(true);
      expect(status.connectedEmail).toBe("shareeqshaikh194@gmail.com");
      expect(status.dailySendCap).toBe(100);
      expect(status.todaySendCount).toBe(0);

      // Verify no secrets exist in the returned object
      expect((status as any).encryptedRefreshToken).toBeUndefined();
      expect((status as any).refreshToken).toBeUndefined();
      expect((status as any).iv).toBeUndefined();
      expect((status as any).authTag).toBeUndefined();
    });

    it("should track daily quota and block when cap is exceeded", async () => {
      const record = await gmailTokensRepo.getById("active_gmail_account");
      expect(record).toBeDefined();

      // Set today count close to limit
      await gmailTokensRepo.update("active_gmail_account", {
        dailySendCap: 3,
        todaySendCount: 2,
        lastResetDate: new Date().toISOString().split("T")[0],
      });

      // 3rd email allowed (consumes last quota)
      const res1 = await TokenStorageService.checkAndConsumeQuota();
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(0);

      // 4th email blocked
      const res2 = await TokenStorageService.checkAndConsumeQuota();
      expect(res2.allowed).toBe(false);
      expect(res2.remaining).toBe(0);
      expect(res2.reason).toContain("Daily Gmail send cap reached");

      // Reset to 100 for remaining tests
      await gmailTokensRepo.update("active_gmail_account", {
        dailySendCap: 100,
        todaySendCount: 0,
      });
    });

    it("should delete tokens cleanly", async () => {
      const deleted = await TokenStorageService.deleteTokens();
      expect(deleted).toBe(true);

      const retrieved = await TokenStorageService.getDecryptedRefreshToken();
      expect(retrieved).toBeNull();

      const status = await TokenStorageService.getStatus();
      expect(status.connected).toBe(false);
    });
  });

  describe("2. GmailEmailProvider MIME Building & Header Security", () => {
    const provider = new GmailEmailProvider();

    it("should format a valid RFC 2822 MIME message with HTML body and base64 subject", () => {
      const mime = provider.buildMimeMessage(
        {
          to: "recipient@example.com",
          subject: "Test Subject With Ünicode",
          html: "<p>Hello TrustGate!</p>",
          idempotencyKey: "test-idem-1234",
        },
        "shareeqshaikh194@gmail.com"
      );

      expect(mime).toContain("To: recipient@example.com");
      expect(mime).toContain('From: "TrustGate AI" <shareeqshaikh194@gmail.com>');
      expect(mime).toContain("Subject: =?UTF-8?B?");
      expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
      expect(mime).toContain("Content-Transfer-Encoding: base64");
      expect(mime).toContain("X-TrustGate-Idempotency: test-idem-1234");
      expect(mime).toContain(Buffer.from("<p>Hello TrustGate!</p>").toString("base64"));
    });

    it("should strictly reject CRLF injection in the recipient address", () => {
      expect(() => {
        provider.buildMimeMessage(
          {
            to: "victim@example.com\r\nBcc: evil@attacker.com",
            subject: "Injection Test",
            html: "<p>Exploit</p>",
          },
          "shareeqshaikh194@gmail.com"
        );
      }).toThrow(/CRLF injection prevented/);

      expect(() => {
        provider.buildMimeMessage(
          {
            to: "victim@example.com\nBcc: evil@attacker.com",
            subject: "Injection Test",
            html: "<p>Exploit</p>",
          },
          "shareeqshaikh194@gmail.com"
        );
      }).toThrow(/CRLF injection prevented/);
    });

    it("should sanitize newlines in subject line", () => {
      const mime = provider.buildMimeMessage(
        {
          to: "user@example.com",
          subject: "Line1\r\nLine2\nLine3",
          html: "<p>Body</p>",
        },
        "shareeqshaikh194@gmail.com"
      );

      // Decoded subject should have replaced newlines with spaces
      const subjectMatch = mime.match(/Subject: =\?UTF-8\?B\?(.*?)\?=/);
      expect(subjectMatch).not.toBeNull();
      const decodedSubject = Buffer.from(subjectMatch![1], "base64").toString("utf8");
      expect(decodedSubject).toBe("Line1  Line2 Line3");
    });
  });

  describe("3. GmailEmailProvider Sending with Mocked Google API", () => {
    const provider = new GmailEmailProvider();

    beforeAll(async () => {
      await TokenStorageService.saveTokens(
        "shareeqshaikh194@gmail.com",
        "mock_google_refresh_token_12345"
      );
    });

    it("should successfully send email through mocked Google API", async () => {
      // Mock OAuth2Client getAccessToken
      const client = provider.getOAuth2Client();
      vi.spyOn(client, "getAccessToken").mockResolvedValue({
        token: "mock-valid-access-token",
        res: null,
      });

      // Mock global fetch for Gmail messages.send
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("gmail.googleapis.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "gmail_msg_id_999888",
              threadId: "thread_111",
            }),
          };
        }
        return originalFetch(url);
      });

      try {
        const result = await provider.sendEmail({
          to: "subscriber@example.com",
          subject: "Welcome to TrustGate",
          html: "<h1>Welcome</h1>",
        });

        expect(result.success).toBe(true);
        expect(result.provider).toBe("gmail");
        expect(result.messageId).toBe("gmail_msg_id_999888");

        const status = await TokenStorageService.getStatus();
        expect(status.todaySendCount).toBeGreaterThanOrEqual(1);
        expect(status.lastSendResult?.success).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("should handle invalid_grant and report reconnect needed", async () => {
      const client = provider.getOAuth2Client();
      vi.spyOn(client, "getAccessToken").mockRejectedValue(
        new Error("invalid_grant: Token has been expired or revoked.")
      );

      const result = await provider.sendEmail({
        to: "subscriber@example.com",
        subject: "Test Expired Token",
        html: "<p>Test</p>",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("Needs reconnect");
    });
  });

  describe("4. Email Routes Security & Gmail Endpoints (/api/email/*)", () => {
    it("should reject non-admin access to Gmail endpoints", async () => {
      // Unauthenticated requests -> 401
      const anonStart = await request(app).get("/api/email/oauth/start");
      expect(anonStart.status).toBe(401);

      const anonStatus = await request(app).get("/api/email/gmail/status");
      expect(anonStatus.status).toBe(401);

      const anonTest = await request(app).post("/api/email/gmail/test");
      expect(anonTest.status).toBe(401);

      const anonDisconnect = await request(app).post("/api/email/gmail/disconnect");
      expect(anonDisconnect.status).toBe(401);

      // Authenticated regular user -> 403 Forbidden
      const userStart = await userAgent.get("/api/email/oauth/start");
      expect(userStart.status).toBe(403);

      const userStatus = await userAgent.get("/api/email/gmail/status");
      expect(userStatus.status).toBe(403);

      const userTest = await userAgent.post("/api/email/gmail/test");
      expect(userTest.status).toBe(403);

      const userDisconnect = await userAgent.post("/api/email/gmail/disconnect");
      expect(userDisconnect.status).toBe(403);
    });

    it("GET /api/email/oauth/start should generate OAuth URL with PKCE and state", async () => {
      const res = await adminAgent.get("/api/email/oauth/start");
      expect(res.status).toBe(200);
      expect(res.body.authUrl).toBeDefined();

      const authUrl = new URL(res.body.authUrl);
      expect(authUrl.host).toBe("accounts.google.com");
      expect(authUrl.searchParams.get("client_id")).toBe(ENV.GOOGLE_CLIENT_ID);
      expect(authUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.send");
      expect(authUrl.searchParams.get("access_type")).toBe("offline");
      expect(authUrl.searchParams.get("prompt")).toBe("consent");
      expect(authUrl.searchParams.get("code_challenge")).toBeDefined();
      expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authUrl.searchParams.get("state")).toBeDefined();
    });

    it("GET /api/email/oauth/callback should reject invalid or forged state", async () => {
      const res = await request(app).get("/api/email/oauth/callback?state=forged_state_123&code=mock_code");
      expect(res.status).toBe(400);
      expect(res.text).toContain("Invalid, expired, or replayed OAuth state");
    });

    it("GET /api/email/oauth/callback should complete flow, save tokens, and prevent replay attacks", async () => {
      // 1. Initiate to generate valid state
      const startRes = await adminAgent.get("/api/email/oauth/start");
      const authUrl = new URL(startRes.body.authUrl);
      const validState = authUrl.searchParams.get("state")!;
      expect(validState).toBeDefined();

      // Mock getToken and profile fetch
      const provider = EmailService.getGmailProvider();
      const client = provider.getOAuth2Client();
      vi.spyOn(client, "getToken").mockResolvedValue({
        tokens: {
          access_token: "mock_new_access_token",
          refresh_token: "mock_new_refresh_token_67890",
          scope: "https://www.googleapis.com/auth/gmail.send",
          token_type: "Bearer",
        },
        res: null,
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ emailAddress: "shareeqshaikh194@gmail.com" }),
          };
        }
        return originalFetch(url);
      });

      try {
        // 2. Perform callback
        const callbackRes = await request(app)
          .get(`/api/email/oauth/callback?state=${validState}&code=mock_auth_code_from_google`)
          .redirects(0);

        expect(callbackRes.status).toBe(302);
        expect(callbackRes.headers.location).toBe("http://localhost:5173/?tab=email&connected=true");

        // Verify tokens are stored encrypted
        const tokenData = await TokenStorageService.getDecryptedRefreshToken();
        expect(tokenData?.connectedEmail).toBe("shareeqshaikh194@gmail.com");
        expect(tokenData?.refreshToken).toBe("mock_new_refresh_token_67890");

        // 3. Replay attack attempt with same state must fail immediately (single-use)
        const replayRes = await request(app)
          .get(`/api/email/oauth/callback?state=${validState}&code=mock_auth_code_from_google`);
        expect(replayRes.status).toBe(400);
        expect(replayRes.text).toContain("Invalid, expired, or replayed OAuth state");
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("GET /api/email/gmail/status should return connected status", async () => {
      const res = await adminAgent.get("/api/email/gmail/status");
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.connectedEmail).toBe("shareeqshaikh194@gmail.com");
      expect(res.body.dailySendCap).toBe(100);
    });

    it("POST /api/email/gmail/test should send strictly to ADMIN_EMAIL, ignoring any body recipient", async () => {
      const provider = EmailService.getGmailProvider();
      let sentToRecipient = "";

      vi.spyOn(provider, "sendEmail").mockImplementation(async (options) => {
        sentToRecipient = options.to;
        return {
          success: true,
          provider: "gmail",
          messageId: "test_msg_id_123",
          dryRun: false,
        };
      });

      // Attacker attempts to send test email to arbitrary address
      const res = await adminAgent
        .post("/api/email/gmail/test")
        .send({ to: "attacker_controlled_address@evil.com" });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("shareeqshaikh194@gmail.com");
      // Recipient MUST be server-configured ADMIN_EMAIL, NOT the body address
      expect(sentToRecipient).toBe("shareeqshaikh194@gmail.com");
      expect(sentToRecipient).not.toBe("attacker_controlled_address@evil.com");
    });

    it("POST /api/email/gmail/disconnect should revoke and delete token", async () => {
      const provider = EmailService.getGmailProvider();
      const client = provider.getOAuth2Client();
      const revokeSpy = vi.spyOn(client, "revokeToken").mockResolvedValue({} as any);

      const res = await adminAgent.post("/api/email/gmail/disconnect");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(revokeSpy).toHaveBeenCalled();

      // Check status is now disconnected
      const statusRes = await adminAgent.get("/api/email/gmail/status");
      expect(statusRes.body.connected).toBe(false);
    });
  });
});
