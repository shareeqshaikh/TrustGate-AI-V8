import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  QrCode,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { api } from '../api';
import type { Order } from '../types';

interface CheckoutPageProps {
  order: Order;
  payUrl: string | null;
  error?: string;
  onOrderUpdated: (order: Order) => void;
  onGoToAccount: () => void;
}

export const CheckoutPage: React.FC<CheckoutPageProps> = ({
  order,
  error,
  onOrderUpdated,
  onGoToAccount,
}) => {
  const [utr, setUtr] = useState(order.utr || '');
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(
    error ? { text: error, type: 'error' } : null
  );
  const [busy, setBusy] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isConfirmed = order.status === 'CONFIRMED';
  const isAwaitingVerification = order.status === 'AWAITING_VERIFICATION';
  const isRejected = order.status === 'REJECTED';

  const merchantUpiId = 'shareeqshaikh194@oksbi';
  const amountRupees = (order.amountPaise / 100).toFixed(2);

  // Poll for order confirmation while awaiting verification
  useEffect(() => {
    if (!isAwaitingVerification) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.getOrder(order.id);
        if (res.order.status !== order.status) {
          onOrderUpdated(res.order);
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [order.id, order.status, isAwaitingVerification, onOrderUpdated]);

  const handleCopyUpi = () => {
    navigator.clipboard.writeText(merchantUpiId);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      const res = await api.getOrder(order.id);
      onOrderUpdated(res.order);
      if (res.order.status === 'CONFIRMED') {
        setMsg({ text: 'Payment verified! Subscription is active.', type: 'success' });
      } else if (res.order.status === 'AWAITING_VERIFICATION') {
        setMsg({ text: 'Order is still awaiting admin verification.', type: 'info' });
      }
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to refresh status', type: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSubmitUtr = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUtr = utr.trim();

    if (!/^\d{12}$/.test(cleanUtr)) {
      setMsg({
        text: 'Please enter a valid 12-digit numeric UTR number from your UPI receipt.',
        type: 'error',
      });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await api.submitUtr(order.id, cleanUtr);
      try {
        localStorage.removeItem('tg_pending_order');
      } catch {
        /* ignore */
      }
      onOrderUpdated(res.order);
      setMsg({
        text: 'UTR submitted successfully! Awaiting administrator verification.',
        type: 'success',
      });
    } catch (err: any) {
      setMsg({ text: err.message || 'Failed to submit UTR', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-10 px-4">
      {/* Header */}
      <div className="text-center mb-8">
        <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          Native UPI QR Checkout
        </span>
        <h1 className="text-3xl font-extrabold text-white mt-3">
          {order.planId === '7days' || order.planId === 'monthly' ? '7 Days Plan' : '30 Days Plan'}
        </h1>
        <div className="text-4xl font-extrabold text-emerald-400 mt-2">
          ₹{amountRupees}
          <span className="text-xs text-slate-400 font-normal ml-2">({order.amountPaise} paise)</span>
        </div>
        <p className="text-xs text-slate-400 mt-1 font-mono">Reference: {order.reference}</p>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-3 gap-2 mb-8 text-center text-xs">
        <div
          className={`p-2.5 rounded-xl border ${
            isConfirmed || isAwaitingVerification
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-emerald-500/20 border-emerald-500 text-white font-semibold'
          }`}
        >
          <div className="font-bold">1. Scan & Pay</div>
          <div className="text-[10px] text-slate-400">₹{amountRupees} via UPI</div>
        </div>
        <div
          className={`p-2.5 rounded-xl border ${
            isConfirmed
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : isAwaitingVerification
              ? 'bg-amber-500/20 border-amber-500 text-amber-200 font-semibold'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <div className="font-bold">2. Enter UTR</div>
          <div className="text-[10px] text-slate-400">12-digit reference</div>
        </div>
        <div
          className={`p-2.5 rounded-xl border ${
            isConfirmed
              ? 'bg-emerald-500 text-black font-extrabold shadow-lg shadow-emerald-500/20'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <div className="font-bold">3. Active</div>
          <div className="text-[10px]">{isConfirmed ? 'Verified & Live' : 'API Unlocked'}</div>
        </div>
      </div>

      {/* Main Card */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-slate-800 shadow-2xl space-y-6">
        {/* CONFIRMED STATE */}
        {isConfirmed ? (
          <div className="p-6 rounded-2xl bg-emerald-950/60 border border-emerald-500/50 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Payment Verified!</h2>
              <p className="text-xs text-emerald-300/80 mt-1">
                Your subscription has been activated and your secure API key is ready.
              </p>
              {order.utr && (
                <p className="text-[11px] font-mono text-slate-400 mt-2">
                  Verified UTR: <span className="text-emerald-400">{order.utr}</span>
                </p>
              )}
            </div>
            <button
              onClick={onGoToAccount}
              className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-sm transition shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Go to My Account & View API Key</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            {/* QR Code Presentation */}
            <div className="flex flex-col items-center justify-center text-center">
              <div className="relative p-4 rounded-2xl bg-white shadow-xl shadow-black/40 border-4 border-slate-800">
                {order.qrDataUrl ? (
                  <img
                    src={order.qrDataUrl}
                    alt="UPI Payment QR Code"
                    className="w-56 h-56 sm:w-64 sm:h-64 object-contain"
                  />
                ) : (
                  <div className="w-56 h-56 sm:w-64 sm:h-64 flex flex-col items-center justify-center text-slate-500">
                    <QrCode className="w-12 h-12 mb-2 animate-pulse" />
                    <span className="text-xs">Generating QR...</span>
                  </div>
                )}
              </div>

              {/* Mobile Deep Link */}
              {order.upiUri && (
                <a
                  href={order.upiUri}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-500/25 transition sm:hidden"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Tap to Pay with UPI App</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {/* Merchant Details Pill */}
              <div className="mt-4 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 w-full max-w-sm space-y-1 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">UPI ID:</span>
                  <div className="flex items-center gap-1.5 font-mono text-white">
                    <span>{merchantUpiId}</span>
                    <button
                      onClick={handleCopyUpi}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                      title="Copy UPI ID"
                    >
                      {copiedUpi ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Payee Name:</span>
                  <span className="font-semibold text-white">Shareeq Shaikh</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Order Ref:</span>
                  <span className="font-mono text-emerald-400 font-bold">{order.reference}</span>
                </div>
              </div>
            </div>

            {/* AWAITING VERIFICATION BANNER */}
            {isAwaitingVerification && (
              <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs space-y-2">
                <div className="flex items-center justify-between font-bold text-sm text-amber-300">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400 animate-spin" />
                    <span>Awaiting Admin Verification</span>
                  </span>
                  <button
                    onClick={handleRefreshStatus}
                    disabled={refreshing}
                    className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 flex items-center gap-1 text-[11px]"
                  >
                    <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                    <span>Check</span>
                  </button>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Your UTR <span className="font-mono font-bold text-amber-300">{order.utr}</span> has been received.
                  The administrator will verify your transaction against bank records shortly.
                </p>
              </div>
            )}

            {/* REJECTED BANNER */}
            {isRejected && (
              <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span>Order Rejected</span>
                </div>
                <p className="text-slate-300">
                  Reason: {order.rejectionReason || 'Invalid UTR or payment not received'}.
                </p>
                <p className="text-[11px] text-slate-400">
                  Please verify your 12-digit UTR in your UPI app receipt and re-submit below.
                </p>
              </div>
            )}

            {/* UTR Form */}
            <form onSubmit={handleSubmitUtr} className="space-y-4 pt-2 border-t border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Enter 12-digit UTR / UPI Transaction ID
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={12}
                    value={utr}
                    onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 428719283741"
                    className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-base tracking-wider focus:outline-none focus:border-emerald-500"
                    required
                  />
                  <div className="absolute right-3 top-3 text-[11px] font-mono text-slate-500">
                    {utr.length}/12
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Find the 12-digit number labelled &quot;UPI Ref No.&quot; or &quot;UTR&quot; on your Google Pay, PhonePe, or Paytm receipt.
                </p>
              </div>

              <button
                type="submit"
                disabled={busy || utr.length !== 12}
                className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-sm transition shadow-lg shadow-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {busy ? (
                  <span>Submitting UTR...</span>
                ) : isAwaitingVerification ? (
                  <span>Update Submitted UTR</span>
                ) : (
                  <span>Submit UTR for Verification</span>
                )}
              </button>
            </form>

            {/* Notification message */}
            {msg && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  msg.type === 'error'
                    ? 'bg-rose-950/60 border border-rose-500/40 text-rose-200'
                    : msg.type === 'success'
                    ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-200'
                    : 'bg-slate-900 border border-slate-700 text-slate-200'
                }`}
              >
                {msg.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span>{msg.text}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-6 text-center text-xs text-slate-500 space-y-1">
        <p>Admin verifies receipt against merchant account statement before unlocking gateway key.</p>
        <p>Already paid and have an active subscription? <button onClick={onGoToAccount} className="text-emerald-400 hover:underline">Go to My Account</button></p>
      </div>
    </div>
  );
};
