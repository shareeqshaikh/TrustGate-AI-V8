import type {
  EmailProvider,
  SendEmailOptions,
  EmailDeliveryResult,
} from "./email-provider.interface.js";
import { ENV } from "../../config/env.js";

export class DryRunEmailProvider implements EmailProvider {
  public readonly id = "dryrun";
  public readonly name = "Dry-Run Provider (Safe Simulation)";

  async verifyConfiguration(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
    const fromAddress = options.from || `"${ENV.EMAIL_FROM_NAME}" <${ENV.EMAIL_FROM}>`;
    const preview = {
      to: options.to,
      from: fromAddress,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    };

    console.log(`\n📨 [DRY-RUN EMAIL PREVIEW] -> ${options.to}`);
    console.log(`   Subject: ${options.subject}`);
    console.log(`   From:    ${fromAddress}`);
    console.log(`   Text Snippet: ${preview.text.slice(0, 140)}...`);

    return {
      success: true,
      provider: "dryrun",
      messageId: `dryrun_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      dryRun: true,
      preview,
    };
  }

  async sendBulkEmail(batch: SendEmailOptions[]): Promise<EmailDeliveryResult[]> {
    const results: EmailDeliveryResult[] = [];
    for (const item of batch) {
      results.push(await this.sendEmail(item));
    }
    return results;
  }
}
