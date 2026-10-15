import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { Shield, CheckCircle2, AlertTriangle, RefreshCw, MailX } from 'lucide-react';

interface UnsubscribePageProps {
  token: string;
  onGoHome: () => void;
}

export const UnsubscribePage: React.FC<UnsubscribePageProps> = ({ token, onGoHome }) => {
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState<boolean | null>(null);
  const [alreadyUnsubscribed, setAlreadyUnsubscribed] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [unsubscribedNow, setUnsubscribedNow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verify() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.checkUnsubscribeToken(token);
        setValid(res.valid);
        setAlreadyUnsubscribed(!!res.alreadyUnsubscribed);
      } catch (err: any) {
        setValid(false);
        setError(err.message || 'Invalid or expired unsubscribe link.');
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [token]);

  const handleConfirm = async () => {
    setUnsubscribing(true);
    setError(null);
    try {
      await api.confirmUnsubscribe(token);
      setUnsubscribedNow(true);
      setAlreadyUnsubscribed(true);
    } catch (err: any) {
      setError(err.message || 'Failed to process unsubscribe request.');
    } finally {
      setUnsubscribing(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-dark-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl text-white tracking-tight">TrustGate</span>
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
            Email Center
          </span>
        </div>

        {loading && (
          <div className="py-12 text-center text-slate-400">
            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-3" />
            <p className="text-sm">Verifying unsubscribe token...</p>
          </div>
        )}

        {!loading && valid === false && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Invalid or Expired Link</h2>
            <p className="text-sm text-slate-400 mb-6">
              {error || 'This unsubscribe link is not valid or has already expired.'}
            </p>
            <button
              onClick={onGoHome}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
            >
              Return to TrustGate
            </button>
          </div>
        )}

        {!loading && valid && (alreadyUnsubscribed || unsubscribedNow) && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Successfully Unsubscribed</h2>
            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              You will no longer receive promotional emails or product announcements from TrustGate.
            </p>
            <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 mb-6 text-left">
              <span className="font-semibold text-slate-300 block mb-1">Transactional Notice:</span>
              You will still receive critical transactional notifications (such as subscription renewal reminders and API key alerts) related to your active account.
            </div>
            <button
              onClick={onGoHome}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition"
            >
              Back to Home
            </button>
          </div>
        )}

        {!loading && valid && !alreadyUnsubscribed && !unsubscribedNow && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto mb-4 text-purple-400">
              <MailX className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Unsubscribe from Marketing</h2>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              Are you sure you want to opt out of promotional emails, product updates, and special plan offers?
            </p>

            {error && (
              <div className="p-3 mb-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleConfirm}
                disabled={unsubscribing}
                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2"
              >
                {unsubscribing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Unsubscribe</span>
              </button>
              <button
                onClick={onGoHome}
                className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Never mind, keep my updates
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
