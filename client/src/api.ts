import type {
  User,
  PlanId,
  PlanConfig,
  Order,
  Subscription,
  ApiKeyMetadata,
  WalletBalances,
  WalletLedgerEntry,
  TopupRecord,
  RefundRecord,
  EmailCampaign,
  EmailRecipientGroup,
  SubscriptionReminderRecord,
  EmailDeliveryLog,
  EmailDraftResponse,
  EmailProviderStatus,
  GmailConnectionStatus,
  AgentOverviewStats,
  AgentMetadata,
  AgentConfigRecord,
  AgentExecutionTask,
  EmergencyStopRecord,
} from './types';

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
  }
  return data as T;
}

export const api = {
  // Auth
  getMe: () => fetchJson<{ user: User | null }>('/api/v1/auth/me'),
  register: (payload: { name: string; email: string; password: string }) =>
    fetchJson<{ message: string; user: User }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    fetchJson<{ message: string; user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => fetchJson<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }),

  // Plans & Orders
  getPlans: () =>
    fetchJson<{ plans: PlanConfig[] }>(
      '/api/v1/plans'
    ),
  createOrder: (planId: PlanId) =>
    fetchJson<{ order: Order; upiUri?: string; qrDataUrl?: string; payUrl: string | null; error?: string }>('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),
  getOrder: (id: string) =>
    fetchJson<{ order: Order; upiUri?: string; qrDataUrl?: string; payUrl: string | null; error?: string }>(`/api/v1/orders/${id}`),

  submitUtr: (id: string, utr: string) =>
    fetchJson<{ message: string; order: Order }>(`/api/v1/orders/${id}/utr`, {
      method: 'POST',
      body: JSON.stringify({ utr }),
    }),

  verifyUtr: (id: string, utr: string) =>
    fetchJson<{ message: string; order: Order }>(`/api/v1/orders/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ utr }),
    }),

  getAdminOrders: (status?: string) =>
    fetchJson<{ orders: Order[] }>(`/api/v1/admin/orders${status ? `?status=${status}` : ''}`),

  confirmAdminOrder: (id: string) =>
    fetchJson<{ message: string; order: Order; subscription: any; apiKey: any }>(`/api/v1/admin/orders/${id}/confirm`, {
      method: 'POST',
    }),

  rejectAdminOrder: (id: string, reason?: string) =>
    fetchJson<{ message: string; order: Order }>(`/api/v1/admin/orders/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Account & API Keys
  getAccount: () =>
    fetchJson<{
      user: User;
      subscription: Subscription | null;
      orders: Order[];
      apiKey: ApiKeyMetadata | null;
    }>('/api/v1/account'),
  revealKey: (keyId: string) =>
    fetchJson<{ keyId: string; plaintextKey: string; message: string }>(
      `/api/v1/account/reveal-key/${keyId}`
    ),
  revokeKey: (keyId: string) =>
    fetchJson<{ message: string }>(`/api/v1/account/revoke-key/${keyId}`, { method: 'POST' }),
  regenerateKey: () =>
    fetchJson<{ message: string; apiKey: any }>('/api/v1/account/regenerate-key', {
      method: 'POST',
    }),

  // Protected Ping Test
  pingWithKey: (key: string) =>
    fetchJson<{
      message: string;
      status: string;
      userId: string;
      userName: string;
      planId: string;
      subscriptionExpiresAt: string;
      serverTime: string;
    }>('/api/v1/ping', {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    }),

  // Refunds
  requestRefund: (payload: { orderId: string; userUpiId: string; reason: string }) =>
    fetchJson<{ message: string; refund: RefundRecord; autoApproved: boolean }>(
      '/api/v1/refunds',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  getRefunds: () => fetchJson<{ refunds: RefundRecord[] }>('/api/v1/refunds'),
  getAdminRefunds: (status?: string) =>
    fetchJson<{ refunds: RefundRecord[] }>(`/api/v1/refunds/admin${status ? `?status=${status}` : ''}`),
  markRefundPaid: (refundId: string, payoutUtr: string) =>
    fetchJson<{ message: string; refund: RefundRecord }>(`/api/v1/refunds/${refundId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify({ payoutUtr }),
    }),

  // Email Automation & Campaigns
  getEmailStatus: () => fetchJson<EmailProviderStatus>('/api/v1/admin/email/status'),
  getCampaigns: () => fetchJson<{ campaigns: EmailCampaign[] }>('/api/v1/admin/email/campaigns'),
  createCampaign: (payload: {
    name: string;
    subject: string;
    heading: string;
    body: string;
    callToActionText?: string;
    callToActionUrl?: string;
    recipientGroup: EmailRecipientGroup;
    selectedUserIds?: string[];
    aiDrafted?: boolean;
  }) =>
    fetchJson<{ campaign: EmailCampaign }>('/api/v1/admin/email/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCampaign: (
    campaignId: string,
    payload: Partial<{
      name: string;
      subject: string;
      heading: string;
      body: string;
      callToActionText?: string;
      callToActionUrl?: string;
      recipientGroup: EmailRecipientGroup;
      selectedUserIds?: string[];
    }>
  ) =>
    fetchJson<{ campaign: EmailCampaign }>(`/api/v1/admin/email/campaigns/${campaignId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCampaign: (campaignId: string) =>
    fetchJson<{ message: string }>(`/api/v1/admin/email/campaigns/${campaignId}`, {
      method: 'DELETE',
    }),
  getRecipientCount: (recipientGroup: EmailRecipientGroup, selectedUserIds?: string[]) =>
    fetchJson<{ count: number; sampleEmails: string[] }>('/api/v1/admin/email/recipients/count', {
      method: 'POST',
      body: JSON.stringify({ recipientGroup, selectedUserIds }),
    }),
  generateEmailDraft: (payload: {
    campaignType: 'PROMOTIONAL' | 'RENEWAL_REMINDER' | 'ANNOUNCEMENT' | 'CUSTOM';
    goal: string;
    tone: 'PROFESSIONAL' | 'FRIENDLY' | 'URGENT' | 'PERSUASIVE';
    audienceDescription?: string;
    existingSubject?: string;
    existingBody?: string;
  }) =>
    fetchJson<{ draft: EmailDraftResponse }>('/api/v1/admin/email/generate-draft', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sendTestEmail: (payload: {
    toEmail: string;
    subject: string;
    heading: string;
    body: string;
    callToActionText?: string;
    callToActionUrl?: string;
  }) =>
    fetchJson<{ message: string; result: any }>('/api/v1/admin/email/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sendCampaign: (campaignId: string, dryRun?: boolean) =>
    fetchJson<{ message: string; campaign: EmailCampaign; resultsPreview: any[] }>(
      `/api/v1/admin/email/campaigns/${campaignId}/send`,
      {
        method: 'POST',
        body: JSON.stringify({ dryRun }),
      }
    ),
  getReminders: () =>
    fetchJson<{ reminders: SubscriptionReminderRecord[] }>('/api/v1/admin/email/reminders'),
  triggerReminderScan: () =>
    fetchJson<{ message: string; stats: any }>('/api/v1/admin/email/reminders/trigger', {
      method: 'POST',
    }),
  getEmailLogs: (page = 1, limit = 20) =>
    fetchJson<{
      logs: EmailDeliveryLog[];
      pagination: { total: number; page: number; limit: number; totalPages: number };
    }>(`/api/v1/admin/email/logs?page=${page}&limit=${limit}`),

  // Public Unsubscribe
  checkUnsubscribeToken: (token: string) =>
    fetchJson<{ valid: boolean; alreadyUnsubscribed?: boolean; message?: string }>(
      `/api/v1/unsubscribe/${token}`
    ),
  confirmUnsubscribe: (token: string) =>
    fetchJson<{ success: boolean; message: string }>(`/api/v1/unsubscribe/${token}`, {
      method: 'POST',
    }),

  // Official Gmail API OAuth & Operations
  getGmailStatus: () => fetchJson<GmailConnectionStatus>('/api/email/gmail/status'),
  getGmailOAuthUrl: () => fetchJson<{ authUrl: string }>('/api/email/oauth/start'),
  sendGmailTestEmail: () =>
    fetchJson<{ message: string; result: any }>('/api/email/gmail/test', {
      method: 'POST',
    }),
  disconnectGmail: () =>
    fetchJson<{ success: boolean; message: string }>('/api/email/gmail/disconnect', {
      method: 'POST',
    }),

  // Central Agent Manager
  getAgentsOverview: () => fetchJson<AgentOverviewStats>('/api/v1/admin/agents/overview'),
  getAgents: () => fetchJson<{ agents: AgentMetadata[] }>('/api/v1/admin/agents'),
  getAgent: (agentId: string) => fetchJson<{ agent: AgentMetadata }>(`/api/v1/admin/agents/${agentId}`),
  toggleAgent: (agentId: string, enabled: boolean) =>
    fetchJson<{ message: string; config: AgentConfigRecord }>(`/api/v1/admin/agents/${agentId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  updateAgentConfig: (agentId: string, updates: Partial<AgentConfigRecord>) =>
    fetchJson<{ message: string; config: AgentConfigRecord }>(`/api/v1/admin/agents/${agentId}/config`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  runAgentTask: (agentId: string, taskType: string, params: Record<string, any> = {}) =>
    fetchJson<{ message: string; task: AgentExecutionTask }>(`/api/v1/admin/agents/${agentId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ taskType, params }),
    }),
  cancelAgentTask: (taskId: string) =>
    fetchJson<{ message: string; task: AgentExecutionTask }>(`/api/v1/admin/agents/tasks/${taskId}/cancel`, {
      method: 'POST',
    }),
  getAgentTaskHistory: (params: { agentId?: string; status?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.agentId) q.set('agentId', params.agentId);
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    return fetchJson<{ tasks: AgentExecutionTask[]; total: number }>(`/api/v1/admin/agents/tasks/history?${q.toString()}`);
  },
  triggerEmergencyStop: (reason: string) =>
    fetchJson<{ message: string; state: EmergencyStopRecord; cancelledTasksCount: number; uncancellableOperations: string[] }>(
      '/api/v1/admin/agents/emergency-stop',
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),
  resumeEmergencyStop: () =>
    fetchJson<{ message: string; state: EmergencyStopRecord }>('/api/v1/admin/agents/emergency-resume', {
      method: 'POST',
    }),
  executeAgentCommand: (command: string, confirmed: boolean = false) =>
    fetchJson<{
      command: string;
      parsedSteps: Array<{
        agentId: string;
        operation: string;
        params: Record<string, any>;
        requiresConfirmation: boolean;
        description: string;
      }>;
      requiresConfirmation: boolean;
      confirmationPrompt?: string;
      destructiveSteps?: Array<{
        agentId: string;
        operation: string;
        params: Record<string, any>;
        description: string;
      }>;
      results: Array<{
        stepIndex: number;
        agentId: string;
        operation: string;
        status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
        summary: string;
        data?: any;
        error?: string;
      }>;
    }>('/api/v1/admin/agents/command', {
      method: 'POST',
      body: JSON.stringify({ command, confirmed }),
    }),
};
