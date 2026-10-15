import React from 'react';
import { Shield, LogOut, Key, Zap, Mail, Bot, User as UserIcon } from 'lucide-react';
import type { User } from '../types';

export type LiteTab = 'plans' | 'checkout' | 'account' | 'email' | 'agents';

interface NavbarProps {
  user: User | null;
  currentTab: LiteTab;
  onNavigate: (tab: LiteTab) => void;
  onLogout: () => void;
  onGoToLogin: () => void;
  onGoToRegister: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  currentTab,
  onNavigate,
  onLogout,
  onGoToLogin,
  onGoToRegister,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-dark-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div
          className="flex items-center gap-3 cursor-pointer select-none"
          onClick={() => onNavigate('plans')}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white tracking-tight">TrustGate</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                Lite
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              UPI Checkout & Secure API Gateway
            </p>
          </div>
        </div>

        {/* Center Nav Links (When Logged In) */}
        {user && (
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => onNavigate('plans')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentTab === 'plans'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Plans</span>
            </button>

            <button
              onClick={() => onNavigate('account')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentTab === 'account'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>My Account</span>
            </button>

            {user.role === 'admin' && (
              <>
                <button
                  onClick={() => onNavigate('agents')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    currentTab === 'agents'
                      ? 'bg-brand-500/15 text-brand-300 border border-brand-500/40'
                      : 'text-slate-400 hover:text-brand-300 hover:bg-brand-500/10'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5 text-brand-400" />
                  <span>Agent Manager</span>
                </button>

                <button
                  onClick={() => onNavigate('email')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    currentTab === 'email'
                      ? 'bg-purple-500/15 text-purple-300 border border-purple-500/40'
                      : 'text-slate-400 hover:text-purple-300 hover:bg-purple-500/10'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5 text-purple-400" />
                  <span>Email Automation</span>
                </button>
              </>
            )}
          </nav>
        )}

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-medium text-slate-200">{user.name}</div>
                <div className="flex items-center justify-end gap-1">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-1.5 rounded ${
                      user.role === 'admin'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {user.role}
                  </span>
                </div>
              </div>

              <button
                onClick={onLogout}
                title="Log Out"
                className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onGoToLogin}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                Log In
              </button>
              <button
                onClick={onGoToRegister}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition font-bold"
              >
                Register
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
