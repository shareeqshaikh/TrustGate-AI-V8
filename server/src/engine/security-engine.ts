import type { User, Order, RefundRecord, WalletBalances } from "../types/index.js";

export type FundAction =
  | "CONFIRM_PAYMENT"
  | "WALLET_TOPUP"
  | "WALLET_CREDIT"
  | "REFUND_REQUEST"
  | "REFUND_APPROVE"
  | "REFUND_REJECT"
  | "REFUND_PAYOUT";

export interface FundAuthContext {
  action: FundAction;
  actor: User;
  order?: Order | null;
  refund?: RefundRecord | null;
  amountPaise?: number;
  walletBalances?: WalletBalances;
  targetUserId?: string;
  utr?: string;
}

export interface AuthDecision {
  allowed: boolean;
  reason: string;
  code: string;
}

export function authorizeFundOperation(ctx: FundAuthContext): AuthDecision {
  const { action, actor, order, refund, amountPaise, walletBalances, targetUserId, utr } = ctx;

  // 1. Role requirements
  if (
    action === "CONFIRM_PAYMENT" ||
    action === "WALLET_TOPUP" ||
    action === "WALLET_CREDIT" ||
    action === "REFUND_APPROVE" ||
    action === "REFUND_REJECT" ||
    action === "REFUND_PAYOUT"
  ) {
    if (actor.role !== "admin") {
      return {
        allowed: false,
        reason: "Admin privileges required for this fund operation.",
        code: "FORBIDDEN",
      };
    }
  }

  // 2. Self-confirmation check for Orders: Admin cannot confirm their own order
  if (action === "CONFIRM_PAYMENT" && order) {
    if (order.userId === actor.id) {
      return {
        allowed: false,
        reason: "Segregation of duties: Admin cannot confirm their own payment order.",
        code: "ADMIN_CANNOT_CONFIRM_OWN_ORDER",
      };
    }
  }

  // 3. Self-approval check for Refunds: Requester cannot approve their own refund
  if (action === "REFUND_APPROVE" && refund) {
    if (refund.userId === actor.id) {
      return {
        allowed: false,
        reason: "Conflict of interest: Requester cannot approve their own refund.",
        code: "REQUESTER_CANNOT_APPROVE_OWN_REFUND",
      };
    }
  }

  // 4. Amount Validation
  if (amountPaise !== undefined) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      return {
        allowed: false,
        reason: "Operation amount must be a positive integer in paise.",
        code: "INVALID_AMOUNT",
      };
    }
  }

  // 5. Refund Request Validation
  if (action === "REFUND_REQUEST") {
    if (!order) {
      return {
        allowed: false,
        reason: "A verified confirmed order is required to request a refund.",
        code: "ORDER_NOT_FOUND",
      };
    }

    // Ownership check
    if (order.userId !== actor.id) {
      return {
        allowed: false,
        reason: "You can only request a refund on your own order.",
        code: "UNAUTHORIZED_ORDER_ACCESS",
      };
    }

    // Order status check
    if (order.status !== "CONFIRMED") {
      return {
        allowed: false,
        reason: "Only confirmed orders are eligible for refund.",
        code: "ORDER_NOT_CONFIRMED",
      };
    }

    // Already refunded check
    if (order.refunded) {
      return {
        allowed: false,
        reason: "This order has already been refunded.",
        code: "ORDER_ALREADY_REFUNDED",
      };
    }

    // Amount match
    if (amountPaise && amountPaise > order.amountPaise) {
      return {
        allowed: false,
        reason: "Refund amount cannot exceed the original paid amount.",
        code: "EXCEEDS_ORDER_AMOUNT",
      };
    }

    // Refund window check (default 7 days)
    const refundWindowDays = Number(process.env.REFUND_WINDOW_DAYS) || 7;
    const confirmedTime = new Date(order.confirmedAt || order.createdAt).getTime();
    const windowMs = refundWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - confirmedTime > windowMs) {
      return {
        allowed: false,
        reason: `Refund window has expired (${refundWindowDays} days limit).`,
        code: "REFUND_WINDOW_EXPIRED",
      };
    }
  }

  // 6. Fund Solvency Check for Refund Approval
  if (action === "REFUND_APPROVE" && refund && walletBalances) {
    if (walletBalances.availableBalancePaise < refund.amountPaise) {
      return {
        allowed: false,
        reason: `Insufficient wallet balance (${walletBalances.availableBalancePaise} paise available, ${refund.amountPaise} paise required).`,
        code: "INSUFFICIENT_FUNDS",
      };
    }
  }

  return {
    allowed: true,
    reason: "Operation authorized by security engine.",
    code: "AUTHORIZED",
  };
}
