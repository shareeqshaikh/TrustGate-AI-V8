import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { ordersRepo, refundsRepo } from "../storage/json-repository.js";
import { PLANS, type PlanId, type Order } from "../types/index.js";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware.js";
import { SubscriptionService } from "../services/subscription.service.js";
import { AuditService } from "../services/audit.service.js";
import { ENV } from "../config/env.js";

export const orderRouter = Router();

/**
 * Deterministically generates a standardized UPI payment URI and QR Code Data URL.
 * Format: upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...&tr=...
 */
export async function generateUpiDetails(order: {
  reference: string;
  amountPaise: number;
}): Promise<{ upiUri: string; qrDataUrl: string }> {
  const merchantId = ENV.UPI_MERCHANT_ID || "shareeqshaikh194@oksbi";
  const merchantName = ENV.UPI_MERCHANT_NAME || "Shareeq Shaikh";
  const amountRupees = (order.amountPaise / 100).toFixed(2);
  const note = order.reference;

  const upiUri = `upi://pay?pa=${encodeURIComponent(merchantId)}&pn=${encodeURIComponent(
    merchantName
  )}&am=${amountRupees}&cu=INR&tn=${encodeURIComponent(note)}&tr=${encodeURIComponent(
    order.reference
  )}`;

  const qrDataUrl = await QRCode.toDataURL(upiUri, {
    margin: 1,
    width: 280,
    errorCorrectionLevel: "M",
  });

  return { upiUri, qrDataUrl };
}

// GET /api/v1/plans - List the available subscription plans
orderRouter.get("/plans", (_req: Request, res: Response): void => {
  // Present primary plans: 7 days (₹2) and 30 days (₹5)
  const primaryPlans = [PLANS["7days"], PLANS["30days"]].filter(Boolean);
  res.json({ plans: primaryPlans });
});

const CreateOrderSchema = z.object({
  planId: z.enum(["7days", "30days", "monthly", "yearly"]),
});

// POST /api/v1/orders - Create an order with real UPI QR details
orderRouter.post("/orders", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { planId } = CreateOrderSchema.parse(req.body);
    const user = req.user!;

    // Normalize planId
    const normalizedPlanId =
      planId === "monthly" ? "7days" : planId === "yearly" ? "30days" : planId;

    const plan = PLANS[normalizedPlanId];
    if (!plan) {
      res.status(400).json({ error: "Invalid plan selected" });
      return;
    }

    // Generate unique reference: TG-XXXXXX
    const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
    const reference = `TG-${randomHex}`;

    const now = new Date().toISOString();
    const orderId = `ord_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

    // Generate native UPI URI and QR Data URL
    const { upiUri, qrDataUrl } = await generateUpiDetails({
      reference,
      amountPaise: plan.amountPaise,
    });

    const order: Order = {
      id: orderId,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      planId: normalizedPlanId as PlanId,
      amountPaise: plan.amountPaise,
      reference,
      status: "PENDING",
      upiUri,
      qrDataUrl,
      createdAt: now,
    };

    await ordersRepo.create(order);

    await AuditService.record("ORDER_CREATED", user, {
      orderId,
      reference,
      planId: normalizedPlanId,
      amountPaise: plan.amountPaise,
    });

    res.status(201).json({
      order,
      upiUri,
      qrDataUrl,
      payUrl: null,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0]?.message });
      return;
    }
    res.status(500).json({ error: err.message || "Failed to create order" });
  }
});

// GET /api/v1/orders/:id - Get order details
orderRouter.get("/orders/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const order = await ordersRepo.getById(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // Strict tenant isolation: regular users can only view their own orders
  if (req.user!.role !== "admin" && order.userId !== req.user!.id) {
    res.status(403).json({ error: "Unauthorized access to order" });
    return;
  }

  // Ensure UPI details are present on pending orders
  if (!order.upiUri || !order.qrDataUrl) {
    try {
      const details = await generateUpiDetails({
        reference: order.reference,
        amountPaise: order.amountPaise,
      });
      order.upiUri = details.upiUri;
      order.qrDataUrl = details.qrDataUrl;
      await ordersRepo.update(order.id, {
        upiUri: details.upiUri,
        qrDataUrl: details.qrDataUrl,
      });
    } catch {
      // Ignore generation failure on read
    }
  }

  res.json({
    order,
    upiUri: order.upiUri,
    qrDataUrl: order.qrDataUrl,
    payUrl: null,
  });
});

/**
 * Handle UTR submission logic with strict 12-digit format and deduplication check.
 */
async function handleUtrSubmission(req: Request, res: Response): Promise<void> {
  try {
    const order = await ordersRepo.getById(req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (req.user!.role !== "admin" && order.userId !== req.user!.id) {
      res.status(403).json({ error: "Unauthorized access to order" });
      return;
    }

    if (order.status === "CONFIRMED") {
      res.json({ message: "Order is already confirmed", order });
      return;
    }

    const utr = String(req.body?.utr || "").trim();
    if (!utr) {
      res.status(400).json({ error: "Enter your 12-digit UTR number" });
      return;
    }

    // 12-digit numeric validation
    if (!/^\d{12}$/.test(utr)) {
      res.status(400).json({ error: "UTR must be a 12-digit numeric reference number" });
      return;
    }

    // Duplicate check: check against all other confirmed orders or orders awaiting verification
    const existingOrders = await ordersRepo.find(
      (o) =>
        o.id !== order.id &&
        o.utr === utr &&
        (o.status === "CONFIRMED" || o.status === "AWAITING_VERIFICATION")
    );

    if (existingOrders.length > 0) {
      res.status(409).json({
        error: "This UTR was already submitted or verified for another order.",
        code: "DUPLICATE_UTR",
      });
      return;
    }

    // Duplicate check against payout UTRs
    const existingRefunds = await refundsRepo.find((r) => r.payoutUtr === utr);
    if (existingRefunds.length > 0) {
      res.status(409).json({
        error: "This UTR conflicts with an existing settlement record.",
        code: "DUPLICATE_UTR",
      });
      return;
    }

    const updated = await ordersRepo.update(order.id, {
      utr,
      utrSubmittedAt: new Date().toISOString(),
      status: "AWAITING_VERIFICATION",
    });

    await AuditService.record("ORDER_UTR_SUBMITTED", req.user!, {
      orderId: order.id,
      reference: order.reference,
      utr,
    });

    res.json({
      message: "UTR submitted successfully. Awaiting administrator verification.",
      order: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "UTR submission failed" });
  }
}

// POST /api/v1/orders/:id/utr - User submits 12-digit UTR
orderRouter.post("/orders/:id/utr", requireAuth, handleUtrSubmission);

// POST /api/v1/orders/:id/verify - User submits 12-digit UTR (alias)
orderRouter.post("/orders/:id/verify", requireAuth, handleUtrSubmission);

// -----------------------------------------------------------------------
// ADMIN ORDER MANAGEMENT ENDPOINTS
// -----------------------------------------------------------------------

// GET /api/v1/admin/orders - List orders (with optional status filter)
orderRouter.get("/admin/orders", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    let orders = await ordersRepo.getAll();
    if (status) {
      orders = orders.filter((o) => o.status === status);
    }
    res.json({ orders: orders.reverse() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch orders" });
  }
});

// POST /api/v1/admin/orders/:id/confirm - Admin verifies payment and activates subscription
orderRouter.post(
  "/admin/orders/:id/confirm",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const order = await ordersRepo.getById(req.params.id);
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      // Segregation of duties: Admin cannot confirm their own order
      if (order.userId === req.user!.id) {
        res.status(403).json({
          error: "Segregation of duties: Admin cannot confirm their own order.",
          code: "ADMIN_CANNOT_CONFIRM_OWN_ORDER",
        });
        return;
      }

      if (order.status === "CONFIRMED") {
        res.status(400).json({ error: "Order is already confirmed." });
        return;
      }

      if (!order.utr) {
        res.status(400).json({ error: "Cannot confirm order without a submitted UTR." });
        return;
      }

      const now = new Date().toISOString();
      const updated = (await ordersRepo.update(order.id, {
        status: "CONFIRMED",
        confirmedAt: now,
        confirmedBy: req.user!.id,
      }))!;

      // Authoritative activation of subscription and generation of API key
      const { subscription, apiKey, plaintextKey } =
        await SubscriptionService.activateSubscriptionForOrder(updated);

      await AuditService.record("ORDER_CONFIRMED_BY_ADMIN", req.user!, {
        orderId: order.id,
        reference: order.reference,
        utr: order.utr,
        adminId: req.user!.id,
        subscriptionId: subscription.id,
      });

      res.json({
        message: "Order confirmed and subscription activated successfully.",
        order: updated,
        subscription,
        apiKey,
        plaintextKey,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to confirm order" });
    }
  }
);

// POST /api/v1/admin/orders/:id/reject - Admin rejects an order
orderRouter.post(
  "/admin/orders/:id/reject",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const order = await ordersRepo.getById(req.params.id);
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      if (order.status === "CONFIRMED") {
        res.status(400).json({ error: "Cannot reject an already confirmed order." });
        return;
      }

      const reason = String(req.body?.reason || "Payment not received or invalid UTR").trim();
      const now = new Date().toISOString();

      const updated = (await ordersRepo.update(order.id, {
        status: "REJECTED",
        rejectedAt: now,
        rejectionReason: reason,
      }))!;

      await AuditService.record("ORDER_REJECTED_BY_ADMIN", req.user!, {
        orderId: order.id,
        reference: order.reference,
        utr: order.utr,
        reason,
        adminId: req.user!.id,
      });

      res.json({
        message: "Order rejected.",
        order: updated,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to reject order" });
    }
  }
);
