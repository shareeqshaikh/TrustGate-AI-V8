import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type {
  EmailCampaign,
  SubscriptionReminderRecord,
  EmailDeliveryLog,
  EmailRecipientGroup,
  EmailProviderStatus,
  GmailConnectionStatus,
} from '../types';
import {
  Mail,
  Send,
  Sparkles,
  RefreshCw,
  Eye,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Trash2,
  Edit,
  ShieldCheck,
  Check,
  Info,
  Calendar,
  Users,
  X,
  ExternalLink,
} from 'lucide-react';

export const EmailAutomationPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'reminders' | 'logs'>('campaigns');

  // Status & stats
  const [providerStatus, setProviderStatus] = useState<EmailProviderStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Campaigns state
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  // Compose Form
  const [formName, setFormName] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formHeading, setFormHeading] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCtaText, setFormCtaText] = useState('');
  const [formCtaUrl, setFormCtaUrl] = useState('');
  const [formGroup, setFormGroup] = useState<EmailRecipientGroup>('ALL_ELIGIBLE');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [calculatingRecipients, setCalculatingRecipients] = useState(false);
  const [aiDraftedFlag, setAiDraftedFlag] = useState(false);

  // AI Generator Drawer / Accordion
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiGoal, setAiGoal] = useState('');
  const [aiType, setAiType] = useState<'PROMOTIONAL' | 'RENEWAL_REMINDER' | 'ANNOUNCEMENT' | 'CUSTOM'>('PROMOTIONAL');
  const [aiTone, setAiTone] = useState<'PROFESSIONAL' | 'FRIENDLY' | 'URGENT' | 'PERSUASIVE'>('PROFESSIONAL');
  const [generatingAiDraft, setGeneratingAiDraft] = useState(false);

  // Test Email
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testEmailSuccess, setTestEmailSuccess] = useState<string | null>(null);

  // Send Confirmation Modal
  const [sendTargetCampaign, setSendTargetCampaign] = useState<EmailCampaign | null>(null);
  const [sendingCampaign, setSendingCampaign] = useState(false);

  // Reminders state
  const [reminders, setReminders] = useState<SubscriptionReminderRecord[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [triggeringScan, setTriggeringScan] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<EmailDeliveryLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedPreviewLog, setSelectedPreviewLog] = useState<EmailDeliveryLog | null>(null);

  // Gmail API State
  const [gmailStatus, setGmailStatus] = useState<GmailConnectionStatus | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [disconnectingGmail, setDisconnectingGmail] = useState(false);
  const [sendingGmailTest, setSendingGmailTest] = useState(false);
  const [gmailTestMessage, setGmailTestMessage] = useState<string | null>(null);

  // Fetch Gmail status
  const loadGmailStatus = useCallback(async () => {
    setLoadingGmail(true);
    try {
      const res = await api.getGmailStatus();
      setGmailStatus(res);
    } catch (err) {
      console.error('Failed to load Gmail status:', err);
    } finally {
      setLoadingGmail(false);
    }
  }, []);

  const handleConnectGmail = async () => {
    setConnectingGmail(true);
    try {
      const res = await api.getGmailOAuthUrl();
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    } catch (err: any) {
      alert(err.message || 'Failed to initiate Gmail OAuth flow');
      setConnectingGmail(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!confirm('Disconnect this Gmail account? Stored tokens will be revoked and deleted.')) return;
    setDisconnectingGmail(true);
    try {
      await api.disconnectGmail();
      await loadGmailStatus();
      await loadStatus();
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect Gmail');
    } finally {
      setDisconnectingGmail(false);
    }
  };

  const handleSendGmailTest = async () => {
    setSendingGmailTest(true);
    setGmailTestMessage(null);
    try {
      const res = await api.sendGmailTestEmail();
      setGmailTestMessage(res.message);
      await loadGmailStatus();
      loadLogs();
    } catch (err: any) {
      alert(err.message || 'Failed to send Gmail test email');
    } finally {
      setSendingGmailTest(false);
    }
  };

  // Fetch status
  const loadStatus = useCallback(async () => {
    try {
      const res = await api.getEmailStatus();
      setProviderStatus(res);
    } catch (err) {
      console.error('Failed to load email provider status:', err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Fetch campaigns
  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const res = await api.getCampaigns();
      setCampaigns(res.campaigns);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  // Fetch reminders
  const loadReminders = useCallback(async () => {
    setLoadingReminders(true);
    try {
      const res = await api.getReminders();
      setReminders(res.reminders);
    } catch (err) {
      console.error('Failed to load reminders:', err);
    } finally {
      setLoadingReminders(false);
    }
  }, []);

  // Fetch logs
  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await api.getEmailLogs(1, 50);
      setLogs(res.logs);
    } catch (err) {
      console.error('Failed to load email logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadCampaigns();
    loadGmailStatus();
  }, [loadStatus, loadCampaigns, loadGmailStatus]);

  useEffect(() => {
    if (activeTab === 'reminders') loadReminders();
    if (activeTab === 'logs') loadLogs();
  }, [activeTab, loadReminders, loadLogs]);

  // Recipient count calculator
  const checkRecipients = useCallback(async (group: EmailRecipientGroup) => {
    setCalculatingRecipients(true);
    try {
      const res = await api.getRecipientCount(group);
      setRecipientCount(res.count);
    } catch {
      setRecipientCount(null);
    } finally {
      setCalculatingRecipients(false);
    }
  }, []);

  useEffect(() => {
    if (showComposeModal) {
      checkRecipients(formGroup);
    }
  }, [formGroup, showComposeModal, checkRecipients]);

  const handleOpenCompose = (existing?: EmailCampaign) => {
    if (existing) {
      setEditingCampaignId(existing.id);
      setFormName(existing.name);
      setFormSubject(existing.subject);
      setFormHeading(existing.heading);
      setFormBody(existing.body);
      setFormCtaText(existing.callToActionText || '');
      setFormCtaUrl(existing.callToActionUrl || '');
      setFormGroup(existing.recipientGroup);
      setAiDraftedFlag(existing.aiDrafted);
    } else {
      setEditingCampaignId(null);
      setFormName('');
      setFormSubject('');
      setFormHeading('');
      setFormBody('');
      setFormCtaText('');
      setFormCtaUrl('');
      setFormGroup('ALL_ELIGIBLE');
      setAiDraftedFlag(false);
    }
    setTestEmailSuccess(null);
    setShowAiDrawer(false);
    setShowComposeModal(true);
  };

  // AI Draft Generator handler
  const handleGenerateAiDraft = async () => {
    if (!aiGoal.trim()) {
      alert('Please provide a short goal or topic for the email draft.');
      return;
    }
    setGeneratingAiDraft(true);
    try {
      const res = await api.generateEmailDraft({
        campaignType: aiType,
        goal: aiGoal,
        tone: aiTone,
        existingSubject: formSubject,
        existingBody: formBody,
      });

      setFormSubject(res.draft.subject);
      setFormHeading(res.draft.heading);
      setFormBody(res.draft.body);
      setFormCtaText(res.draft.callToAction);
      if (!formCtaUrl) {
        setFormCtaUrl('http://localhost:5173/plans');
      }
      setAiDraftedFlag(true);
      setShowAiDrawer(false);
    } catch (err: any) {
      alert(err.message || 'Failed to generate AI draft.');
    } finally {
      setGeneratingAiDraft(false);
    }
  };

  // Save Draft
  const handleSaveCampaign = async () => {
    if (!formName.trim() || !formSubject.trim() || !formHeading.trim() || !formBody.trim()) {
      alert('Please fill in Name, Subject, Heading, and Body.');
      return;
    }

    try {
      if (editingCampaignId) {
        await api.updateCampaign(editingCampaignId, {
          name: formName,
          subject: formSubject,
          heading: formHeading,
          body: formBody,
          callToActionText: formCtaText || undefined,
          callToActionUrl: formCtaUrl || undefined,
          recipientGroup: formGroup,
        });
      } else {
        await api.createCampaign({
          name: formName,
          subject: formSubject,
          heading: formHeading,
          body: formBody,
          callToActionText: formCtaText || undefined,
          callToActionUrl: formCtaUrl || undefined,
          recipientGroup: formGroup,
          aiDrafted: aiDraftedFlag,
        });
      }
      setShowComposeModal(false);
      loadCampaigns();
    } catch (err: any) {
      alert(err.message || 'Failed to save campaign.');
    }
  };

  // Send Test Email
  const handleSendTestEmail = async () => {
    if (!testEmailAddress.trim() || !testEmailAddress.includes('@')) {
      alert('Please enter a valid test email address.');
      return;
    }
    if (!formSubject.trim() || !formHeading.trim() || !formBody.trim()) {
      alert('Please enter Subject, Heading, and Body before testing.');
      return;
    }

    setSendingTestEmail(true);
    setTestEmailSuccess(null);
    try {
      const res = await api.sendTestEmail({
        toEmail: testEmailAddress,
        subject: formSubject,
        heading: formHeading,
        body: formBody,
        callToActionText: formCtaText || undefined,
        callToActionUrl: formCtaUrl || undefined,
      });
      setTestEmailSuccess(res.message);
    } catch (err: any) {
      alert(err.message || 'Failed to send test email.');
    } finally {
      setSendingTestEmail(false);
    }
  };

  // Delete Campaign
  const handleDeleteCampaign = async (id: string) => {
    if (!confirm('Are you sure you want to delete this campaign draft?')) return;
    try {
      await api.deleteCampaign(id);
      loadCampaigns();
    } catch (err: any) {
      alert(err.message || 'Failed to delete campaign');
    }
  };

  // Confirm and Send Campaign
  const handleExecuteSend = async () => {
    if (!sendTargetCampaign) return;
    setSendingCampaign(true);
    try {
      const res = await api.sendCampaign(sendTargetCampaign.id);
      alert(res.message);
      setSendTargetCampaign(null);
      loadCampaigns();
      if (activeTab === 'logs') loadLogs();
    } catch (err: any) {
      alert(err.message || 'Failed to dispatch campaign.');
    } finally {
      setSendingCampaign(false);
    }
  };

  // Manual Trigger Reminder Scan
  const handleTriggerReminderScan = async () => {
    setTriggeringScan(true);
    try {
      const res = await api.triggerReminderScan();
      alert(`Reminder scan completed!\nScanned: ${res.stats.scanned}, Reminded: ${res.stats.reminded}, Skipped: ${res.stats.skipped}`);
      loadReminders();
    } catch (err: any) {
      alert(err.message || 'Failed to run reminder scan.');
    } finally {
      setTriggeringScan(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">Email Automation & Campaigns</h1>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60">
              Admin Gateway
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Create AI-assisted campaigns, manage transactional reminders, and monitor live delivery logs.
          </p>
        </div>

        {/* Provider Status Pill */}
        <div className="flex items-center gap-3">
          <div className="bg-dark-900 border border-slate-800 rounded-xl px-4 py-2 flex items-center gap-3 shadow-lg">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200 uppercase">
                  {providerStatus?.provider || 'Loading...'}
                </span>
                {providerStatus?.dryRun ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    DRY-RUN (Safe)
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 max-w-[200px] truncate" title={providerStatus?.details}>
                {providerStatus?.details || 'Checking configuration...'}
              </p>
            </div>
          </div>

          <button
            onClick={() => handleOpenCompose()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-lg shadow-purple-600/20"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Gmail API Integration Card */}
      <div className="bg-gradient-to-r from-red-950/30 via-dark-900 to-slate-900 border border-red-900/30 rounded-2xl p-5 mb-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Official Gmail API Integration (OAuth 2.0)
                </h3>
                {gmailStatus?.connected ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Connected as {gmailStatus.connectedEmail}</span>
                  </span>
                ) : gmailStatus?.needsReconnect ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Needs Reconnect</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    Not Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Authorizes TrustGate to send marketing campaigns and automated 7-day expiry reminders directly through your personal Gmail account via official Google OAuth.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {gmailStatus?.connected ? (
              <>
                <button
                  onClick={handleSendGmailTest}
                  disabled={sendingGmailTest}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition disabled:opacity-50"
                  title="Sends a test email strictly to your registered admin address"
                >
                  {sendingGmailTest ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 text-red-400" />
                  )}
                  <span>Send Test Email</span>
                </button>

                <button
                  onClick={handleDisconnectGmail}
                  disabled={disconnectingGmail}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs font-semibold transition disabled:opacity-50"
                >
                  {disconnectingGmail ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleConnectGmail}
                disabled={connectingGmail}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-lg shadow-red-600/20 disabled:opacity-50"
              >
                {connectingGmail ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                <span>Connect Personal Gmail</span>
              </button>
            )}
          </div>
        </div>

        {/* Daily Send Usage Meter */}
        {gmailStatus?.connected && (
          <div className="mt-4 pt-3 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3 w-full sm:max-w-md">
              <span className="text-slate-400 text-[11px] shrink-0 font-medium">Daily Quota Usage:</span>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-red-500 to-emerald-500 h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        3,
                        ((gmailStatus.todaySendCount || 0) / (gmailStatus.dailySendCap || 100)) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
              <span className="text-slate-300 text-[11px] font-mono shrink-0">
                {gmailStatus.todaySendCount} / {gmailStatus.dailySendCap}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">
              Personal Gmail limit capped at {gmailStatus.dailySendCap}/day to preserve sender reputation.
            </span>
          </div>
        )}

        {gmailTestMessage && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{gmailTestMessage}</span>
          </div>
        )}
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-800 mb-6">
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`flex items-center gap-2 pb-3 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'campaigns'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>Marketing Campaigns</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
            {campaigns.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('reminders')}
          className={`flex items-center gap-2 pb-3 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'reminders'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>7-Day Expiry Reminders</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
            {reminders.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 pb-3 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'logs'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>Delivery History (Outbox)</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
            {logs.length}
          </span>
        </button>
      </div>

      {/* TAB 1: CAMPAIGNS */}
      {activeTab === 'campaigns' && (
        <div className="space-y-4">
          {loadingCampaigns ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
              <p className="text-xs">Loading campaigns...</p>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="bg-dark-900 border border-slate-800 rounded-2xl p-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto mb-3 text-purple-400">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">No Email Campaigns Yet</h3>
              <p className="text-xs text-slate-400 mb-4 max-w-sm mx-auto">
                Draft marketing emails, target subscriber groups, and write copy using the local Ollama AI agent.
              </p>
              <button
                onClick={() => handleOpenCompose()}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition"
              >
                Create Your First Campaign
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaigns.map((camp) => (
                <div
                  key={camp.id}
                  className="bg-dark-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between transition shadow-lg"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                          camp.status === 'SENT'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : camp.status === 'SENDING'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {camp.status}
                      </span>
                      {camp.aiDrafted && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-purple-400 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/40">
                          <Sparkles className="w-3 h-3" />
                          <span>AI Draft</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-white line-clamp-1 mb-1">{camp.name}</h3>
                    <p className="text-xs text-slate-400 line-clamp-1 mb-3 font-medium">
                      Subject: <span className="text-slate-300">{camp.subject}</span>
                    </p>

                    <div className="space-y-1.5 text-[11px] text-slate-400 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60 mb-4">
                      <div className="flex items-center justify-between">
                        <span>Audience:</span>
                        <span className="text-slate-200 font-semibold">{camp.recipientGroup}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Recipients:</span>
                        <span className="text-slate-200 font-semibold">
                          {camp.status === 'SENT' ? `${camp.sentCount} sent` : `${camp.totalRecipients} eligible`}
                        </span>
                      </div>
                      {camp.sentAt && (
                        <div className="flex items-center justify-between">
                          <span>Dispatched:</span>
                          <span className="text-slate-300">
                            {new Date(camp.sentAt).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                    <div className="flex items-center gap-2">
                      {camp.status === 'DRAFT' && (
                        <button
                          onClick={() => handleOpenCompose(camp)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title="Edit Draft"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteCampaign(camp.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition"
                        title="Delete Campaign"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {camp.status === 'DRAFT' ? (
                      <button
                        onClick={() => setSendTargetCampaign(camp)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition"
                      >
                        <Send className="w-3 h-3" />
                        <span>Send...</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500 font-semibold">Completed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: REMINDERS */}
      {activeTab === 'reminders' && (
        <div className="space-y-4">
          <div className="bg-dark-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Automated Expiry Sentinel</h3>
              </div>
              <p className="text-xs text-slate-400 max-w-xl">
                The scheduler runs automatically in the background to find subscriptions expiring in 7 days. It safely checks renewal status and excludes duplicates across server restarts.
              </p>
            </div>
            <button
              onClick={handleTriggerReminderScan}
              disabled={triggeringScan}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold transition disabled:opacity-50"
            >
              {triggeringScan ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
              <span>Run Sentinel Scan Now</span>
            </button>
          </div>

          {loadingReminders ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-400" />
              <p className="text-xs">Loading reminder records...</p>
            </div>
          ) : reminders.length === 0 ? (
            <div className="bg-dark-900 border border-slate-800 rounded-2xl p-12 text-center">
              <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <h4 className="text-sm font-bold text-white mb-1">No Active Reminders Found</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                No active subscriptions currently meet the 7-day expiration threshold. Once a subscription nears expiry, it will automatically appear here.
              </p>
            </div>
          ) : (
            <div className="bg-dark-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Subscription</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Expiry Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Attempts</th>
                      <th className="px-4 py-3">Sent Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {reminders.map((rem) => (
                      <tr key={rem.id} className="hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3 font-mono text-slate-400">{rem.subscriptionId}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">{rem.userName}</div>
                          <div className="text-[11px] text-slate-400">{rem.userEmail}</div>
                        </td>
                        <td className="px-4 py-3 uppercase font-semibold text-slate-300">{rem.planId}</td>
                        <td className="px-4 py-3 text-slate-300 font-medium">
                          {new Date(rem.targetExpiryDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                              rem.status === 'SENT'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : rem.status.startsWith('SKIPPED')
                                ? 'bg-slate-800 text-slate-400 border border-slate-700'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {rem.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">{rem.attempts}</td>
                        <td className="px-4 py-3 text-slate-400 text-[11px]">
                          {rem.sentAt ? new Date(rem.sentAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LOGS */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Outbox & Delivery Telemetry</h3>
            <button
              onClick={loadLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Logs</span>
            </button>
          </div>

          {loadingLogs ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
              <p className="text-xs">Loading delivery logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="bg-dark-900 border border-slate-800 rounded-2xl p-12 text-center">
              <Eye className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <h4 className="text-sm font-bold text-white mb-1">No Delivery Logs Yet</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Sent campaigns, test emails, and automated expiry reminders will be archived here.
              </p>
            </div>
          ) : (
            <div className="bg-dark-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Recipient</th>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Provider</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3 text-right">Preview</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3 font-semibold text-slate-300">{log.type}</td>
                        <td className="px-4 py-3 font-mono text-slate-300">{log.recipientEmail}</td>
                        <td className="px-4 py-3 max-w-[200px] truncate text-white">{log.subject}</td>
                        <td className="px-4 py-3 uppercase text-[10px] font-bold text-slate-400">
                          {log.provider}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                              log.status === 'DELIVERED'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : log.status === 'DRY_RUN'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-[11px]">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {log.previewText ? (
                            <button
                              onClick={() => setSelectedPreviewLog(log)}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-purple-400 text-[11px] font-semibold transition"
                            >
                              Inspect
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMPOSE / EDIT MODAL */}
      {showComposeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-dark-900 border border-slate-800 rounded-2xl w-full max-w-4xl p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-bold text-white">
                  {editingCampaignId ? 'Edit Campaign Draft' : 'Compose Email Campaign'}
                </h2>
              </div>
              <button
                onClick={() => setShowComposeModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Form Controls */}
              <div className="space-y-4">
                {/* AI Assistant Accordion Bar */}
                <div className="bg-gradient-to-r from-purple-950/40 to-slate-900 border border-purple-800/40 rounded-xl p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span className="text-xs font-bold text-purple-300">Ollama Email Copywriter</span>
                    </div>
                    <button
                      onClick={() => setShowAiDrawer(!showAiDrawer)}
                      className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition flex items-center gap-1"
                    >
                      <span>{showAiDrawer ? 'Close AI Draft' : '✨ Generate Draft'}</span>
                    </button>
                  </div>

                  {showAiDrawer && (
                    <div className="mt-4 pt-3 border-t border-purple-800/30 space-y-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                          Campaign Goal or Topic:
                        </label>
                        <input
                          type="text"
                          value={aiGoal}
                          onChange={(e) => setAiGoal(e.target.value)}
                          placeholder="e.g. Announce 20% discount on yearly plan renewal"
                          className="w-full px-3 py-1.5 bg-dark-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 mb-1">Type</label>
                          <select
                            value={aiType}
                            onChange={(e) => setAiType(e.target.value as any)}
                            className="w-full px-2 py-1.5 bg-dark-950 border border-slate-800 rounded-lg text-xs text-white"
                          >
                            <option value="PROMOTIONAL">Promotional</option>
                            <option value="RENEWAL_REMINDER">Renewal Reminder</option>
                            <option value="ANNOUNCEMENT">Announcement</option>
                            <option value="CUSTOM">Custom</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 mb-1">Tone</label>
                          <select
                            value={aiTone}
                            onChange={(e) => setAiTone(e.target.value as any)}
                            className="w-full px-2 py-1.5 bg-dark-950 border border-slate-800 rounded-lg text-xs text-white"
                          >
                            <option value="PROFESSIONAL">Professional</option>
                            <option value="FRIENDLY">Friendly</option>
                            <option value="URGENT">Urgent</option>
                            <option value="PERSUASIVE">Persuasive</option>
                          </select>
                        </div>
                      </div>

                      <button
                        onClick={handleGenerateAiDraft}
                        disabled={generatingAiDraft}
                        className="w-full py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2"
                      >
                        {generatingAiDraft ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Drafting with llama3.2:1b...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Generate Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Campaign Fields */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Campaign Name (Internal)</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. October Plan Upgrade Promotion"
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-300">Audience Group</label>
                    <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {calculatingRecipients ? 'Calculating...' : `${recipientCount ?? 0} Eligible`}
                    </span>
                  </div>
                  <select
                    value={formGroup}
                    onChange={(e) => setFormGroup(e.target.value as EmailRecipientGroup)}
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white"
                  >
                    <option value="ALL_ELIGIBLE">All Registered Users (Honors Marketing Opt-Out)</option>
                    <option value="ACTIVE_SUBSCRIBERS">Active Subscribers Only</option>
                    <option value="EXPIRED_SUBSCRIBERS">Expired Subscribers Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Subject Line</label>
                  <input
                    type="text"
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    placeholder="Catchy subject line seen in inboxes"
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Email Heading (H1)</label>
                  <input
                    type="text"
                    value={formHeading}
                    onChange={(e) => setFormHeading(e.target.value)}
                    placeholder="Top banner heading inside the email"
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Body Text</label>
                  <textarea
                    rows={5}
                    value={formBody}
                    onChange={(e) => setFormBody(e.target.value)}
                    placeholder="Main email body (paragraphs separated by line breaks)"
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Button Text (Optional)</label>
                    <input
                      type="text"
                      value={formCtaText}
                      onChange={(e) => setFormCtaText(e.target.value)}
                      placeholder="e.g. Upgrade Now"
                      className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Button URL</label>
                    <input
                      type="text"
                      value={formCtaUrl}
                      onChange={(e) => setFormCtaUrl(e.target.value)}
                      placeholder="http://localhost:5173/plans"
                      className="w-full px-3 py-2 bg-dark-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Right Side: Live Email Preview & Test Dispatch */}
              <div className="flex flex-col justify-between space-y-4">
                <div>
                  <span className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
                    Desktop Live Mockup Preview
                  </span>

                  {/* Mock Email Frame */}
                  <div className="border border-slate-800 bg-[#020617] rounded-xl p-5 shadow-inner">
                    <div className="border-b border-slate-800/80 pb-3 mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-white">TrustGate</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                          Lite
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">noreply@trustgate.ai</span>
                    </div>

                    <h2 className="text-base font-bold text-white mb-3">
                      {formHeading || 'Your Email Heading Goes Here'}
                    </h2>

                    <div className="text-xs text-slate-300 leading-relaxed space-y-2 mb-4">
                      {formBody ? (
                        formBody.split('\n').map((p, i) => (
                          <p key={i} className="min-h-[1em]">
                            {p}
                          </p>
                        ))
                      ) : (
                        <p className="text-slate-500 italic">Email message paragraphs will render here...</p>
                      )}
                    </div>

                    {formCtaText && (
                      <div className="text-center my-4">
                        <span className="inline-block px-5 py-2 rounded-lg bg-emerald-500 text-black font-bold text-xs select-none">
                          {formCtaText}
                        </span>
                      </div>
                    )}

                    <div className="border-t border-slate-800/60 pt-3 mt-4 text-[10px] text-slate-500 text-center">
                      <p>You received this because you opted in to TrustGate product updates.</p>
                      <span className="text-emerald-400 underline cursor-pointer">Unsubscribe</span>
                    </div>
                  </div>
                </div>

                {/* Send Test Email Card */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
                  <span className="block text-xs font-semibold text-slate-300 mb-1.5">Send Quick Test Email</span>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={testEmailAddress}
                      onChange={(e) => setTestEmailAddress(e.target.value)}
                      placeholder="admin@example.com"
                      className="flex-1 px-3 py-1.5 bg-dark-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    />
                    <button
                      onClick={handleSendTestEmail}
                      disabled={sendingTestEmail}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1"
                    >
                      {sendingTestEmail ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      <span>Test</span>
                    </button>
                  </div>
                  {testEmailSuccess && (
                    <p className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>{testEmailSuccess}</span>
                    </p>
                  )}
                </div>

                {/* Modal Footer Buttons */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    onClick={() => setShowComposeModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCampaign}
                    className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-lg shadow-purple-600/20"
                  >
                    Save Draft
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM CAMPAIGN DISPATCH MODAL */}
      {sendTargetCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-dark-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirm Campaign Dispatch</h3>
                <span className="text-xs text-slate-400">{sendTargetCampaign.name}</span>
              </div>
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-300 mb-6">
              <div className="flex justify-between">
                <span className="text-slate-400">Recipient Group:</span>
                <span className="font-semibold text-white">{sendTargetCampaign.recipientGroup}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Recipients:</span>
                <span className="font-semibold text-emerald-400">{sendTargetCampaign.totalRecipients}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Active Mode:</span>
                <span className="font-bold uppercase text-amber-400">
                  {providerStatus?.dryRun ? 'DRY-RUN (Safe Simulation)' : 'LIVE SENDING'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setSendTargetCampaign(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteSend}
                disabled={sendingCampaign}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition flex items-center gap-2"
              >
                {sendingCampaign && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm & Dispatch</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INSPECT LOG MODAL */}
      {selectedPreviewLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-dark-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-sm font-bold text-white">Delivery Log Inspection</h3>
              <button
                onClick={() => setSelectedPreviewLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>To: <strong className="text-white">{selectedPreviewLog.recipientEmail}</strong></span>
                <span>Type: <strong className="text-purple-400">{selectedPreviewLog.type}</strong></span>
              </div>
              <div className="text-slate-400">
                Subject: <strong className="text-white">{selectedPreviewLog.subject}</strong>
              </div>
              <div>
                <span className="block text-[10px] uppercase font-bold text-slate-500 mb-1">
                  Preview Content / Text Snippet:
                </span>
                <pre className="bg-dark-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto font-sans">
                  {selectedPreviewLog.previewText || 'No text snippet recorded'}
                </pre>
              </div>
              {selectedPreviewLog.errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px]">
                  Error: {selectedPreviewLog.errorMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
