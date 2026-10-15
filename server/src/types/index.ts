export type UserRole = "admin" | "user";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  emailVerified?: boolean;
  emailPreferences?: {
    promotional: boolean;
    unsubscribeToken: string;
    unsubscribedAt?: string;
  };
}

export type PlanId = "7days" | "30days" | "monthly" | "yearly";

export interface PlanConfig {
  id: "7days" | "30days";
  name: string;
  amountPaise: number; // 200 or 500
  durationDays: number; // 7 or 30
  description: string;
}

export const PLANS: Record<string, PlanConfig> = {
  "7days": {
    id: "7days",
    name: "7 Days Plan",
    amountPaise: 200, // ₹2
    durationDays: 7,
    description: "7 days full API gateway access",
  },
  "30days": {
    id: "30days",
    name: "30 Days Plan",
    amountPaise: 500, // ₹5
    durationDays: 30,
    description: "30 days full API gateway access",
  },
  // Backward compatibility aliases
  monthly: {
    id: "7days",
    name: "7 Days Plan",
    amountPaise: 200,
    durationDays: 7,
    description: "7 days full API gateway access",
  },
  yearly: {
    id: "30days",
    name: "30 Days Plan",
    amountPaise: 500,
    durationDays: 30,
    description: "30 days full API gateway access",
  },
};

export type OrderStatus =
  | "PENDING"
  | "AWAITING_VERIFICATION"
  | "PAYMENT_SUBMITTED"
  | "CONFIRMED"
  | "REJECTED";

export interface Order {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  planId: PlanId;
  amountPaise: number;
  reference: string; // TG-xxxxxx
  utr?: string;
  utrSubmittedAt?: string;
  status: OrderStatus;
  upiUri?: string;
  qrDataUrl?: string;
  paymentRequestId?: string;
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  refunded?: boolean;
  refundId?: string;
}

export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "CANCELLED" | "REFUNDED";

export interface Subscription {
  id: string;
  userId: string;
  planId: PlanId;
  orderId: string;
  startAt: string;
  expiresAt: string;
  status: SubscriptionStatus;
}

export interface ApiKey {
  id: string;
  userId: string;
  subscriptionId: string;
  hash: string;
  prefix: string;
  last4: string;
  revoked: boolean;
  createdAt: string;
  oneTimePlaintextKey?: string; // Cleared after first read
}

// -------------------------------------------------------------
// WALLET LEDGER TYPES (Append-only Ledger)
// -------------------------------------------------------------

export type WalletEntryType =
  | "TOPUP"
  | "REFUND_RESERVED"
  | "REFUND_RELEASED"
  | "REFUND_PAID"
  | "REFUND_FAILED";

export interface WalletLedgerEntry {
  id: string;
  type: WalletEntryType;
  amountPaise: number;
  referenceId: string; // topupId or refundId
  utr?: string;
  description: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface WalletBalances {
  availableBalancePaise: number;
  reservedPaise: number;
  totalRefundedPaise: number;
  totalTopupPaise: number;
}

export interface TopupRecord {
  id: string;
  reference: string; // TOP-xxxxxx
  amountPaise: number;
  adminId: string;
  adminName: string;
  utr?: string;
  status: "PENDING" | "CREDITED";
  qrDataUrl?: string | null;
  upiUri?: string | null;
  createdAt: string;
  creditedAt?: string;
}

// -------------------------------------------------------------
// REFUND TYPES
// -------------------------------------------------------------

export type RefundStatus =
  | "REQUESTED"
  | "APPROVED_PAYOUT_PENDING"
  | "AWAITING_MANUAL_PAYOUT"
  | "PAID"
  | "REQUIRES_HUMAN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "REFUNDED"
  | "FAILED";

export interface RefundRecord {
  id: string;
  orderId: string;
  orderReference: string;
  userId: string;
  userName: string;
  userEmail: string;
  userUpiId: string;
  amountPaise: number;
  reason: string;
  status: RefundStatus;
  aiRecommendation?: "RECOMMEND_APPROVAL" | "RECOMMEND_REJECTION" | "REQUIRE_REVIEW";
  aiReason?: string;
  aiReasoning?: string;
  aiAgentAComparison?: string;
  approvedByAdminId?: string;
  approvedAt?: string;
  rejectedByAdminId?: string;
  rejectedAt?: string;
  paidAt?: string;
  paidByAdminId?: string;
  payoutUtr?: string;
  payoutQrDataUrl?: string | null;
  payoutUpiUri?: string | null;
  failureReason?: string;
  idempotencyKey: string;
  createdAt: string;
}

// -------------------------------------------------------------
// AUDIT CHAIN TYPES (Hash-linked Append-only)
// -------------------------------------------------------------

export interface AuditBlock {
  id: string;
  index: number;
  timestamp: string;
  action: string;
  actorId: string;
  actorEmail: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

// -------------------------------------------------------------
// EMAIL AUTOMATION & REMINDER TYPES
// -------------------------------------------------------------

export type EmailRecipientGroup =
  | "ALL_ELIGIBLE"
  | "ACTIVE_SUBSCRIBERS"
  | "EXPIRED_SUBSCRIBERS"
  | "SELECTED_USERS";

export type CampaignStatus = "DRAFT" | "SENDING" | "SENT" | "CANCELLED";

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  heading: string;
  body: string; // Markdown or sanitized text
  callToActionText?: string;
  callToActionUrl?: string;
  recipientGroup: EmailRecipientGroup;
  selectedUserIds?: string[];
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  idempotencyKey: string;
  dryRun: boolean;
  aiDrafted: boolean;
  createdByAdminId: string;
  createdAt: string;
  sentAt?: string;
}

export type ReminderStatus =
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED_ALREADY_RENEWED"
  | "SKIPPED_CANCELLED"
  | "SKIPPED_PRE_WINDOW";

export interface SubscriptionReminderRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  userEmail: string;
  userName: string;
  planId: PlanId;
  targetExpiryDate: string; // ISO date of subscription expiry
  remindAtDaysBefore: number; // e.g. 7
  status: ReminderStatus;
  attempts: number;
  lastAttemptAt?: string;
  sentAt?: string;
  errorMessage?: string;
  idempotencyKey: string; // Unique: subId_targetExpiryDate
  dryRun: boolean;
  createdAt: string;
}

export type EmailLogType = "CAMPAIGN" | "EXPIRY_REMINDER" | "TEST";
export type EmailDeliveryStatus = "DELIVERED" | "FAILED" | "DRY_RUN";

export interface EmailDeliveryLog {
  id: string;
  type: EmailLogType;
  campaignId?: string;
  subscriptionId?: string;
  recipientEmail: string;
  recipientUserId?: string;
  recipientName?: string;
  subject: string;
  provider: string; // "dryrun" | "smtp" | "resend" | "gmail"
  status: EmailDeliveryStatus;
  previewText?: string;
  errorMessage?: string;
  attempt: number;
  idempotencyKey: string;
  timestamp: string;
}

// -------------------------------------------------------------
// GMAIL OAUTH & TOKEN TYPES
// -------------------------------------------------------------

export interface StoredGmailToken {
  id: string; // "active_gmail_account"
  connectedEmail: string;
  encryptedRefreshToken: string;
  iv: string; // Hex-encoded 12-byte IV
  authTag: string; // Hex-encoded 16-byte GCM auth tag
  scope: string;
  dailySendCap: number; // Default 100
  todaySendCount: number;
  lastResetDate: string; // YYYY-MM-DD
  connectedAt: string;
  updatedAt: string;
  lastSendResult?: {
    success: boolean;
    timestamp: string;
    error?: string;
  };
}

export interface GmailConnectionStatus {
  connected: boolean;
  needsReconnect: boolean;
  connectedEmail?: string;
  dailySendCap: number;
  todaySendCount: number;
  lastSendResult?: {
    success: boolean;
    timestamp: string;
    error?: string;
  };
  details: string;
}

export * from "./agent-manager.types.js";




