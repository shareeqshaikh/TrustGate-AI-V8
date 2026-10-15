import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import QRCode from "qrcode";
import {
  ordersRepo,
  refundsRepo,
  subscriptionsRepo,
  apiKeysRepo,
} from "../storage/json-repository.js";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware.js";
import { AuditService } from "../services/audit.service.js";
import { ENV } from "../config/env.js";
import type { RefundRecord } from "../types/index.js";

export const refundRouter = Router();

// GET /api/v1/refunds - List refunds (User sees own; Admin sees all)
refundRouter.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const allRefunds = await refundsRepo.getAll();

    if (user.role === "admin") {
      res.json({ refunds: allRefunds.reverse() });
    } else {
      const userRefunds = allRefunds.filter((r) => r.userId === user.id);
      res.json({ refunds: userRefunds.reverse() });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch refunds" });
  }
});

// GET /api/v1/refunds/admin - Admin view of all refunds with optional status filter
refundRouter.get("/admin", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    let allRefunds = await refundsRepo.getAll();
    if (status) {
      allRefunds = allRefunds.filter((r) => r.status === status);
    }
    res.json({ refunds: allRefunds.reverse() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch refunds" });
  }
});

const RequestRefundSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  userUpiId: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/,
      "Enter a valid UPI ID (e.g. name@okhdfcbank or 9876543210@upi)"
    ),
  reason: z.string().min(3, "Please provide a reason for the refund request"),
});

// POST /api/v1/refunds - Request a refund (Deterministic AI Rule Engine)
refundRouter.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId, userUpiId, reason } = RequestRefundSchema.parse(req.body);
    const user = req.user!;

    const order = await ordersRepo.getById(orderId);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // 1. Ownership check: user can only request refund for their own order
    if (order.userId !== user.id) {
      res.status(403).json({
        error: "You can only request a refund on your own order.",
        code: "UNAUTHORIZED_ORDER_ACCESS",
      });
      return;
    }

    // 2. Order status check: only confirmed orders are eligible
    if (order.status !== "CONFIRMED") {
      res.status(400).json({
        error: "Only confirmed orders are eligible for refund.",
        code: "ORDER_NOT_CONFIRMED",
      });
      return;
    }

    // 3. Already refunded check
    if (order.refunded) {
      res.status(400).json({
        error: "This order has already been refunded.",
        code: "ORDER_ALREADY_REFUNDED",
      });
      return;
    }

    // 4. Duplicate active refund request check
    const existingRefunds = await refundsRepo.find((r) => r.orderId === order.id);
    const activeRefund = existingRefunds.find(
      (r) => r.status !== "REJECTED" && r.status !== "FAILED"
    );
    if (activeRefund) {
      res.status(400).json({
        error: "A refund request is already active or completed for this order.",
        code: "DUPLICATE_REFUND_REQUEST",
      });
      return;
    }

    // 5. Active subscription check: user must currently have an active subscription for this order
    const activeSubs = await subscriptionsRepo.find(
      (s) => s.orderId === order.id && s.status === "ACTIVE"
    );
    if (activeSubs.length === 0) {
      res.status(400).json({
        error: "Subscription is not active or has already expired/cancelled.",
        code: "NO_ACTIVE_SUBSCRIPTION",
      });
      return;
    }

    // 6. Refund policy window check (default 7 days)
    const refundWindowDays = ENV.REFUND_WINDOW_DAYS || 7;
    const confirmedTime = new Date(order.confirmedAt || order.createdAt).getTime();
    const windowMs = refundWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - confirmedTime > windowMs) {
      res.status(400).json({
        error: `Refund policy window has expired (${refundWindowDays} days limit).`,
        code: "REFUND_WINDOW_EXPIRED",
      });
      return;
    }

    // 7. Maximum auto-refund threshold check (e.g. ₹5 = 500 paise)
    const maxPaise = ENV.AUTO_REFUND_MAX_PAISE || 500;
    if (order.amountPaise > maxPaise) {
      res.status(400).json({
        error: `Refund amount (${order.amountPaise} paise) exceeds auto-refund threshold of ${maxPaise} paise.`,
        code: "EXCEEDS_AUTO_REFUND_THRESHOLD",
      });
      return;
    }

    // --- DETERMINISTIC AUTO-APPROVAL LOGIC ---
    const refundId = `ref_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const idempotencyKey = `idemp_${refundId}`;

    // Immediately cancel user's subscription and revoke all API keys
    for (const sub of activeSubs) {
      await subscriptionsRepo.update(sub.id, { status: "CANCELLED" });
      const keys = await apiKeysRepo.find((k) => k.subscriptionId === sub.id);
      for (const key of keys) {
        await apiKeysRepo.update(key.id, { revoked: true, oneTimePlaintextKey: undefined });
      }
    }

    // Mark order as refunded
    await ordersRepo.update(order.id, { refunded: true, refundId });

    // Generate Admin Payout UPI URI and QR Data URL to pay user directly via UPI
    const amountRupees = (order.amountPaise / 100).toFixed(2);
    const payoutUpiUri = `upi://pay?pa=${encodeURIComponent(userUpiId.trim())}&pn=${encodeURIComponent(
      order.userName
    )}&am=${amountRupees}&cu=INR&tn=${encodeURIComponent(`Refund ${order.reference}`)}`;

    let payoutQrDataUrl: string | null = null;
    try {
      payoutQrDataUrl = await QRCode.toDataURL(payoutUpiUri, {
        margin: 1,
        width: 280,
        errorCorrectionLevel: "M",
      });
    } catch {
      payoutQrDataUrl = null;
    }

    const aiReason =
      "Auto-approved by TrustGate Deterministic Rule Engine: Confirmed order within 7-day policy window, active subscription verified, amount within ₹5 limit, and valid UPI ID provided.";

    const refundRecord = await refundsRepo.create({
      id: refundId,
      orderId: order.id,
      orderReference: order.reference,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userUpiId: userUpiId.trim(),
      amountPaise: order.amountPaise,
      reason: reason.trim(),
      status: "APPROVED_PAYOUT_PENDING",
      aiRecommendation: "RECOMMEND_APPROVAL",
      aiReason,
      aiReasoning: aiReason,
      payoutQrDataUrl,
      payoutUpiUri,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    });

    await AuditService.record("REFUND_AUTO_APPROVED", user, {
      refundId: refundRecord.id,
      orderId: order.id,
      amountPaise: order.amountPaise,
      userUpiId: userUpiId.trim(),
      status: "APPROVED_PAYOUT_PENDING",
    });

    res.status(201).json({
      message:
        "Refund auto-approved! Your subscription has been cancelled and API access revoked. Payout to your UPI ID is in progress.",
      refund: refundRecord,
      autoApproved: true,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to process refund request" });
  }
});

/**
 * Common handler for Admin manual payout confirmation
 */
async function handleMarkPaid(req: Request, res: Response): Promise<void> {
  try {
    const refundId = req.params.id;
    const refund = await refundsRepo.getById(refundId);
    if (!refund) {
      res.status(404).json({ error: "Refund record not found" });
      return;
    }

    if (refund.status === "PAID") {
      res.json({ message: "Refund has already been paid.", refund });
      return;
    }

    const payoutUtr = String(req.body?.payoutUtr || "").trim();
    if (!payoutUtr) {
      res.status(400).json({ error: "12-digit Payout UTR is required" });
      return;
    }

    // 12-digit numeric validation
    if (!/^\d{12}$/.test(payoutUtr)) {
      res.status(400).json({ error: "Payout UTR must be a 12-digit numeric reference number" });
      return;
    }

    // Duplicate check across other refunds
    const existingRefunds = await refundsRepo.find(
      (r) => r.id !== refund.id && r.payoutUtr === payoutUtr
    );
    if (existingRefunds.length > 0) {
      res.status(409).json({
        error: "This payout UTR was already recorded for another refund.",
        code: "DUPLICATE_UTR",
      });
      return;
    }

    // Duplicate check across orders
    const existingOrders = await ordersRepo.find((o) => o.utr === payoutUtr);
    if (existingOrders.length > 0) {
      res.status(409).json({
        error: "This UTR conflicts with an existing customer payment order.",
        code: "DUPLICATE_UTR",
      });
      return;
    }

    const now = new Date().toISOString();
    const updated = (await refundsRepo.update(refund.id, {
      status: "PAID",
      payoutUtr,
      paidAt: now,
      paidByAdminId: req.user!.id,
    }))!;

    await AuditService.record("REFUND_PAID_MANUAL", req.user!, {
      refundId: refund.id,
      orderId: refund.orderId,
      amountPaise: refund.amountPaise,
      payoutUtr,
      adminId: req.user!.id,
    });

    res.json({
      message: "Refund marked as paid successfully.",
      refund: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to mark refund as paid" });
  }
}

// POST /api/v1/refunds/:id/mark-paid - Admin enters payout UTR and marks paid
refundRouter.post("/:id/mark-paid", requireAdmin, handleMarkPaid);

// POST /api/v1/refunds/admin/:id/mark-paid - Alias
refundRouter.post("/admin/:id/mark-paid", requireAdmin, handleMarkPaid);
