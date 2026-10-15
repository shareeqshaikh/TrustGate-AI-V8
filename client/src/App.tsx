import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import type { User, PlanConfig, PlanId, Order } from './types';
import { Navbar, type LiteTab } from './components/Navbar';
import { RegisterPage } from './pages/RegisterPage';
import { LoginPage } from './pages/LoginPage';
import { PlansPage } from './pages/PlansPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { AccountPage } from './pages/AccountPage';
import { EmailAutomationPage } from './pages/EmailAutomationPage';
import { AgentManagerPage } from './pages/AgentManagerPage';
import { UnsubscribePage } from './pages/UnsubscribePage';
import { RefreshCw } from 'lucide-react';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Unauthenticated view: 'login' | 'register'
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  // Authenticated tab: 'plans' | 'checkout' | 'account' | 'email'
  const [currentTab, setCurrentTab] = useState<LiteTab>('plans');

  // Unsubscribe Token Detector (supports /unsubscribe/:token or #/unsubscribe/:token)
  const [unsubToken, setUnsubToken] = useState<string | null>(() => {
    const path = window.location.pathname;
    const hash = window.location.hash;
    const match =
      path.match(/\/unsubscribe\/([a-zA-Z0-9_-]+)/) ||
      hash.match(/unsubscribe\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  });

  // Plans data
  const [plans, setPlans] = useState<PlanConfig[]>([]);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);

  // Active Checkout Order State
  const [checkoutData, setCheckoutData] = useState<{
    order: Order;
    payUrl: string | null;
    error?: string;
  } | null>(null);

  // Check current session from GET /auth/me
  const checkAuth = useCallback(async () => {
    try {
      const res = await api.getMe();
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoadingUser(false);
    }
  }, []);

  // Fetch plans
  const fetchPlans = useCallback(async () => {
    try {
      const res = await api.getPlans();
      setPlans(res.plans);
    } catch (err) {
      console.error('Failed to load plans:', err);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Listen for unauthorized 401s and automatically redirect to login
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setCheckoutData(null);
      setAuthView('login');
      setCurrentTab('plans');
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (user) {
      fetchPlans();
      // Returning from the Auth App: reopen the pending order so the UTR can be entered
      let id: string | null = null;
      try { id = localStorage.getItem('tg_pending_order'); } catch { /* ignore */ }
      if (id) {
        api.getOrder(id)
          .then((res) => {
            if (res.order.status === 'CONFIRMED') {
              try { localStorage.removeItem('tg_pending_order'); } catch { /* ignore */ }
              return;
            }
            setCheckoutData({ order: res.order, payUrl: res.payUrl, error: res.error });
            setCurrentTab('checkout');
          })
          .catch(() => { try { localStorage.removeItem('tg_pending_order'); } catch { /* ignore */ } });
      }
    }
  }, [user, fetchPlans]);

  // Refetches /auth/me after login or registration to ensure fresh server-stored role
  const handleAuthSuccess = async () => {
    setLoadingUser(true);
    try {
      const res = await api.getMe();
      setUser(res.user);
      if (res.user?.role === 'admin') {
        setCurrentTab('agents');
      } else {
        setCurrentTab('plans');
      }
    } catch {
      setUser(null);
      setAuthView('login');
    } finally {
      setLoadingUser(false);
    }
  };

  // Handle Logout - always returns to /login
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setCheckoutData(null);
      setCurrentTab('plans');
      setAuthView('login');
    }
  };

  // Handle Plan Selection -> Create Order -> Open Checkout
  const handleSelectPlan = async (planId: PlanId) => {
    setLoadingPlanId(planId);
    try {
      const res = await api.createOrder(planId);
      setCheckoutData({ order: res.order, payUrl: res.payUrl, error: res.error });
      setCurrentTab('checkout');
      if (res.payUrl) {
        // Go pay on the Auth App; the order is remembered so we come back to the UTR step.
        try { localStorage.setItem('tg_pending_order', res.order.id); } catch { /* ignore */ }
        window.location.href = res.payUrl;
      }
    } catch (err: any) {
      alert(err.message || 'Failed to create order');
    } finally {
      setLoadingPlanId(null);
    }
  };

  // Open existing order in Checkout (e.g. from Account Page)
  const handleSelectExistingOrder = async (order: Order) => {
    try {
      const res = await api.getOrder(order.id);
      setCheckoutData({ order: res.order, payUrl: res.payUrl, error: res.error });
      setCurrentTab('checkout');
    } catch (err: any) {
      alert(err.message || 'Failed to load order');
    }
  };

  // Loading spinner during initial session check
  if (loadingUser) {
    return (
      <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center text-slate-400">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
        <p className="text-sm font-medium">Initializing TrustGate Lite...</p>
      </div>
    );
  }

  // Public Unsubscribe Page
  if (unsubToken) {
    return (
      <UnsubscribePage
        token={unsubToken}
        onGoHome={() => {
          window.history.pushState({}, '', '/');
          setUnsubToken(null);
        }}
      />
    );
  }

  // Unauthenticated Layout: Only Register (Page 1) and Login (Page 2)
  if (!user) {
    return (
      <div className="min-h-screen bg-dark-950 text-slate-100 flex flex-col">
        <Navbar
          user={null}
          currentTab="plans"
          onNavigate={() => {}}
          onLogout={() => {}}
          onGoToLogin={() => setAuthView('login')}
          onGoToRegister={() => setAuthView('register')}
        />
        <main className="flex-1 flex items-center justify-center">
          {authView === 'register' ? (
            <RegisterPage
              onSuccess={handleAuthSuccess}
              onGoToLogin={() => setAuthView('login')}
            />
          ) : (
            <LoginPage
              onSuccess={handleAuthSuccess}
              onGoToRegister={() => setAuthView('register')}
            />
          )}
        </main>
      </div>
    );
  }

  // Authenticated Layout: Only Plans, Checkout, My Account, and Admin: Verify Payments
  return (
    <div className="min-h-screen bg-dark-950 text-slate-100 flex flex-col">
      <Navbar
        user={user}
        currentTab={currentTab}
        onNavigate={(tab) => {
          if (!user) {
            setAuthView('login');
            return;
          }
          if ((tab === 'email' || tab === 'agents') && user.role !== 'admin') {
            setCurrentTab('plans');
            return;
          }
          setCurrentTab(tab);
        }}
        onLogout={handleLogout}
        onGoToLogin={() => {}}
        onGoToRegister={() => {}}
      />

      <main className="flex-1 pb-16">
        {currentTab === 'plans' && (
          <PlansPage
            plans={plans}
            onSelectPlan={handleSelectPlan}
            loadingPlanId={loadingPlanId}
          />
        )}

        {currentTab === 'checkout' && checkoutData && (
          <CheckoutPage
            order={checkoutData.order}
            payUrl={checkoutData.payUrl}
            error={checkoutData.error}
            onOrderUpdated={(updatedOrder) => {
              setCheckoutData((prev) => (prev ? { ...prev, order: updatedOrder } : null));
            }}
            onGoToAccount={() => setCurrentTab('account')}
          />
        )}

        {currentTab === 'checkout' && !checkoutData && (
          <div className="py-20 text-center">
            <p className="text-slate-400 text-sm mb-4">No active checkout order selected.</p>
            <button
              onClick={() => setCurrentTab('plans')}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition"
            >
              Choose a Plan
            </button>
          </div>
        )}

        {currentTab === 'account' && (
          <AccountPage
            onGoToPlans={() => setCurrentTab('plans')}
            onSelectOrder={handleSelectExistingOrder}
          />
        )}

        {currentTab === 'agents' && user.role === 'admin' && <AgentManagerPage />}

        {currentTab === 'email' && user.role === 'admin' && <EmailAutomationPage />}
      </main>
    </div>
  );
}
export default App;
