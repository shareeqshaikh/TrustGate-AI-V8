export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
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
  amountPaise: number;
  durationDays: number;
  description: string;
}

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
  reference: string;
  utr?: string;
  utrSubmittedAt?: string;
  status: OrderStatus;
  upiUri?: string;
  qrDataUrl?: string;
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  refunded?: boolean;
  refundId?: string;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: PlanId;
  orderId: string;
  startAt: string;
  expiresAt: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | "REFUNDED";
}

export interface ApiKeyMetadata {
  id: string;
  prefix: string;
  last4: string;
  revoked: boolean;
  createdAt: string;
  hasOneTimeReveal?: boolean;
}

// -------------------------------------------------------------
// WALLET & LEDGER TYPES
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
  referenceId: string;
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
  reference: string;
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
// EMAIL AUTOMATION & REMINDERS TYPES
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
  body: string;
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
  planId: "monthly" | "yearly";
  targetExpiryDate: string;
  remindAtDaysBefore: number;
  status: ReminderStatus;
  attempts: number;
  lastAttemptAt?: string;
  sentAt?: string;
  errorMessage?: string;
  idempotencyKey: string;
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
  provider: string;
  status: EmailDeliveryStatus;
  previewText?: string;
  errorMessage?: string;
  attempt: number;
  idempotencyKey: string;
  timestamp: string;
}

export interface EmailDraftResponse {
  subject: string;
  heading: string;
  body: string;
  callToAction: string;
  requiresReview: boolean;
}

export interface EmailProviderStatus {
  provider: string;
  dryRun: boolean;
  configured: boolean;
  details: string;
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

// -------------------------------------------------------------
// CENTRAL AGENT MANAGER TYPES
// -------------------------------------------------------------

export type AgentId = "payment-agent" | "email-agent" | string;

export type AgentStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "STOPPED"
  | "RUNNING_TASK"
  | "ERROR";

export type AgentType =
  | "PAYMENT"
  | "COMMUNICATION"
  | "SECURITY"
  | "AUTOMATION"
  | "CUSTOM";

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  parametersSchema?: Record<string, any>;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresConfirmation?: boolean;
}

export interface AgentConfigRecord {
  id: string;
  agentId: string;
  enabled: boolean;
  taskTimeoutMs: number;
  maxRetries: number;
  logLevel: "INFO" | "WARN" | "ERROR" | "DEBUG";
  customSettings: Record<string, any>;
  updatedAt: string;
  updatedBy: string;
}

export interface AgentHealth {
  status: AgentStatus;
  lastCheckedAt: string;
  message: string;
  metrics?: Record<string, any>;
}

export interface AgentExecutionTask {
  id: string;
  agentId: string;
  agentName: string;
  taskType: string;
  status: TaskStatus;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  initiatedBy: string;
  params?: Record<string, any>;
  resultSummary?: string;
  resultData?: any;
  errorMessage?: string;
  cancellable: boolean;
}

export interface EmergencyStopRecord {
  id: string;
  active: boolean;
  triggeredAt?: string;
  triggeredBy?: string;
  reason?: string;
  uncancellableOperations?: string[];
  resumedAt?: string;
  resumedBy?: string;
}

export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  version: string;
  enabled: boolean;
  status: AgentStatus;
  health: AgentHealth;
  capabilities: AgentCapability[];
  config: AgentConfigRecord;
  lastExecution?: AgentExecutionTask | null;
  statistics: {
    totalTasksRun: number;
    successCount: number;
    failureCount: number;
    lastRunAt?: string;
  };
}

export interface AgentOverviewStats {
  totalAgents: number;
  enabledAgents: number;
  disabledAgents: number;
  runningTasks: number;
  failedTasks: number;
  completedTasks: number;
  emergencyStop: {
    active: boolean;
    triggeredAt?: string;
    triggeredBy?: string;
    reason?: string;
  };
  aiProvider: {
    available: boolean;
    provider: string;
    model: string;
    details: string;
  };
  recentActivity: AgentExecutionTask[];
}



