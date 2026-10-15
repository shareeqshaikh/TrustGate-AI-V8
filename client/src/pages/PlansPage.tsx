import React from 'react';
import { Check, Zap, Sparkles, Shield, Clock, ArrowRight } from 'lucide-react';
import type { PlanConfig, PlanId } from '../types';

interface PlansPageProps {
  plans: PlanConfig[];
  onSelectPlan: (planId: PlanId) => void;
  loadingPlanId: string | null;
}

export const PlansPage: React.FC<PlansPageProps> = ({
  plans,
  onSelectPlan,
  loadingPlanId,
}) => {
  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-4">
          <Shield className="w-3.5 h-3.5" />
          <span>Instant Direct UPI QR Checkout</span>
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
          Simple, Transparent Plans
        </h1>
        <p className="mt-3 text-sm text-slate-400 max-w-xl mx-auto">
          Scan QR from Google Pay, PhonePe, Paytm, or BHIM. Enter your 12-digit UTR for immediate verification and access.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
        {plans.map((plan) => {
          const isBestValue = (plan.id as string) === '30days' || (plan.id as string) === 'yearly';
          const rupees = (plan.amountPaise / 100).toFixed(0);
          const isLoading = loadingPlanId === plan.id;

          return (
            <div
              key={plan.id}
              className={`glass-panel rounded-3xl p-8 border flex flex-col justify-between relative transition duration-300 shadow-2xl ${
                isBestValue
                  ? 'border-emerald-500/50 bg-gradient-to-b from-emerald-950/30 via-dark-900/90 to-dark-950/95 shadow-emerald-500/10 hover:border-emerald-400'
                  : 'border-slate-800 bg-dark-900/90 hover:border-slate-700'
              }`}
            >
              {isBestValue && (
                <div className="absolute -top-3.5 right-6 px-3.5 py-1 rounded-full bg-emerald-500 text-black text-xs font-extrabold uppercase tracking-wider shadow-lg flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Best Value</span>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl font-bold text-white">{plan.name}</h2>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
                    {plan.durationDays} Days
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-6 min-h-[36px]">{plan.description}</p>

                <div className="mb-6 pb-6 border-b border-slate-800/80">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-extrabold text-white tracking-tight">₹{rupees}</span>
                    <span className="text-xs text-slate-400 font-medium">
                      / {plan.durationDays} days
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 font-mono">
                    {plan.amountPaise} paise • Fixed Server Rate
                  </div>
                </div>

                <ul className="space-y-3.5 text-xs text-slate-300 mb-8">
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Direct UPI QR payment (No gateway fees)</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Instant 12-digit UTR verification</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>SHA-256 encrypted production API key</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>7-day risk-free AI auto-refund guarantee</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Full validity: {plan.durationDays} calendar days</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={() => onSelectPlan(plan.id as PlanId)}
                disabled={isLoading}
                className={`w-full py-4 rounded-2xl font-bold text-sm transition shadow-lg flex items-center justify-center gap-2.5 disabled:opacity-50 cursor-pointer ${
                  isBestValue
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/25 active:scale-[0.99]'
                    : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 active:scale-[0.99]'
                }`}
              >
                {isLoading ? (
                  <span>Generating UPI QR...</span>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-current" />
                    <span>Select {plan.name} (₹{rupees})</span>
                    <ArrowRight className="w-4 h-4 ml-1 opacity-70" />
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-12 text-center text-xs text-slate-500 flex items-center justify-center gap-4">
        <span>🔒 Secure UPI Standard Protocol</span>
        <span>•</span>
        <span>⚡ 100% Deterministic Verification</span>
        <span>•</span>
        <span>🛡️ Segregation of Duties</span>
      </div>
    </div>
  );
};
