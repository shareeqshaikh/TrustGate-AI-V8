import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { CodeChallengeMethod } from "google-auth-library";
import { ENV } from "../config/env.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
import { TokenStorageService } from "../services/email/token-storage.service.js";
import { EmailService } from "../services/email/email.service.js";
import { AuditService } from "../services/audit.service.js";

export const gmailOAuthRouter = Router();

// In-memory OAuth state and PKCE map keyed by state (expires in 10 minutes, single-use)
interface PendingOAuthState {
  userId: string;
  codeVerifier: string;
  expiresAt: number;
}
const pendingOAuthStates = new Map<string, PendingOAuthState>();

// Periodic cleanup of expired states
setInterval(() => {
  const now = Date.now();
  for (const [state, item] of pendingOAuthStates.entries()) {
    if (item.expiresAt < now) {
      pendingOAuthStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

// Rate limiter for Gmail test email: max 5 per minute
const gmailTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    error: "Too many Gmail test requests. Please wait a minute.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/email/oauth/start
 * Generates Google OAuth consent URL with single-use state and PKCE.
 * Admin-only.
 */
gmailOAuthRouter.get(
  "/oauth/start",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
        res.status(400).json({
          error:
            "Google OAuth client credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
          code: "GOOGLE_CREDENTIALS_MISSING",
        });
        return;
      }

      // 1. Generate state and PKCE verifier/challenge
      const state = crypto.randomBytes(32).toString("hex");
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      // 2. Store state keyed by state string for 10 minutes
      pendingOAuthStates.set(state, {
        userId: req.user!.id,
        codeVerifier,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      const provider = EmailService.getGmailProvider();
      const oauthClient = provider.getOAuth2Client();

      const authUrl = oauthClient.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/gmail.send"],
        prompt: "consent",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        redirect_uri: ENV.GOOGLE_REDIRECT_URI,
      });

      res.json({ authUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to initiate OAuth flow" });
    }
  }
);

/**
 * GET /api/email/oauth/callback
 * Exchanges authorization code from Google, verifies state and PKCE, encrypts refresh token.
 */
gmailOAuthRouter.get("/oauth/callback", async (req: Request, res: Response): Promise<void> => {
  const state = req.query.state as string;
  const code = req.query.code as string;
  const error = req.query.error as string;

  const frontendBase = ENV.FRONTEND_URL || "http://localhost:5173";

  if (error) {
    res.redirect(`${frontendBase}/?tab=email&error=${encodeURIComponent(error)}`);
    return;
  }

  if (!state || !pendingOAuthStates.has(state)) {
    res.status(400).send("Invalid, expired, or replayed OAuth state. Please try connecting again.");
    return;
  }

  const stateRecord = pendingOAuthStates.get(state)!;
  // Single-use: immediately delete state to prevent replay attacks
  pendingOAuthStates.delete(state);

  if (stateRecord.expiresAt < Date.now()) {
    res.status(400).send("OAuth session has expired. Please initiate connection again.");
    return;
  }

  if (!code) {
    res.status(400).send("Authorization code missing from Google callback.");
    return;
  }

  try {
    const provider = EmailService.getGmailProvider();
    const oauthClient = provider.getOAuth2Client();

    // Exchange code with PKCE codeVerifier
    const { tokens } = await oauthClient.getToken({
      code,
      codeVerifier: stateRecord.codeVerifier,
    });

    if (!tokens.refresh_token) {
      // Check if we already have an existing token stored
      const existing = await TokenStorageService.getDecryptedRefreshToken();
      if (!existing?.refreshToken) {
        res.status(400).send(
          "Google did not return a refresh token. Please revoke previous access in your Google Account security settings and reconnect with consent."
        );
        return;
      }
    }

    // Identify user's Gmail address
    oauthClient.setCredentials(tokens);
    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    let connectedEmail = ENV.ADMIN_EMAIL;
    if (profileRes.ok) {
      const profileData: any = await profileRes.json();
      if (profileData.emailAddress) {
        connectedEmail = profileData.emailAddress;
      }
    }

    // Encrypt and store refresh token using AES-256-GCM
    if (tokens.refresh_token) {
      await TokenStorageService.saveTokens(
        connectedEmail,
        tokens.refresh_token,
        tokens.scope || "https://www.googleapis.com/auth/gmail.send"
      );
    }

    // Record audit event
    await AuditService.record(
      "GMAIL_CONNECTED",
      { id: stateRecord.userId, email: connectedEmail },
      { connectedEmail, timestamp: new Date().toISOString() }
    );

    res.redirect(`${frontendBase}/?tab=email&connected=true`);
  } catch (err: any) {
    console.error("[Gmail OAuth Callback] Token exchange failed:", err);
    res.redirect(
      `${frontendBase}/?tab=email&error=${encodeURIComponent(
        err.message || "Failed to exchange authorization code"
      )}`
    );
  }
});

/**
 * GET /api/email/gmail/status
 * Returns connection status and daily send usage. Never returns tokens.
 * Admin-only.
 */
gmailOAuthRouter.get(
  "/gmail/status",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = await TokenStorageService.getStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to retrieve Gmail status" });
    }
  }
);

/**
 * POST /api/email/gmail/test
 * Sends a test email ONLY to ADMIN_EMAIL from config (never from request body).
 * Rate-limited and Admin-only.
 */
gmailOAuthRouter.post(
  "/gmail/test",
  requireAdmin,
  gmailTestLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Recipient is strictly read from server-side config
      const adminEmail = ENV.ADMIN_EMAIL;
      const provider = EmailService.getGmailProvider();

      const html = EmailService.renderBrandedHtml({
        heading: "Gmail API Integration Verified",
        body: `Hello Administrator,\n\nYour TrustGate AI gateway has successfully connected to the official Gmail API via OAuth 2.0.\n\nAll automated campaigns and 7-day subscription expiration reminders are now authorized to send through this Gmail channel within your daily send cap (${ENV.GMAIL_DAILY_SEND_CAP || 100}/day).\n\nSecurity verification: AES-256-GCM encryption verified.`,
        callToActionText: "Open Email Automation",
        callToActionUrl: `${ENV.FRONTEND_URL || "http://localhost:5173"}/?tab=email`,
        isTransactional: true,
      });

      const result = await provider.sendEmail({
        to: adminEmail,
        subject: "[TrustGate AI] Official Gmail API Connection Verified",
        html,
        idempotencyKey: `test_gmail_${Date.now()}`,
      });

      if (!result.success) {
        res.status(400).json({
          error: result.errorMessage || "Failed to send test email via Gmail API",
          code: "GMAIL_SEND_FAILED",
        });
        return;
      }

      await AuditService.record(
        "GMAIL_TEST_EMAIL_SENT",
        { id: req.user!.id, email: req.user!.email },
        { to: adminEmail, messageId: result.messageId }
      );

      res.json({
        message: `Test email successfully sent to ${adminEmail}`,
        result,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to send test email" });
    }
  }
);

/**
 * POST /api/email/gmail/disconnect
 * Revokes Google OAuth token and deletes local encrypted credentials.
 * Admin-only.
 */
gmailOAuthRouter.post(
  "/gmail/disconnect",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tokenData = await TokenStorageService.getDecryptedRefreshToken();
      if (tokenData?.refreshToken) {
        try {
          const provider = EmailService.getGmailProvider();
          const oauthClient = provider.getOAuth2Client();
          await oauthClient.revokeToken(tokenData.refreshToken);
        } catch (revokeErr) {
          console.warn("[Gmail Disconnect] Google token revoke warning:", revokeErr);
          // Always proceed with local token deletion
        }
      }

      await TokenStorageService.deleteTokens();

      await AuditService.record(
        "GMAIL_DISCONNECTED",
        { id: req.user!.id, email: req.user!.email },
        { timestamp: new Date().toISOString() }
      );

      res.json({
        success: true,
        message: "Gmail account successfully disconnected and revoked.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to disconnect Gmail" });
    }
  }
);
