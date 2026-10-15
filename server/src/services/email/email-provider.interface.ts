export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface EmailDeliveryResult {
  success: boolean;
  provider: string;
  messageId?: string;
  dryRun: boolean;
  errorMessage?: string;
  preview?: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
  };
}

export interface EmailProvider {
  readonly id: string;
  readonly name: string;
  verifyConfiguration(): Promise<{ ok: boolean; error?: string }>;
  sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult>;
  sendBulkEmail(batch: SendEmailOptions[]): Promise<EmailDeliveryResult[]>;
}
