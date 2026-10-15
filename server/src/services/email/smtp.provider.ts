import nodemailer from "nodemailer";
import type {
  EmailProvider,
  SendEmailOptions,
  EmailDeliveryResult,
} from "./email-provider.interface.js";
import { ENV } from "../../config/env.js";

export class SmtpEmailProvider implements EmailProvider {
  public readonly id = "smtp";
  public readonly name = "SMTP Provider (Nodemailer)";

  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      if (!ENV.SMTP_HOST || !ENV.SMTP_USER || !ENV.SMTP_PASS) {
        throw new Error("SMTP is not properly configured. Missing host, user, or pass.");
      }
      this.transporter = nodemailer.createTransport({
        host: ENV.SMTP_HOST,
        port: ENV.SMTP_PORT,
        secure: ENV.SMTP_PORT === 465,
        auth: {
          user: ENV.SMTP_USER,
          pass: ENV.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  async verifyConfiguration(): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!ENV.SMTP_HOST || !ENV.SMTP_USER || !ENV.SMTP_PASS) {
        return {
          ok: false,
          error: "Incomplete SMTP settings (host, user, or app password missing).",
        };
      }
      const transport = this.getTransporter();
      await transport.verify();
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        error: `SMTP verification failed: ${err.message || "Unknown error"}`,
      };
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
    try {
      const transport = this.getTransporter();
      const fromAddress = options.from || `"${ENV.EMAIL_FROM_NAME}" <${ENV.EMAIL_FROM}>`;

      const info = await transport.sendMail({
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo,
        headers: options.headers,
      });

      return {
        success: true,
        provider: "smtp",
        messageId: info.messageId,
        dryRun: false,
      };
    } catch (err: any) {
      return {
        success: false,
        provider: "smtp",
        dryRun: false,
        errorMessage: err.message || "SMTP sending failed",
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
