import crypto from "node:crypto";
import { Mutex } from "async-mutex";
import { ENV } from "../config/env.js";
import {
  subscriptionsRepo,
  usersRepo,
  remindersRepo,
  emailLogsRepo,
} from "../storage/json-repository.js";
import { PLANS, type Subscription, type User, type SubscriptionReminderRecord } from "../types/index.js";
import { EmailService } from "./email/email.service.js";

export class ReminderSchedulerService {
  private static workerMutex = new Mutex();
  private static intervalHandle: NodeJS.Timeout | null = null;
  private static serviceStartTime: Date = new Date();

  /**
   * Initializes the recurring reminder scanner.
   */
  public static startScheduler(intervalMs = 60 * 60 * 1000): void {
    this.serviceStartTime = new Date();
    console.log("⏰ [Reminder Scheduler] Initialized background worker.");

    // Initial check after 5 seconds to let the server finish startup
    setTimeout(() => {
      this.runReminderScan(false).catch((err) => {
        console.error("⏰ [Reminder Scheduler] Error in startup scan:", err);
      });
    }, 5000);

    // Periodic check
    this.intervalHandle = setInterval(() => {
      this.runReminderScan(false).catch((err) => {
        console.error("⏰ [Reminder Scheduler] Error in recurring scan:", err);
      });
    }, intervalMs);
  }

  public static stopScheduler(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Scans active subscriptions and sends 7-day expiration reminders.
   * Mutex-protected to ensure only one worker claims jobs at a time.
   */
  public static async runReminderScan(isManualTrigger = false): Promise<{
    scanned: number;
    reminded: number;
    skipped: number;
    errors: number;
  }> {
    return this.workerMutex.runExclusive(async () => {
      const now = new Date();
      const reminderDays = ENV.REMINDER_DAYS_BEFORE || 7;
      const targetWindowMs = reminderDays * 24 * 60 * 60 * 1000;
      // Allow a 24-hour bracket around the target reminder day
      const lowerBoundMs = (reminderDays - 1) * 24 * 60 * 60 * 1000;
      const upperBoundMs = (reminderDays + 1) * 24 * 60 * 60 * 1000;

      const allSubscriptions = await subscriptionsRepo.getAll();
      const allUsers = await usersRepo.getAll();
      const userMap = new Map<string, User>(allUsers.map((u) => [u.id, u]));

      let scanned = 0;
      let reminded = 0;
      let skipped = 0;
      let errors = 0;

      for (const sub of allSubscriptions) {
        // Eligibility 1: Must be active
        if (sub.status !== "ACTIVE") {
          continue;
        }

        scanned++;
        const user = userMap.get(sub.userId);
        if (!user || !user.email) {
          skipped++;
          continue;
        }

        const expiresAtDate = new Date(sub.expiresAt);
        const timeUntilExpiry = expiresAtDate.getTime() - now.getTime();

        // Expired or outside 7-day window
        if (timeUntilExpiry <= 0) {
          continue; // Already expired
        }

        // Check if within the reminder window
        const isWithinWindow = timeUntilExpiry <= upperBoundMs && timeUntilExpiry >= lowerBoundMs;
        // Or if manual trigger, any subscription expiring within reminderDays
        const shouldConsider = isManualTrigger ? timeUntilExpiry <= targetWindowMs : isWithinWindow;

        if (!shouldConsider) {
          continue;
        }

        const idempotencyKey = `${sub.id}_${sub.expiresAt}`;

        // Check existing reminder records
        const existingReminder = await remindersRepo.findOne(
          (r) => r.subscriptionId === sub.id && r.targetExpiryDate === sub.expiresAt
        );

        if (existingReminder) {
          if (existingReminder.status === "SENT") {
            // Already reminded for this exact expiration date
            skipped++;
            continue;
          }
          if (existingReminder.status === "SKIPPED_PRE_WINDOW" && !isManualTrigger) {
            // Already skipped because it was pre-existing at deploy time
            skipped++;
            continue;
          }
        }

        // Deploy-time cut-off protection:
        // Do not send overdue reminders for subscriptions already inside the 7-day window at deploy time unless manual
        const subCreatedAt = new Date(sub.startAt).getTime();
        const wasAlreadyInsideWindowAtDeploy =
          subCreatedAt < this.serviceStartTime.getTime() &&
          expiresAtDate.getTime() - this.serviceStartTime.getTime() < targetWindowMs;

        if (wasAlreadyInsideWindowAtDeploy && !isManualTrigger && !existingReminder) {
          const preWindowRecord: SubscriptionReminderRecord = {
            id: `rem_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
            subscriptionId: sub.id,
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            planId: sub.planId,
            targetExpiryDate: sub.expiresAt,
            remindAtDaysBefore: reminderDays,
            status: "SKIPPED_PRE_WINDOW",
            attempts: 0,
            idempotencyKey,
            dryRun: ENV.EMAIL_DRY_RUN,
            createdAt: now.toISOString(),
          };
          await remindersRepo.create(preWindowRecord);
          skipped++;
          continue;
        }

        // Eligibility 2: Check if user already renewed (has a newer active subscription)
        const hasNewerActiveSub = allSubscriptions.some(
          (s) =>
            s.id !== sub.id &&
            s.userId === sub.userId &&
            s.status === "ACTIVE" &&
            new Date(s.startAt).getTime() > new Date(sub.startAt).getTime()
        );

        if (hasNewerActiveSub) {
          if (!existingReminder) {
            await remindersRepo.create({
              id: `rem_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
              subscriptionId: sub.id,
              userId: user.id,
              userEmail: user.email,
              userName: user.name,
              planId: sub.planId,
              targetExpiryDate: sub.expiresAt,
              remindAtDaysBefore: reminderDays,
              status: "SKIPPED_ALREADY_RENEWED",
              attempts: 0,
              idempotencyKey,
              dryRun: ENV.EMAIL_DRY_RUN,
              createdAt: now.toISOString(),
            });
          }
          skipped++;
          continue;
        }

        // Dispatch Reminder
        const plan = PLANS[sub.planId];
        const planName = plan ? plan.name : sub.planId;
        const daysRemaining = Math.max(1, Math.round(timeUntilExpiry / (1000 * 60 * 60 * 24)));
        const formattedExpiry = expiresAtDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        const heading = `Your TrustGate ${planName} Expires in ${daysRemaining} Days`;
        const body = `Hello ${user.name},\n\nYour active TrustGate API subscription (${planName}) is set to expire on ${formattedExpiry}.\n\nTo ensure uninterrupted API access and maintain your active API keys, please review our plans and renew your subscription before the expiration date.\n\nThank you for choosing TrustGate AI.`;

        const html = EmailService.renderBrandedHtml({
          heading,
          body,
          callToActionText: "Renew Subscription",
          callToActionUrl: `${ENV.PUBLIC_BASE_URL || "http://localhost:5173"}/plans`,
          isTransactional: true, // Transactional reminder
        });

        const provider = EmailService.getActiveProvider();
        const isDryRun = ENV.EMAIL_DRY_RUN || provider.id === "dryrun";

        try {
          const result = await provider.sendEmail({
            to: user.email,
            subject: `Action Required: Your TrustGate Subscription Expires in ${daysRemaining} Days`,
            html,
            idempotencyKey,
          });

          const reminderRecord: SubscriptionReminderRecord = existingReminder
            ? (await remindersRepo.update(existingReminder.id, {
                status: result.success ? "SENT" : "FAILED",
                attempts: (existingReminder.attempts || 0) + 1,
                lastAttemptAt: now.toISOString(),
                sentAt: result.success ? now.toISOString() : undefined,
                errorMessage: result.errorMessage,
                dryRun: isDryRun,
              }))!
            : await remindersRepo.create({
                id: `rem_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
                subscriptionId: sub.id,
                userId: user.id,
                userEmail: user.email,
                userName: user.name,
                planId: sub.planId,
                targetExpiryDate: sub.expiresAt,
                remindAtDaysBefore: reminderDays,
                status: result.success ? "SENT" : "FAILED",
                attempts: 1,
                lastAttemptAt: now.toISOString(),
                sentAt: result.success ? now.toISOString() : undefined,
                errorMessage: result.errorMessage,
                idempotencyKey,
                dryRun: isDryRun,
                createdAt: now.toISOString(),
              });

          // Log delivery
          await emailLogsRepo.create({
            id: `log_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
            type: "EXPIRY_REMINDER",
            subscriptionId: sub.id,
            recipientEmail: user.email,
            recipientUserId: user.id,
            recipientName: user.name,
            subject: heading,
            provider: provider.id,
            status: result.dryRun ? "DRY_RUN" : result.success ? "DELIVERED" : "FAILED",
            previewText: result.preview?.text,
            errorMessage: result.errorMessage,
            attempt: reminderRecord.attempts,
            idempotencyKey,
            timestamp: now.toISOString(),
          });

          if (result.success) {
            reminded++;
          } else {
            errors++;
          }
        } catch (err: any) {
          errors++;
          console.error(`⏰ [Reminder Scheduler] Failed to send reminder for sub ${sub.id}:`, err);
        }
      }

      console.log(
        `⏰ [Reminder Scheduler] Completed scan: scanned ${scanned}, reminded ${reminded}, skipped ${skipped}, errors ${errors}`
      );
      return { scanned, reminded, skipped, errors };
    });
  }
}
