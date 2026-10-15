import crypto from "node:crypto";
import { ENV } from "../../config/env.js";
import type {
  User,
  EmailCampaign,
  EmailRecipientGroup,
  EmailDeliveryLog,
  Subscription,
  PlanConfig,
} from "../../types/index.js";
import {
  usersRepo,
  subscriptionsRepo,
  campaignsRepo,
  emailLogsRepo,
} from "../../storage/json-repository.js";
import { AuditService } from "../audit.service.js";
import type { EmailProvider, EmailDeliveryResult } from "./email-provider.interface.js";
import { DryRunEmailProvider } from "./dry-run.provider.js";
import { SmtpEmailProvider } from "./smtp.provider.js";
import { ResendEmailProvider } from "./resend.provider.js";
import { GmailEmailProvider } from "./gmail.provider.js";

export function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface RenderTemplateOptions {
  heading: string;
  body: string;
  callToActionText?: string;
  callToActionUrl?: string;
  unsubscribeUrl?: string;
  isTransactional?: boolean;
}

export class EmailService {
  private static dryRunProvider = new DryRunEmailProvider();
  private static smtpProvider = new SmtpEmailProvider();
  private static resendProvider = new ResendEmailProvider();
  private static gmailProvider = new GmailEmailProvider();

  public static getGmailProvider(): GmailEmailProvider {
    return this.gmailProvider;
  }

  public static getActiveProvider(): EmailProvider {
    if (ENV.EMAIL_DRY_RUN || ENV.EMAIL_PROVIDER === "dryrun") {
      return this.dryRunProvider;
    }
    if (ENV.EMAIL_PROVIDER === "gmail") {
      return this.gmailProvider;
    }
    if (ENV.EMAIL_PROVIDER === "smtp") {
      return this.smtpProvider;
    }
    if (ENV.EMAIL_PROVIDER === "resend") {
      return this.resendProvider;
    }
    return this.dryRunProvider;
  }

  public static async getProviderStatus(): Promise<{
    provider: string;
    dryRun: boolean;
    configured: boolean;
    details: string;
  }> {
    const provider = this.getActiveProvider();
    const dryRun = ENV.EMAIL_DRY_RUN || provider.id === "dryrun";

    if (provider.id === "dryrun") {
      return {
        provider: "dryrun",
        dryRun: true,
        configured: true,
        details: "Dry-run simulation mode is active. Previews are logged; no real emails sent.",
      };
    }

    const check = await provider.verifyConfiguration();
    return {
      provider: provider.id,
      dryRun,
      configured: check.ok,
      details: check.error || `Connected via ${provider.name}`,
    };
  }

  public static renderBrandedHtml(options: RenderTemplateOptions): string {
    const safeHeading = escapeHtml(options.heading);
    const safeBody = options.body
      .split("\n")
      .map((line) => `<p style="margin: 0 0 16px; line-height: 1.6; color: #cbd5e1;">${escapeHtml(line)}</p>`)
      .join("");

    const ctaButton =
      options.callToActionText && options.callToActionUrl
        ? `
        <div style="margin: 28px 0 32px; text-align: center;">
          <a href="${escapeHtml(options.callToActionUrl)}" style="background: #10b981; color: #020617; font-weight: 700; font-size: 14px; text-decoration: none; padding: 12px 28px; border-radius: 8px; display: inline-block; letter-spacing: 0.5px;">
            ${escapeHtml(options.callToActionText)}
          </a>
        </div>
      `
        : "";

    const footerText = options.isTransactional
      ? `<p style="margin: 0; color: #64748b; font-size: 12px;">This is a critical transactional notification regarding your active TrustGate subscription. It is not a promotional email.</p>`
      : options.unsubscribeUrl
      ? `<p style="margin: 0; color: #64748b; font-size: 12px;">You received this because you opted in to TrustGate product updates. <a href="${escapeHtml(
          options.unsubscribeUrl
        )}" style="color: #10b981; text-decoration: underline;">Unsubscribe from marketing emails</a></p>`
      : `<p style="margin: 0; color: #64748b; font-size: 12px;">TrustGate AI Security & Gateway</p>`;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeHeading}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #020617; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #020617; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #0f172a; border-radius: 12px; border: 1px solid #1e293b; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 32px; border-bottom: 1px solid #1e293b; background: linear-gradient(to right, #090d16, #0f172a);">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left">
                    <span style="font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">TrustGate</span>
                    <span style="font-size: 10px; font-weight: 700; color: #10b981; background: #064e3b; padding: 2px 6px; border-radius: 4px; margin-left: 6px; border: 1px solid #047857; text-transform: uppercase;">Lite</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px 28px;">
              <h1 style="margin: 0 0 20px; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3;">${safeHeading}</h1>
              ${safeBody}
              ${ctaButton}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #090d16; border-top: 1px solid #1e293b; text-align: center;">
              ${footerText}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  /**
   * Generates or retrieves an unsubscribe token for a user.
   */
  public static async getOrCreateUnsubscribeToken(user: User): Promise<string> {
    if (user.emailPreferences?.unsubscribeToken) {
      return user.emailPreferences.unsubscribeToken;
    }
    const token = crypto.randomBytes(32).toString("hex");
    const updatedPreferences = {
      promotional: user.emailPreferences?.promotional ?? true,
      unsubscribeToken: token,
      unsubscribedAt: user.emailPreferences?.unsubscribedAt,
    };
    await usersRepo.update(user.id, { emailPreferences: updatedPreferences });
    return token;
  }

  /**
   * Resolves recipient list based on recipientGroup and promotional consent.
   */
  public static async resolveRecipients(
    group: EmailRecipientGroup,
    selectedUserIds?: string[],
    isPromotional = true
  ): Promise<User[]> {
    const allUsers = await usersRepo.getAll();
    const allSubscriptions = await subscriptionsRepo.getAll();

    // Users with active subscriptions
    const activeUserIds = new Set(
      allSubscriptions.filter((s) => s.status === "ACTIVE").map((s) => s.userId)
    );

    // Users whose subscriptions expired and have no active one
    const expiredUserIds = new Set(
      allSubscriptions
        .filter((s) => s.status === "EXPIRED" && !activeUserIds.has(s.userId))
        .map((s) => s.userId)
    );

    let candidates: User[] = [];

    switch (group) {
      case "ALL_ELIGIBLE":
        candidates = allUsers;
        break;
      case "ACTIVE_SUBSCRIBERS":
        candidates = allUsers.filter((u) => activeUserIds.has(u.id));
        break;
      case "EXPIRED_SUBSCRIBERS":
        candidates = allUsers.filter((u) => expiredUserIds.has(u.id));
        break;
      case "SELECTED_USERS":
        const selectedSet = new Set(selectedUserIds || []);
        candidates = allUsers.filter((u) => selectedSet.has(u.id));
        break;
      default:
        candidates = [];
    }

    // Filter valid email formats and promotional consent
    return candidates.filter((u) => {
      if (!u.email || !u.email.includes("@")) return false;
      if (isPromotional && u.emailPreferences?.promotional === false) {
        return false;
      }
      return true;
    });
  }

  /**
   * Dispatches a campaign to resolved recipients.
   * Enforces idempotency and logs delivery.
   */
  public static async sendCampaign(
    campaignId: string,
    adminUser: User,
    dryRunOverride?: boolean
  ): Promise<{ campaign: EmailCampaign; results: EmailDeliveryResult[] }> {
    const campaign = await campaignsRepo.getById(campaignId);
    if (!campaign) {
      throw new Error("Campaign not found");
    }

    if (campaign.status === "SENT" || campaign.status === "SENDING") {
      throw new Error(`Campaign is already in ${campaign.status} status.`);
    }

    // Mark as SENDING atomically
    await campaignsRepo.update(campaign.id, { status: "SENDING" });

    const isDryRun = dryRunOverride ?? (ENV.EMAIL_DRY_RUN || ENV.EMAIL_PROVIDER === "dryrun");
    const provider = isDryRun ? this.dryRunProvider : this.getActiveProvider();

    const recipients = await this.resolveRecipients(
      campaign.recipientGroup,
      campaign.selectedUserIds,
      true // Promotional campaign honors opt-out
    );

    const deliveryResults: EmailDeliveryResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    const baseUrl = ENV.PUBLIC_BASE_URL || "http://localhost:4000";

    for (const recipient of recipients) {
      const unsubToken = await this.getOrCreateUnsubscribeToken(recipient);
      const unsubscribeUrl = `${baseUrl}/api/v1/unsubscribe/${unsubToken}`;

      const html = this.renderBrandedHtml({
        heading: campaign.heading,
        body: campaign.body,
        callToActionText: campaign.callToActionText,
        callToActionUrl: campaign.callToActionUrl,
        unsubscribeUrl,
        isTransactional: false,
      });

      const idempotencyKey = `cmp_${campaign.id}_${recipient.id}`;

      try {
        const result = await provider.sendEmail({
          to: recipient.email,
          subject: campaign.subject,
          html,
          idempotencyKey,
        });

        deliveryResults.push(result);
        if (result.success) {
          sentCount++;
        } else {
          failedCount++;
        }

        // Record log
        const logEntry: EmailDeliveryLog = {
          id: `log_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
          type: "CAMPAIGN",
          campaignId: campaign.id,
          recipientEmail: recipient.email,
          recipientUserId: recipient.id,
          recipientName: recipient.name,
          subject: campaign.subject,
          provider: provider.id,
          status: result.dryRun ? "DRY_RUN" : result.success ? "DELIVERED" : "FAILED",
          previewText: result.preview?.text,
          errorMessage: result.errorMessage,
          attempt: 1,
          idempotencyKey,
          timestamp: new Date().toISOString(),
        };
        await emailLogsRepo.create(logEntry);
      } catch (err: any) {
        failedCount++;
        const logEntry: EmailDeliveryLog = {
          id: `log_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
          type: "CAMPAIGN",
          campaignId: campaign.id,
          recipientEmail: recipient.email,
          recipientUserId: recipient.id,
          recipientName: recipient.name,
          subject: campaign.subject,
          provider: provider.id,
          status: "FAILED",
          errorMessage: err.message || "Dispatch error",
          attempt: 1,
          idempotencyKey,
          timestamp: new Date().toISOString(),
        };
        await emailLogsRepo.create(logEntry);
      }
    }

    const updated = await campaignsRepo.update(campaign.id, {
      status: "SENT",
      totalRecipients: recipients.length,
      sentCount,
      failedCount,
      dryRun: isDryRun,
      sentAt: new Date().toISOString(),
    });

    // Record audit chain event
    await AuditService.record(
      "EMAIL_CAMPAIGN_SENT",
      { id: adminUser.id, email: adminUser.email },
      {
        campaignId: campaign.id,
        name: campaign.name,
        recipientGroup: campaign.recipientGroup,
        totalRecipients: recipients.length,
        sentCount,
        failedCount,
        dryRun: isDryRun,
      }
    );

    return { campaign: updated!, results: deliveryResults };
  }

  /**
   * Sends a test email to a single recipient.
   */
  public static async sendTestEmail(
    toEmail: string,
    subject: string,
    heading: string,
    body: string,
    callToActionText?: string,
    callToActionUrl?: string
  ): Promise<EmailDeliveryResult> {
    const provider = this.getActiveProvider();
    const isDryRun = ENV.EMAIL_DRY_RUN || provider.id === "dryrun";

    const html = this.renderBrandedHtml({
      heading: `[TEST] ${heading}`,
      body,
      callToActionText,
      callToActionUrl,
      isTransactional: true, // test email doesn't need marketing unsubscribe
    });

    const result = await provider.sendEmail({
      to: toEmail,
      subject: `[TEST] ${subject}`,
      html,
    });

    // Record log
    const logEntry: EmailDeliveryLog = {
      id: `log_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
      type: "TEST",
      recipientEmail: toEmail,
      subject: `[TEST] ${subject}`,
      provider: provider.id,
      status: result.dryRun ? "DRY_RUN" : result.success ? "DELIVERED" : "FAILED",
      previewText: result.preview?.text,
      errorMessage: result.errorMessage,
      attempt: 1,
      idempotencyKey: `test_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    await emailLogsRepo.create(logEntry);

    return result;
  }
}
