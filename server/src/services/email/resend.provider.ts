import type {
  EmailProvider,
  SendEmailOptions,
  EmailDeliveryResult,
} from "./email-provider.interface.js";
import { ENV } from "../../config/env.js";

export class ResendEmailProvider implements EmailProvider {
  public readonly id = "resend";
  public readonly name = "Resend API Provider";

  async verifyConfiguration(): Promise<{ ok: boolean; error?: string }> {
    if (!ENV.EMAIL_API_KEY) {
      return { ok: false, error: "EMAIL_API_KEY is not configured." };
    }
    return { ok: true };
  }

  async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
    if (!ENV.EMAIL_API_KEY) {
      return {
        success: false,
        provider: "resend",
        dryRun: false,
        errorMessage: "Resend API Key is not configured.",
      };
    }

    try {
      const fromAddress = options.from || `"${ENV.EMAIL_FROM_NAME}" <${ENV.EMAIL_FROM}>`;

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.EMAIL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
          reply_to: options.replyTo,
          headers: options.headers,
        }),
      });

      const data: any = await response.json();
      if (!response.ok) {
        return {
          success: false,
          provider: "resend",
          dryRun: false,
          errorMessage: data?.message || `HTTP ${response.status}: Failed to send email via Resend`,
        };
      }

      return {
        success: true,
        provider: "resend",
        messageId: data.id,
        dryRun: false,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: "resend",
        dryRun: false,
        errorMessage: err.message || "Failed to call Resend API",
      };
    }
  }

  async sendBulkEmail(batch: SendEmailOptions[]): Promise<EmailDeliveryResult[]> {
    const results: EmailDeliveryResult[] = [];
    for (const item of batch) {
      results.push(await this.sendEmail(item));
    }
    return results;
  }
}
