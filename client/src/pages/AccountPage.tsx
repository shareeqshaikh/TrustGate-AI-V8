import React, { useState, useEffect, useCallback } from 'react';
import {
  User as UserIcon,
  Key,
  ShieldCheck,
  Clock,
  Eye,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  CheckSquare,
  XSquare,
  QrCode,
  ExternalLink,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { api } from '../api';
import type { User, Subscription, Order, ApiKeyMetadata, RefundRecord } from '../types';

interface AccountPageProps {
  onGoToPlans: () => void;
  onSelectOrder: (order: Order) => void;
}

export const AccountPage: React.FC<AccountPageProps> = ({ onGoToPlans, onSelectOrder }) => {
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [apiKey, setApiKey] = useState<ApiKeyMetadata | null>(null);
  const [userRefunds, setUserRefunds] = useState<RefundRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // One-time revealed key state
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealingKey, setRevealingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Key operations
  const [revoking, setRevoking] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Ping tester state
  const [pingKeyInput, setPingKeyInput] = useState('');
  const [pingLoading, setPingLoading] = useState(false);
  const [pingResult, setPingResult] = useState<{
    success: boolean;
    data?: any;
    error?: string;
  } | null>(null);

  // Refund Request State (Customer)
  const [selectedOrderForRefund, setSelectedOrderForRefund] = useState<Order | null>(null);
  const [refundUpiId, setRefundUpiId] = useState('');
  const [refundReasonType, setRefundReasonType] = useState('Service not meeting expectations');
  const [refundDetails, setRefundDetails] = useState('');
  const [submittingRefund, setSubmittingRefund] = useState(false);

  // Admin Management Queues State
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [adminRefunds, setAdminRefunds] = useState<RefundRecord[]>([]);
  const [loadingAdminQueues, setLoadingAdminQueues] = useState(false);
  const [orderActionBusyId, setOrderActionBusyId] = useState<string | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState('Payment not received or invalid UTR');
  const [payoutUtrInputs, setPayoutUtrInputs] = useState<Record<string, string>>({});
  const [payoutBusyId, setPayoutBusyId] = useState<string | null>(null);
  const [activeQrModalRefund, setActiveQrModalRefund] = useState<RefundRecord | null>(null);

  // Status mapping for customer display
  const getCustomerRefundStatusLabel = (status: string): string => {
    switch (status) {
      case 'REQUESTED':
        return 'Requested';
      case 'APPROVED_PAYOUT_PENDING':
        return 'Approved — Payout Pending';
      case 'AWAITING_MANUAL_PAYOUT':
        return 'Awaiting Manual Payout';
      case 'PAID':
        return 'Paid';
      case 'REFUNDED':
        return 'Refunded';
      case 'REJECTED':
        return 'Rejected';
      case 'FAILED':
        return 'Failed';
      default:
        return status;
    }
  };

  const fetchAdminQueues = useCallback(async () => {
    try {
      setLoadingAdminQueues(true);
      const [ordersRes, refundsRes] = await Promise.all([
        api.getAdminOrders().catch(() => ({ orders: [] })),
        api.getAdminRefunds().catch(() => ({ refunds: [] })),
      ]);
      setAdminOrders(ordersRes.orders);
      setAdminRefunds(refundsRes.refunds);
    } catch {
      // Ignore admin queue errors
    } finally {
      setLoadingAdminQueues(false);
    }
  }, []);

  const fetchAccount = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [accRes, refundsRes] = await Promise.all([
        api.getAccount(),
        api.getRefunds().catch(() => ({ refunds: [] })),
      ]);
      setUser(accRes.user);
      setSubscription(accRes.subscription);
      setOrders(accRes.orders);
      setApiKey(accRes.apiKey);
      setUserRefunds(refundsRes.refunds);

      if (accRes.user?.role === 'admin') {
        fetchAdminQueues();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load account details');
    } finally {
      setLoading(false);
    }
  }, [fetchAdminQueues]);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const handleRevealKey = async () => {
    if (!apiKey) return;
    setRevealingKey(true);
    setError(null);
    try {
      const res = await api.revealKey(apiKey.id);
      setRevealedKey(res.plaintextKey);
      setPingKeyInput(res.plaintextKey);
      setActionSuccess('Key revealed! It has now been deleted from the server storage.');
      setApiKey((prev) => (prev ? { ...prev, hasOneTimeReveal: false } : null));
    } catch (err: any) {
      setError(err.message || 'Could not reveal API key');
    } finally {
      setRevealingKey(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!apiKey) return;
    if (
      !window.confirm(
        'Are you sure you want to revoke this API key? Protected requests with this key will immediately fail.'
      )
    ) {
      return;
    }

    setRevoking(true);
    setError(null);
    try {
      await api.revokeKey(apiKey.id);
      setActionSuccess('API key has been revoked.');
      await fetchAccount();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke API key');
    } finally {
      setRevoking(false);
    }
  };

  const handleRegenerateKey = async () => {
    if (!window.confirm('Regenerate key? Your existing key will be permanently revoked.')) {
      return;
    }

    setRegenerating(true);
    setError(null);
    try {
      const res = await api.regenerateKey();
      setActionSuccess('New API key generated!');
      if (res.apiKey?.plaintextKey) {
        setRevealedKey(res.apiKey.plaintextKey);
        setPingKeyInput(res.apiKey.plaintextKey);
      }
      await fetchAccount();
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate API key');
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopyRevealedKey = () => {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleRunPingTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const keyToTest = pingKeyInput.trim() || revealedKey || '';
    if (!keyToTest) {
      setPingResult({ success: false, error: 'Please enter or reveal an API key first' });
      return;
    }

    setPingLoading(true);
    setPingResult(null);
    try {
      const res = await api.pingWithKey(keyToTest);
      setPingResult({ success: true, data: res });
    } catch (err: any) {
      setPingResult({ success: false, error: err.message || 'Ping failed' });
    } finally {
      setPingLoading(false);
    }
  };

  // Customer: Open Refund Modal
  const handleOpenRefundModal = (order: Order) => {
    setSelectedOrderForRefund(order);
    setRefundUpiId('');
    setRefundReasonType('Service not meeting expectations');
    setRefundDetails('');
  };

  // Customer: Submit Refund
  const handleSubmitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderForRefund) return;

    const cleanUpi = refundUpiId.trim();
    if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(cleanUpi)) {
      setError('Please enter a valid UPI ID (e.g. name@okhdfcbank or 9876543210@upi)');
      return;
    }

    const fullReason = refundDetails.trim()
      ? `${refundReasonType}: ${refundDetails.trim()}`
      : refundReasonType;

    setSubmittingRefund(true);
    setError(null);
    try {
      const res = await api.requestRefund({
        orderId: selectedOrderForRefund.id,
        userUpiId: cleanUpi,
        reason: fullReason,
      });
      setActionSuccess(res.message);
      setSelectedOrderForRefund(null);
      await fetchAccount();
    } catch (err: any) {
      setError(err.message || 'Failed to submit refund request');
    } finally {
      setSubmittingRefund(false);
    }
  };

  // Admin: Confirm Order
  const handleAdminConfirmOrder = async (order: Order) => {
    if (order.userId === user?.id) {
      alert('Segregation of duties: You cannot verify your own order.');
      return;
    }
    if (!window.confirm(`Verify and confirm order ${order.reference} (UTR: ${order.utr})? This will immediately activate the customer's subscription.`)) {
      return;
    }

    setOrderActionBusyId(order.id);
    setError(null);
    try {
      const res = await api.confirmAdminOrder(order.id);
      setActionSuccess(`Order ${order.reference} confirmed! Subscription activated.`);
      await fetchAccount();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm order');
    } finally {
      setOrderActionBusyId(null);
    }
  };

  // Admin: Reject Order
  const handleAdminRejectOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingOrder) return;

    setOrderActionBusyId(rejectingOrder.id);
    setError(null);
    try {
      await api.rejectAdminOrder(rejectingOrder.id, rejectReason);
      setActionSuccess(`Order ${rejectingOrder.reference} rejected.`);
      setRejectingOrder(null);
      await fetchAccount();
    } catch (err: any) {
      setError(err.message || 'Failed to reject order');
    } finally {
      setOrderActionBusyId(null);
    }
  };

  // Admin: Mark Refund Paid
  const handleAdminMarkPaid = async (refund: RefundRecord) => {
    const payoutUtr = (payoutUtrInputs[refund.id] || '').trim();
    if (!/^\d{12}$/.test(payoutUtr)) {
      alert('Please enter a valid 12-digit numeric Payout UTR from your bank transfer.');
      return;
    }

    setPayoutBusyId(refund.id);
    setError(null);
    try {
      await api.markRefundPaid(refund.id, payoutUtr);
      setActionSuccess(`Refund for ${refund.orderReference} marked as PAID (UTR: ${payoutUtr})`);
      setPayoutUtrInputs((prev) => ({ ...prev, [refund.id]: '' }));
      setActiveQrModalRefund(null);
      await fetchAccount();
    } catch (err: any) {
      setError(err.message || 'Failed to mark refund as paid');
    } finally {
      setPayoutBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
        <p className="text-sm text-slate-400 font-medium">Loading account details...</p>
      </div>
    );
  }

  // Filter pending queues for admin
  const ordersAwaitingVerification = adminOrders.filter(
    (o) => o.status === 'AWAITING_VERIFICATION'
  );
  const refundsPendingPayout = adminRefunds.filter(
    (r) => r.status === 'APPROVED_PAYOUT_PENDING' || r.status === 'AWAITING_MANUAL_PAYOUT'
  );

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">My Account</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage your subscription, reveal your secure API key, and monitor transaction status
          </p>
        </div>
        {user?.role === 'admin' && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Administrator Control Active</span>
          </span>
        )}
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/60 border border-red-500/50 text-red-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-white">✕</button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* User & Subscription Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* User Profile Card */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300">
              <UserIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{user?.name}</h2>
              <p className="text-xs text-slate-400">{user?.email}</p>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Account Role:</span>
              <span className="font-semibold text-white uppercase">{user?.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Member Since:</span>
              <span className="text-slate-300">
                {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Subscription Status Card */}
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Subscription Status</h2>
                <p className="text-xs text-slate-400">Gateway API access state</p>
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                subscription?.status === 'ACTIVE'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : subscription?.status === 'CANCELLED' || subscription?.status === 'REFUNDED'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {subscription?.status || 'NO ACTIVE PLAN'}
            </span>
          </div>

          <div className="pt-3 border-t border-slate-800 text-xs space-y-2">
            {subscription && subscription.status === 'ACTIVE' ? (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400">Active Plan:</span>
                  <span className="font-bold text-white uppercase">{subscription.planId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Expires At:</span>
                  <span className="font-mono text-emerald-300">
                    {new Date(subscription.expiresAt).toLocaleString()}
                  </span>
                </div>
              </>
            ) : (
              <div className="py-2 text-center">
                <p className="text-slate-400 text-xs mb-3">
                  {subscription?.status === 'CANCELLED' || subscription?.status === 'REFUNDED'
                    ? 'Subscription cancelled following refund claim.'
                    : 'Unlock production API access by selecting a subscription plan.'}
                </p>
                <button
                  onClick={onGoToPlans}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition inline-flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>View UPI Plans (from ₹2)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* ADMIN SECTION: ORDERS VERIFICATION & REFUND PAYOUT QUEUES    */}
      {/* ------------------------------------------------------------- */}
      {user?.role === 'admin' && (
        <div className="space-y-6 pt-4 border-t-2 border-amber-500/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-amber-300 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <span>Admin Queues — UPI Orders & Manual Payouts</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Segregation of duties: Review customer UTRs against bank records. Mark payouts after sending UPI transfers.
              </p>
            </div>
            <button
              onClick={fetchAdminQueues}
              disabled={loadingAdminQueues}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAdminQueues ? 'animate-spin' : ''}`} />
              <span>Refresh Queues</span>
            </button>
          </div>

          {/* Queue A: Orders Awaiting UTR Verification */}
          <div className="glass-panel rounded-2xl p-6 border border-amber-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Orders Awaiting UTR Verification</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-extrabold">
                    {ordersAwaitingVerification.length} PENDING
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Verify the 12-digit UTR against your SBI UPI app (Shareeq Shaikh / shareeqshaikh194@oksbi)
                </p>
              </div>
            </div>

            {ordersAwaitingVerification.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 bg-dark-900/40 rounded-xl border border-slate-800">
                <Check className="w-6 h-6 text-emerald-500/50 mx-auto mb-1" />
                <span>No orders awaiting verification. All customer payments settled.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-800/40 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-3">Order Ref</th>
                      <th className="py-3 px-3">Customer</th>
                      <th className="py-3 px-3">Plan</th>
                      <th className="py-3 px-3">Amount</th>
                      <th className="py-3 px-3">Customer UTR</th>
                      <th className="py-3 px-3">Submitted At</th>
                      <th className="py-3 px-3 text-right">Verification Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {ordersAwaitingVerification.map((ord) => {
                      const isOwnOrder = ord.userId === user?.id;
                      const isBusy = orderActionBusyId === ord.id;
                      return (
                        <tr key={ord.id} className="hover:bg-slate-800/30">
                          <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                            {ord.reference}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-white">{ord.userName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{ord.userEmail}</div>
                          </td>
                          <td className="py-3 px-3 uppercase font-semibold text-white">
                            {ord.planId}
                          </td>
                          <td className="py-3 px-3 font-extrabold text-white">
                            ₹{(ord.amountPaise / 100).toFixed(2)}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-amber-300 text-sm">
                            {ord.utr}
                          </td>
                          <td className="py-3 px-3 text-slate-400">
                            {ord.utrSubmittedAt ? new Date(ord.utrSubmittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {isOwnOrder ? (
                              <span className="text-[10px] font-semibold text-rose-400 bg-rose-950/40 px-2 py-1 rounded border border-rose-500/30">
                                Own Order (Segregation Rule)
                              </span>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleAdminConfirmOrder(ord)}
                                  disabled={isBusy}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-[11px] transition shadow flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                                >
                                  <CheckSquare className="w-3.5 h-3.5" />
                                  <span>{isBusy ? 'Verifying...' : 'Verify & Confirm'}</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectingOrder(ord);
                                    setRejectReason('Payment not received or invalid UTR');
                                  }}
                                  disabled={isBusy}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/40 text-[11px] font-semibold transition"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Queue B: Refunds Pending Manual Payout */}
          <div className="glass-panel rounded-2xl p-6 border border-emerald-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Refunds Awaiting Manual Payout</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold">
                    {refundsPendingPayout.length} TO PAY
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Scan QR from your UPI App to send payout, then enter the 12-digit bank UTR to mark paid.
                </p>
              </div>
            </div>

            {refundsPendingPayout.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 bg-dark-900/40 rounded-xl border border-slate-800">
                <Check className="w-6 h-6 text-emerald-500/50 mx-auto mb-1" />
                <span>No refunds pending payout. All claims disbursed.</span>
              </div>
            ) : (
              <div className="space-y-4">
                {refundsPendingPayout.map((ref) => {
                  const rupees = (ref.amountPaise / 100).toFixed(2);
                  const isBusy = payoutBusyId === ref.id;
                  const currentUtrInput = payoutUtrInputs[ref.id] || '';

                  return (
                    <div
                      key={ref.id}
                      className="p-4 rounded-xl bg-dark-900/80 border border-slate-700/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-sm">{ref.id}</span>
                          <span className="text-xs text-slate-400">for Order</span>
                          <span className="font-mono text-emerald-400 font-bold">{ref.orderReference}</span>
                          <span className="text-sm font-extrabold text-white ml-2">₹{rupees}</span>
                        </div>
                        <div className="text-xs text-slate-300 flex items-center gap-3">
                          <span>User: <strong className="text-white">{ref.userName}</strong> ({ref.userEmail})</span>
                          <span>•</span>
                          <span>UPI ID: <strong className="font-mono text-emerald-300">{ref.userUpiId}</strong></span>
                        </div>
                        <div className="text-[11px] text-slate-400 italic">
                          Reason: {ref.reason}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full md:w-auto">
                        {/* Scan to Pay QR Button */}
                        <button
                          onClick={() => setActiveQrModalRefund(ref)}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
                          title="View Payout QR Code"
                        >
                          <QrCode className="w-4 h-4 text-emerald-400" />
                          <span>Scan QR</span>
                        </button>

                        {/* Payout UTR input */}
                        <input
                          type="text"
                          maxLength={12}
                          value={currentUtrInput}
                          onChange={(e) =>
                            setPayoutUtrInputs((prev) => ({
                              ...prev,
                              [ref.id]: e.target.value.replace(/\D/g, ''),
                            }))
                          }
                          placeholder="12-digit Payout UTR"
                          className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 font-mono text-xs text-white placeholder-slate-500 w-36 focus:outline-none focus:border-emerald-500"
                        />

                        {/* Mark Paid Button */}
                        <button
                          onClick={() => handleAdminMarkPaid(ref)}
                          disabled={isBusy || currentUtrInput.length !== 12}
                          className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition shadow flex items-center gap-1.5 shrink-0 disabled:opacity-40 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isBusy ? 'Recording...' : 'Mark Paid'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* API KEY SECTION                                               */}
      {/* ------------------------------------------------------------- */}
      <div id="api-key-section" className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-emerald-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Production API Key</h2>
              <p className="text-xs text-slate-400">Secured with SHA-256 cryptographic hashing</p>
            </div>
          </div>

          {apiKey && !apiKey.revoked && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleRevokeKey}
                disabled={revoking}
                className="px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/40 text-xs font-semibold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{revoking ? 'Revoking...' : 'Revoke'}</span>
              </button>
              <button
                onClick={handleRegenerateKey}
                disabled={regenerating}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                <span>{regenerating ? 'Generating...' : 'Regenerate'}</span>
              </button>
            </div>
          )}
        </div>

        {apiKey ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-dark-900/80 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-white font-semibold">
                    {apiKey.prefix}••••••••{apiKey.last4}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                      apiKey.revoked
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {apiKey.revoked ? 'REVOKED' : 'ACTIVE'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Created on {new Date(apiKey.createdAt).toLocaleDateString()}
                </p>
              </div>

              {apiKey.hasOneTimeReveal && !revealedKey && (
                <button
                  onClick={handleRevealKey}
                  disabled={revealingKey}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition flex items-center gap-1.5 shadow-lg"
                >
                  <Eye className="w-4 h-4" />
                  <span>{revealingKey ? 'Revealing...' : 'Reveal Key Once'}</span>
                </button>
              )}
            </div>

            {revealedKey && (
              <div className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                      Your Plaintext API Key (Copy Now)
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-400/80">Deleted from server storage</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 rounded-xl bg-black/60 border border-emerald-500/40 font-mono text-xs text-emerald-300 select-all break-all">
                    {revealedKey}
                  </div>
                  <button
                    onClick={handleCopyRevealedKey}
                    className="p-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold transition shrink-0 cursor-pointer"
                    title="Copy API Key"
                  >
                    {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center bg-dark-900/40 rounded-xl border border-slate-800">
            <Key className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-300 font-semibold">No API Key Generated</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
              API keys are generated automatically when a UPI order is confirmed by the administrator.
            </p>
          </div>
        )}

        {/* Live Protected Endpoint Tester */}
        <div className="pt-6 border-t border-slate-800/80">
          <div className="flex items-center gap-2 mb-2">
            <Play className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Live Test Protected Endpoint: GET /api/v1/ping
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Validates your API key with cryptographic SHA-256 hash match against active subscription.
          </p>

          <form onSubmit={handleRunPingTest} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={pingKeyInput}
                onChange={(e) => setPingKeyInput(e.target.value)}
                placeholder="Enter plaintext API key (e.g. tg_live_...)"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-dark-900/90 border border-slate-700 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
              <button
                type="submit"
                disabled={pingLoading}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
              >
                <Play className={`w-3.5 h-3.5 fill-current ${pingLoading ? 'animate-pulse' : ''}`} />
                <span>{pingLoading ? 'Testing...' : 'Test GET /ping'}</span>
              </button>
            </div>
          </form>

          {pingResult && (
            <div
              className={`mt-4 p-4 rounded-xl border text-xs font-mono ${
                pingResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                  : 'bg-red-950/40 border-red-500/50 text-red-300'
              }`}
            >
              <div className="flex items-center gap-2 font-bold mb-2">
                {pingResult.success ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>200 OK — Authentication Successful</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span>401 Unauthorized — Authentication Denied</span>
                  </>
                )}
              </div>
              <pre className="text-[11px] overflow-x-auto p-2 rounded bg-black/50 border border-white/5">
                {JSON.stringify(pingResult.data || { error: pingResult.error }, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* CUSTOMER ORDER HISTORY TABLE                                  */}
      {/* ------------------------------------------------------------- */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div>
          <h2 className="text-base font-bold text-white">Order History</h2>
          <p className="text-xs text-slate-400">All your subscription orders and verification states</p>
        </div>

        {orders.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No orders found. Select a plan to start your first order.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/40 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Plan</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Submitted UTR</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {orders.map((o) => {
                  const rupees = (o.amountPaise / 100).toFixed(2);
                  const isPendingPayment = o.status === 'PENDING';
                  const isAwaitingVerification = o.status === 'AWAITING_VERIFICATION';
                  const isRejected = o.status === 'REJECTED';
                  const isConfirmed = o.status === 'CONFIRMED';

                  const orderRefund = userRefunds.find((r) => r.orderId === o.id);
                  const isRefundCompleted = o.refunded || orderRefund?.status === 'PAID' || orderRefund?.status === 'REFUNDED';
                  const isRefundInProgress =
                    orderRefund &&
                    (orderRefund.status === 'REQUESTED' ||
                      orderRefund.status === 'APPROVED_PAYOUT_PENDING' ||
                      orderRefund.status === 'AWAITING_MANUAL_PAYOUT');

                  const confirmedTime = new Date(o.confirmedAt || o.createdAt).getTime();
                  const isEligibleForRefund =
                    isConfirmed &&
                    !isRefundCompleted &&
                    !isRefundInProgress &&
                    Date.now() - confirmedTime <= 7 * 24 * 60 * 60 * 1000;

                  return (
                    <tr key={o.id} className="hover:bg-slate-800/20 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-emerald-400">
                        {o.reference}
                      </td>
                      <td className="py-3 px-4 uppercase font-semibold text-white">
                        {o.planId === '7days' || o.planId === 'monthly' ? '7 Days' : '30 Days'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-white">₹{rupees}</td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {o.utr || <span className="text-slate-500 italic">Not submitted</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                            isRefundCompleted
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : isConfirmed
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : isAwaitingVerification
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : isRejected
                              ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {isRefundCompleted ? 'REFUNDED' : o.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isPendingPayment && (
                          <button
                            onClick={() => onSelectOrder(o)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold transition"
                          >
                            Scan QR / Enter UTR
                          </button>
                        )}

                        {isAwaitingVerification && (
                          <button
                            onClick={() => onSelectOrder(o)}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <Clock className="w-3 h-3" />
                            <span>Awaiting Admin Verification</span>
                          </button>
                        )}

                        {isRejected && (
                          <button
                            onClick={() => onSelectOrder(o)}
                            className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/40 text-[11px] font-semibold"
                          >
                            Re-submit UTR
                          </button>
                        )}

                        {isConfirmed && (
                          <div className="flex items-center justify-end gap-2">
                            {isRefundCompleted ? (
                              <span className="text-[10px] text-rose-400 font-bold uppercase">
                                Refunded
                              </span>
                            ) : isRefundInProgress ? (
                              <span className="text-[10px] text-amber-300 font-bold uppercase">
                                Refund in Progress
                              </span>
                            ) : isEligibleForRefund ? (
                              <button
                                onClick={() => handleOpenRefundModal(o)}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 text-[11px] font-semibold transition"
                              >
                                Request Auto-Refund
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* CUSTOMER REFUND REQUESTS TABLE                                */}
      {/* ------------------------------------------------------------- */}
      {userRefunds.length > 0 && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div>
            <h2 className="text-base font-bold text-white">My Refund Requests</h2>
            <p className="text-xs text-slate-400">Deterministic auto-approval logs and manual payout status</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/40 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Refund ID</th>
                  <th className="py-3 px-4">Order Ref</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Receiving UPI ID</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Payout UTR</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {userRefunds.map((r) => {
                  const rupees = (r.amountPaise / 100).toFixed(2);
                  const isPaid = r.status === 'PAID' || r.status === 'REFUNDED';
                  const isPending = r.status === 'APPROVED_PAYOUT_PENDING' || r.status === 'AWAITING_MANUAL_PAYOUT';

                  return (
                    <tr key={r.id} className="hover:bg-slate-800/20 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-300">{r.id}</td>
                      <td className="py-3 px-4 font-mono font-semibold text-emerald-400">{r.orderReference}</td>
                      <td className="py-3 px-4 font-semibold text-white">₹{rupees}</td>
                      <td className="py-3 px-4 font-mono text-emerald-300">{r.userUpiId}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                            isPaid
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : isPending
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {getCustomerRefundStatusLabel(r.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-amber-300 font-bold">
                        {r.payoutUtr || <span className="text-slate-500 italic font-normal">Pending payout</span>}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* CUSTOMER REFUND REQUEST MODAL                                 */}
      {/* ------------------------------------------------------------- */}
      {selectedOrderForRefund && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full p-6 sm:p-8 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-rose-400" />
                <h3 className="text-lg font-bold text-white">Request AI Auto-Refund</h3>
              </div>
              <button
                onClick={() => setSelectedOrderForRefund(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-dark-950 border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Order Reference:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {selectedOrderForRefund.reference}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Plan:</span>
                <span className="font-bold text-white uppercase">
                  {selectedOrderForRefund.planId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Refund Amount:</span>
                <span className="font-bold text-emerald-400">
                  ₹{(selectedOrderForRefund.amountPaise / 100).toFixed(2)}
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmitRefund} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Your UPI ID (To receive payout)
                </label>
                <input
                  type="text"
                  required
                  value={refundUpiId}
                  onChange={(e) => setRefundUpiId(e.target.value)}
                  placeholder="e.g. name@okhdfcbank or 9876543210@upi"
                  className="w-full px-4 py-2.5 rounded-xl bg-dark-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-rose-500"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Must be a valid UPI VPA. Admin will disburse directly to this handle.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Reason for Refund
                </label>
                <select
                  value={refundReasonType}
                  onChange={(e) => setRefundReasonType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-dark-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-rose-500"
                >
                  <option value="Service not meeting expectations">Service not meeting expectations</option>
                  <option value="Technical integration issues">Technical integration issues</option>
                  <option value="Accidental purchase">Accidental purchase</option>
                  <option value="Billing or payment issue">Billing or payment issue</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                  Details (Optional)
                </label>
                <textarea
                  rows={2}
                  value={refundDetails}
                  onChange={(e) => setRefundDetails(e.target.value)}
                  placeholder="Additional context (optional)..."
                  className="w-full px-4 py-2 rounded-xl bg-dark-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-[11px] text-rose-200 leading-relaxed">
                ⚠️ <strong>Immediate Effect:</strong> Upon auto-approval, your subscription will be immediately cancelled and your API keys revoked. Payout will be sent by the administrator to your UPI ID.
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrderForRefund(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRefund || !refundUpiId.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {submittingRefund ? 'Processing...' : 'Confirm Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* ADMIN REJECT ORDER MODAL                                      */}
      {/* ------------------------------------------------------------- */}
      {rejectingOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full p-6 rounded-3xl border border-rose-500/40 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <XSquare className="w-5 h-5 text-rose-400" />
              <span>Reject Order {rejectingOrder.reference}</span>
            </h3>
            <p className="text-xs text-slate-300">
              Customer: {rejectingOrder.userName} ({rejectingOrder.userEmail}) • UTR: <strong className="font-mono text-amber-300">{rejectingOrder.utr}</strong>
            </p>
            <form onSubmit={handleAdminRejectOrderSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for rejection
                </label>
                <input
                  type="text"
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setRejectingOrder(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-rose-500 text-white font-bold text-xs"
                >
                  Confirm Reject
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* ADMIN PAYOUT QR SCAN MODAL                                    */}
      {/* ------------------------------------------------------------- */}
      {activeQrModalRefund && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-sm w-full p-6 rounded-3xl border border-slate-700 text-center space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Scan to Disburse Refund</h3>
              <button
                onClick={() => setActiveQrModalRefund(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-white shadow-xl mx-auto inline-block border-2 border-slate-800">
              {activeQrModalRefund.payoutQrDataUrl ? (
                <img
                  src={activeQrModalRefund.payoutQrDataUrl}
                  alt="Refund Payout QR Code"
                  className="w-52 h-52 object-contain"
                />
              ) : (
                <div className="w-52 h-52 flex items-center justify-center text-slate-500">
                  <QrCode className="w-10 h-10 animate-pulse" />
                </div>
              )}
            </div>

            <div className="text-xs space-y-1 text-slate-300">
              <div className="text-sm font-bold text-white">
                ₹{(activeQrModalRefund.amountPaise / 100).toFixed(2)} to {activeQrModalRefund.userName}
              </div>
              <div className="font-mono text-emerald-400 text-xs font-semibold">
                {activeQrModalRefund.userUpiId}
              </div>
            </div>

            {activeQrModalRefund.payoutUpiUri && (
              <a
                href={activeQrModalRefund.payoutUpiUri}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30"
              >
                <Smartphone className="w-4 h-4" />
                <span>Open UPI App on Phone</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <button
              onClick={() => setActiveQrModalRefund(null)}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            >
              Done Scanning
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
