import { OAuth2Client } from "google-auth-library";
import { ENV } from "../../config/env.js";
import { TokenStorageService } from "./token-storage.service.js";
import type {
  EmailProvider,
  SendEmailOptions,
  EmailDeliveryResult,
} from "./email-provider.interface.js";

export class GmailEmailProvider implements EmailProvider {
  public readonly id = "gmail";
  public readonly name = "Official Gmail API (OAuth 2.0)";

  private oauth2Client: OAuth2Client | null = null;

  public getOAuth2Client(): OAuth2Client {
    if (!this.oauth2Client) {
      this.oauth2Client = new OAuth2Client(
        ENV.GOOGLE_CLIENT_ID,
        ENV.GOOGLE_CLIENT_SECRET,
        ENV.GOOGLE_REDIRECT_URI
      );
    }
    return this.oauth2Client;
  }

  async verifyConfiguration(): Promise<{ ok: boolean; error?: string }> {
    if (!ENV.GOOGLE_CLIENT_ID || !ENV.GOOGLE_CLIENT_SECRET) {
      return {
        ok: false,
        error: "Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are missing.",
      };
    }

    const tokenData = await TokenStorageService.getDecryptedRefreshToken();
    if (!tokenData || !tokenData.refreshToken) {
      return {
        ok: false,
        error: "No active Gmail account connected. Click 'Connect Gmail' to authorize.",
      };
    }

    return { ok: true };
  }

  /**
   * Safely formats and builds an RFC 2822 MIME message with strict header injection protection.
   */
  public buildMimeMessage(options: SendEmailOptions, senderEmail: string): string {
    // 1. Strict header injection protection: reject newlines in addresses
    if (/[\r\n]/.test(options.to)) {
      throw new Error("Recipient address contains invalid control characters (CRLF injection prevented).");
    }

    const fromAddress = options.from || `"${ENV.EMAIL_FROM_NAME}" <${senderEmail}>`;
    if (/[\r\n]/.test(fromAddress)) {
      throw new Error("Sender address contains invalid control characters (CRLF injection prevented).");
    }

    // 2. Clean subject: remove newlines and encode with RFC 2047
    const cleanSubject = options.subject.replace(/[\r\n]/g, " ").trim();
    const encodedSubject = `=?UTF-8?B?${Buffer.from(cleanSubject, "utf8").toString("base64")}?=`;

    // 3. Encode body in base64
    const base64Body = Buffer.from(options.html, "utf8").toString("base64");

    const mimeLines = [
      `From: ${fromAddress}`,
      `To: ${options.to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ];

    if (options.replyTo && !/[\r\n]/.test(options.replyTo)) {
      mimeLines.push(`Reply-To: ${options.replyTo}`);
    }

    if (options.idempotencyKey) {
      mimeLines.push(`X-TrustGate-Idempotency: ${options.idempotencyKey}`);
    }

    mimeLines.push("", base64Body);
    return mimeLines.join("\r\n");
  }

  /**
   * Sends an email via Gmail API with token refresh and exponential backoff.
   */
  async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
    const tokenData = await TokenStorageService.getDecryptedRefreshToken();
    if (!tokenData) {
      return {
        success: false,
        provider: "gmail",
        dryRun: false,
        errorMessage: "Gmail account is not connected. Please authorize Gmail in settings.",
      };
    }

    // Check daily send quota
    const quota = await TokenStorageService.checkAndConsumeQuota();
    if (!quota.allowed) {
      await TokenStorageService.recordSendResult(false, quota.reason);
      return {
        success: false,
        provider: "gmail",
        dryRun: false,
        errorMessage: quota.reason || "Daily Gmail send limit reached.",
      };
    }

    const client = this.getOAuth2Client();
    client.setCredentials({
      refresh_token: tokenData.refreshToken,
    });

    let rawMime: string;
    try {
      rawMime = this.buildMimeMessage(options, tokenData.connectedEmail);
    } catch (err: any) {
      return {
        success: false,
        provider: "gmail",
        dryRun: false,
        errorMessage: err.message,
      };
    }

    // Base64url encode for Gmail API
    const base64urlMime = Buffer.from(rawMime)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Exponential backoff retry loop for 429 and 5xx errors
    const maxRetries = 3;
    let attempt = 0;
    let lastError = "";

    while (attempt <= maxRetries) {
      try {
        const accessTokenResponse = await client.getAccessToken();
        const accessToken = accessTokenResponse.token;
        if (!accessToken) {
          throw new Error("Failed to obtain Gmail access token from refresh token.");
        }

        const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: base64urlMime }),
        });

        if (response.ok) {
          const data: any = await response.json();
          await TokenStorageService.recordSendResult(true);
          return {
            success: true,
            provider: "gmail",
            messageId: data.id,
            dryRun: false,
          };
        }

        // Handle specific error codes
        if (response.status === 401) {
          // Token expired, force refresh once
          if (attempt === 0) {
            attempt++;
            continue;
          }
          lastError = "Gmail authorization expired or was revoked (invalid_grant). Needs reconnect.";
          break;
        }

        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          // Rate limit or server error: wait with exponential backoff
          attempt++;
          if (attempt <= maxRetries) {
            const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
        }

        const errData: any = await response.json().catch(() => ({}));
        lastError =
          errData?.error?.message || `Gmail API HTTP ${response.status}: Failed to send email`;
        break;
      } catch (err: any) {
        lastError = err.message || "Failed to communicate with Gmail API";
        if (err.message?.includes("invalid_grant")) {
          lastError = "Gmail authorization expired or was revoked (invalid_grant). Needs reconnect.";
          break;
        }
        attempt++;
        if (attempt <= maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          break;
        }
      }
    }

    await TokenStorageService.recordSendResult(false, lastError);
    return {
      success: false,
      provider: "gmail",
      dryRun: false,
      errorMessage: lastError,
    };
  }

  /**
   * Bulk sends with 600ms pacing between messages to respect Gmail personal quota.
   */
  async sendBulkEmail(batch: SendEmailOptions[]): Promise<EmailDeliveryResult[]> {
    const results: EmailDeliveryResult[] = [];
    for (let i = 0; i < batch.length; i++) {
      const result = await this.sendEmail(batch[i]);
      results.push(result);

      // Stop immediately if daily cap exceeded
      if (result.errorMessage?.includes("Daily Gmail send limit reached")) {
        console.warn("[GmailEmailProvider] Bulk sending halted: daily cap reached.");
        break;
      }

      // 600ms pacing between emails if not the last item
      if (i < batch.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
    return results;
  }
}
