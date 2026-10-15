import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { campaignsRepo, remindersRepo, emailLogsRepo, usersRepo } from "../storage/json-repository.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
import { EmailService } from "../services/email/email.service.js";
import { EmailAgentService, EmailDraftRequestSchema } from "../services/email-agent.service.js";
import { ReminderSchedulerService } from "../services/reminder-scheduler.service.js";
import type { EmailCampaign, EmailRecipientGroup } from "../types/index.js";

export const emailCampaignRouter = Router();

// Apply requireAdmin to all routes in this router
emailCampaignRouter.use(requireAdmin);

// Rate limiter for test emails: max 5 requests per minute
const testEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many test emails requested. Please wait a minute.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for sending campaigns: max 3 requests per minute
const sendCampaignLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: "Campaign dispatch rate limit reached. Please wait a minute.", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/v1/admin/email/status - Check email provider status
emailCampaignRouter.get("/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await EmailService.getProviderStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to check email status" });
  }
});

// GET /api/v1/admin/email/campaigns - List campaigns
emailCampaignRouter.get("/campaigns", async (_req: Request, res: Response): Promise<void> => {
  const campaigns = await campaignsRepo.getAll();
  res.json({ campaigns: campaigns.reverse() });
});

const CampaignInputSchema = z.object({
  name: z.string().min(2).max(100),
  subject: z.string().min(2).max(200),
  heading: z.string().min(2).max(100),
  body: z.string().min(5).max(10000),
  callToActionText: z.string().max(50).optional(),
  callToActionUrl: z.string().url().optional().or(z.literal("")),
  recipientGroup: z.enum([
    "ALL_ELIGIBLE",
    "ACTIVE_SUBSCRIBERS",
    "EXPIRED_SUBSCRIBERS",
    "SELECTED_USERS",
  ]),
  selectedUserIds: z.array(z.string()).optional(),
  aiDrafted: z.boolean().default(false),
});

// POST /api/v1/admin/email/campaigns - Create a new campaign draft
emailCampaignRouter.post("/campaigns", async (req: Request, res: Response): Promise<void> => {
  try {
    const data = CampaignInputSchema.parse(req.body);
    const id = `cmp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

    // Calculate eligible recipients preview
    const recipients = await EmailService.resolveRecipients(
      data.recipientGroup as EmailRecipientGroup,
      data.selectedUserIds,
      true
    );

    const campaign: EmailCampaign = {
      id,
      name: data.name,
      subject: data.subject,
      heading: data.heading,
      body: data.body,
      callToActionText: data.callToActionText || undefined,
      callToActionUrl: data.callToActionUrl || undefined,
      recipientGroup: data.recipientGroup as EmailRecipientGroup,
      selectedUserIds: data.selectedUserIds,
      status: "DRAFT",
      totalRecipients: recipients.length,
      sentCount: 0,
      failedCount: 0,
      idempotencyKey: `cmp_${id}`,
      dryRun: true,
      aiDrafted: data.aiDrafted,
      createdByAdminId: req.user!.id,
      createdAt: new Date().toISOString(),
    };

    const created = await campaignsRepo.create(campaign);
    res.status(201).json({ campaign: created });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input" });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to create campaign" });
  }
});

// GET /api/v1/admin/email/campaigns/:id - Get a single campaign
emailCampaignRouter.get("/campaigns/:id", async (req: Request, res: Response): Promise<void> => {
  const campaign = await campaignsRepo.getById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ campaign });
});

// PUT /api/v1/admin/email/campaigns/:id - Edit an un-sent campaign draft
emailCampaignRouter.put("/campaigns/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const campaign = await campaignsRepo.getById(req.params.id);
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (campaign.status === "SENT" || campaign.status === "SENDING") {
      res.status(400).json({ error: "Cannot edit a campaign that has already been sent." });
      return;
    }

    const data = CampaignInputSchema.partial().parse(req.body);

    const group = (data.recipientGroup || campaign.recipientGroup) as EmailRecipientGroup;
    const selectedIds = data.selectedUserIds || campaign.selectedUserIds;
    const recipients = await EmailService.resolveRecipients(group, selectedIds, true);

    const updated = await campaignsRepo.update(campaign.id, {
      ...data,
      totalRecipients: recipients.length,
    });

    res.json({ campaign: updated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input" });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to update campaign" });
  }
});

// DELETE /api/v1/admin/email/campaigns/:id - Delete a draft campaign
emailCampaignRouter.delete("/campaigns/:id", async (req: Request, res: Response): Promise<void> => {
  const campaign = await campaignsRepo.getById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.status === "SENDING") {
    res.status(400).json({ error: "Cannot delete a campaign while it is currently sending." });
    return;
  }

  await campaignsRepo.delete(campaign.id);
  res.json({ message: "Campaign deleted successfully." });
});

// POST /api/v1/admin/email/recipients/count - Preview recipient count
emailCampaignRouter.post("/recipients/count", async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      recipientGroup: z.enum([
        "ALL_ELIGIBLE",
        "ACTIVE_SUBSCRIBERS",
        "EXPIRED_SUBSCRIBERS",
        "SELECTED_USERS",
      ]),
      selectedUserIds: z.array(z.string()).optional(),
    });
    const { recipientGroup, selectedUserIds } = schema.parse(req.body);

    const recipients = await EmailService.resolveRecipients(
      recipientGroup as EmailRecipientGroup,
      selectedUserIds,
      true
    );

    res.json({
      count: recipients.length,
      sampleEmails: recipients.slice(0, 5).map((r) => r.email),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to calculate recipient count" });
  }
});

// POST /api/v1/admin/email/generate-draft - AI Draft Generator using Ollama
emailCampaignRouter.post("/generate-draft", async (req: Request, res: Response): Promise<void> => {
  try {
    const validated = EmailDraftRequestSchema.parse(req.body);
    const draft = await EmailAgentService.generateDraft(validated);
    res.json({ draft });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid draft parameters" });
      return;
    }
    res.status(500).json({ error: err.message || "Draft generation failed" });
  }
});

// POST /api/v1/admin/email/test - Send a test email (Rate limited)
emailCampaignRouter.post("/test", testEmailLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const TestSchema = z.object({
      toEmail: z.string().email(),
      subject: z.string().min(1),
      heading: z.string().min(1),
      body: z.string().min(1),
      callToActionText: z.string().optional(),
      callToActionUrl: z.string().url().optional().or(z.literal("")),
    });

    const data = TestSchema.parse(req.body);
    const result = await EmailService.sendTestEmail(
      data.toEmail,
      data.subject,
      data.heading,
      data.body,
      data.callToActionText,
      data.callToActionUrl || undefined
    );

    res.json({
      message: result.dryRun ? "Test email generated in DRY-RUN mode (safe preview)" : "Test email sent successfully",
      result,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message || "Invalid input" });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to send test email" });
  }
});

// POST /api/v1/admin/email/campaigns/:id/send - Dispatch campaign (Rate limited, idempotent)
emailCampaignRouter.post(
  "/campaigns/:id/send",
  sendCampaignLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const dryRunOverride = typeof req.body?.dryRun === "boolean" ? req.body.dryRun : undefined;
      const { campaign, results } = await EmailService.sendCampaign(
        req.params.id,
        req.user!,
        dryRunOverride
      );

      res.json({
        message: campaign.dryRun
          ? `Campaign simulated in DRY-RUN mode across ${campaign.totalRecipients} recipients.`
          : `Campaign successfully dispatched to ${campaign.sentCount} recipients.`,
        campaign,
        resultsPreview: results.slice(0, 5),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to send campaign" });
    }
  }
);

// GET /api/v1/admin/email/reminders - List upcoming subscription expiry reminders
emailCampaignRouter.get("/reminders", async (_req: Request, res: Response): Promise<void> => {
  const reminders = await remindersRepo.getAll();
  res.json({ reminders: reminders.reverse() });
});

// POST /api/v1/admin/email/reminders/trigger - Manually trigger reminder scan
emailCampaignRouter.post("/reminders/trigger", async (_req: Request, res: Response): Promise<void> => {
  try {
    const stats = await ReminderSchedulerService.runReminderScan(true);
    res.json({
      message: "Manual reminder scan completed.",
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to run reminder scan" });
  }
});

// GET /api/v1/admin/email/logs - Paginated email delivery logs
emailCampaignRouter.get("/logs", async (req: Request, res: Response): Promise<void> => {
  const allLogs = await emailLogsRepo.getAll();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const sorted = allLogs.reverse();
  const total = sorted.length;
  const startIndex = (page - 1) * limit;
  const logs = sorted.slice(startIndex, startIndex + limit);

  res.json({
    logs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});
