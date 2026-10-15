import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot,
  ShieldAlert,
  AlertTriangle,
  Play,
  Square,
  Settings,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  SlidersHorizontal,
  ChevronRight,
  Activity,
  Layers,
  Sparkles,
  Zap,
  Info,
  X,
  CreditCard,
  Mail,
  Copy,
  Check,
  Power,
  RotateCw,
  Terminal,
  Send,
  Key,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api';
import type {
  AgentMetadata,
  AgentOverviewStats,
  AgentExecutionTask,
  AgentConfigRecord,
} from '../types';

export function AgentManagerPage() {
  // Primary state
  const [overview, setOverview] = useState<AgentOverviewStats | null>(null);
  const [agents, setAgents] = useState<AgentMetadata[]>([]);
  const [tasks, setTasks] = useState<AgentExecutionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoPoll, setAutoPoll] = useState(true);

  // Filters
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [activeModal, setActiveModal] = useState<
    'runTask' | 'config' | 'details' | 'taskDetails' | 'emergencyStop' | 'emergencyResume' | null
  >(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentMetadata | null>(null);
  const [selectedTask, setSelectedTask] = useState<AgentExecutionTask | null>(null);

  // Action form state
  const [selectedTaskType, setSelectedTaskType] = useState<string>('');
  const [taskParams, setTaskParams] = useState<Record<string, any>>({});
  const [executingTask, setExecutingTask] = useState(false);
  const [taskExecutionResult, setTaskExecutionResult] = useState<AgentExecutionTask | null>(null);

  // Config modal form state
  const [configForm, setConfigForm] = useState<{
    taskTimeoutSeconds: number;
    maxRetries: number;
    logLevel: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    customSettings: Record<string, any>;
  }>({
    taskTimeoutSeconds: 30,
    maxRetries: 1,
    logLevel: 'INFO',
    customSettings: {},
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Emergency stop form state
  const [emergencyReason, setEmergencyReason] = useState('');
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [emergencyFeedback, setEmergencyFeedback] = useState<string | null>(null);

  // Notification / Banner
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Command Box state
  const [commandInput, setCommandInput] = useState('');
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandResults, setCommandResults] = useState<{
    command: string;
    parsedSteps: Array<{
      agentId: string;
      operation: string;
      params: Record<string, any>;
      requiresConfirmation: boolean;
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
  } | null>(null);
  const [pendingCommandConfirm, setPendingCommandConfirm] = useState<{
    command: string;
    confirmationPrompt: string;
    destructiveSteps: any[];
  } | null>(null);

  const handleExecuteCommand = async (confirmed = false) => {
    const text = commandInput.trim();
    if (!text) return;
    setCommandLoading(true);
    try {
      const res = await api.executeAgentCommand(text, confirmed);
      if (res.requiresConfirmation && !confirmed) {
        setPendingCommandConfirm({
          command: text,
          confirmationPrompt:
            res.confirmationPrompt || 'This command contains destructive operations requiring your confirmation.',
          destructiveSteps: res.destructiveSteps || [],
        });
      } else {
        setPendingCommandConfirm(null);
        setCommandResults(res);
        showToast('success', `Executed ${res.results.length} operation(s) successfully.`);
        fetchData(true);
      }
    } catch (err: any) {
      showToast('error', err.message || 'Failed to process command');
    } finally {
      setCommandLoading(false);
    }
  };

  // Fetch all dashboard data
  const fetchData = useCallback(async (isBackground = false) => {
    if (!isBackground) setRefreshing(true);
    try {
      const [overviewRes, agentsRes, historyRes] = await Promise.all([
        api.getAgentsOverview(),
        api.getAgents(),
        api.getAgentTaskHistory({ limit: 40 }),
      ]);
      setOverview(overviewRes);
      setAgents(agentsRes.agents);
      setTasks(historyRes.tasks);
    } catch (err: any) {
      if (!isBackground) {
        showToast('error', err.message || 'Failed to fetch agent manager data');
      }
    } finally {
      setLoading(false);
      if (!isBackground) setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling mechanism
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (autoPoll) {
      pollTimerRef.current = setInterval(() => {
        fetchData(true);
      }, 4000);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [autoPoll, fetchData]);

  // Toggle Agent Enable / Disable
  const handleToggleAgent = async (agent: AgentMetadata) => {
    const nextState = !agent.enabled;
    try {
      const res = await api.toggleAgent(agent.id, nextState);
      showToast('success', res.message);
      // Optimistic update
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? { ...a, enabled: nextState, status: nextState ? 'HEALTHY' : 'STOPPED' }
            : a
        )
      );
      fetchData(true);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to toggle agent');
    }
  };

  // Open Run Task Modal
  const openRunTaskModal = (agent: AgentMetadata, initialTaskType?: string) => {
    setSelectedAgent(agent);
    const taskType = initialTaskType || (agent.capabilities[0]?.id ?? '');
    setSelectedTaskType(taskType);
    setTaskParams({});
    setTaskExecutionResult(null);
    setActiveModal('runTask');
  };

  // Execute Task
  const handleExecuteTask = async () => {
    if (!selectedAgent || !selectedTaskType) return;
    setExecutingTask(true);
    setTaskExecutionResult(null);
    try {
      const res = await api.runAgentTask(selectedAgent.id, selectedTaskType, taskParams);
      setTaskExecutionResult(res.task);
      showToast('success', `Task completed: ${res.task.status}`);
      fetchData(true);
    } catch (err: any) {
      showToast('error', err.message || 'Task execution failed');
    } finally {
      setExecutingTask(false);
    }
  };

  // Cancel Task
  const handleCancelTask = async (taskId: string) => {
    try {
      const res = await api.cancelAgentTask(taskId);
      showToast('info', res.message);
      fetchData(true);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to cancel task');
    }
  };

  // Open Config Modal
  const openConfigModal = (agent: AgentMetadata) => {
    setSelectedAgent(agent);
    setConfigForm({
      taskTimeoutSeconds: Math.round((agent.config?.taskTimeoutMs || 30000) / 1000),
      maxRetries: agent.config?.maxRetries ?? 1,
      logLevel: agent.config?.logLevel ?? 'INFO',
      customSettings: agent.config?.customSettings ?? {},
    });
    setActiveModal('config');
  };

  // Save Config
  const handleSaveConfig = async () => {
    if (!selectedAgent) return;
    setSavingConfig(true);
    try {
      const payload: Partial<AgentConfigRecord> = {
        taskTimeoutMs: configForm.taskTimeoutSeconds * 1000,
        maxRetries: configForm.maxRetries,
        logLevel: configForm.logLevel,
        customSettings: configForm.customSettings,
      };
      const res = await api.updateAgentConfig(selectedAgent.id, payload);
      showToast('success', res.message);
      setActiveModal(null);
      fetchData(true);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to update configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  // Emergency Stop Trigger
  const handleEmergencyStop = async () => {
    if (!emergencyReason.trim()) {
      showToast('error', 'Please provide a valid reason for activating Emergency Stop.');
      return;
    }
    setEmergencySubmitting(true);
    try {
      const res = await api.triggerEmergencyStop(emergencyReason);
      setEmergencyFeedback(res.message);
      showToast('error', 'EMERGENCY STOP ACTIVATED! All agent tasks halted.');
      setActiveModal(null);
      setEmergencyReason('');
      fetchData(true);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to activate Emergency Stop');
    } finally {
      setEmergencySubmitting(false);
    }
  };

  // Emergency Resume Trigger
  const handleEmergencyResume = async () => {
    setEmergencySubmitting(true);
    try {
      const res = await api.resumeEmergencyStop();
      showToast('success', res.message);
      setActiveModal(null);
      fetchData(true);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to resume from Emergency Stop');
    } finally {
      setEmergencySubmitting(false);
    }
  };

  // Filtered task history
  const filteredTasks = tasks.filter((t) => {
    if (selectedAgentFilter !== 'ALL' && t.agentId !== selectedAgentFilter) return false;
    if (selectedStatusFilter !== 'ALL' && t.status !== selectedStatusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = t.id.toLowerCase().includes(q);
      const matchType = t.taskType.toLowerCase().includes(q);
      const matchAgent = t.agentName.toLowerCase().includes(q);
      const matchSummary = t.resultSummary?.toLowerCase().includes(q);
      if (!matchId && !matchType && !matchAgent && !matchSummary) return false;
    }
    return true;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'HEALTHY':
      case 'COMPLETED':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-500/30';
      case 'RUNNING':
      case 'RUNNING_TASK':
        return 'text-sky-400 bg-sky-950/60 border-sky-500/30';
      case 'DEGRADED':
      case 'CANCELLED':
        return 'text-amber-400 bg-amber-950/60 border-amber-500/30';
      case 'STOPPED':
        return 'text-slate-400 bg-slate-900 border-slate-700';
      case 'FAILED':
      case 'ERROR':
        return 'text-rose-400 bg-rose-950/60 border-rose-500/30';
      default:
        return 'text-slate-400 bg-slate-900 border-slate-700';
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center justify-center text-slate-400">
        <RefreshCw className="w-8 h-8 text-brand-400 animate-spin mb-3" />
        <p className="text-sm font-semibold">Loading Central Agent Manager...</p>
      </div>
    );
  }

  const isEmergencyActive = overview?.emergencyStop?.active;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md flex items-center gap-3 text-sm font-medium transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : 'bg-slate-900/90 border-slate-700 text-slate-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : toast.type === 'error' ? (
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          ) : (
            <Info className="w-5 h-5 text-sky-400 shrink-0" />
          )}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* EMERGENCY STOP ACTIVE ALERT BANNER */}
      {isEmergencyActive && (
        <div className="relative overflow-hidden p-6 rounded-2xl bg-gradient-to-r from-rose-950/90 via-red-950/80 to-rose-900/40 border border-rose-500/60 shadow-2xl shadow-rose-950/50 animate-pulse">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white tracking-tight">
                    EMERGENCY STOP IS ACTIVE
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-rose-500 text-black">
                    All Dispatches Blocked
                  </span>
                </div>
                <p className="text-xs text-rose-200/90 mt-1 max-w-2xl leading-relaxed">
                  Reason:{' '}
                  <span className="font-semibold text-white">
                    {overview?.emergencyStop?.reason || 'Administrator intervention.'}
                  </span>{' '}
                  Triggered by{' '}
                  <span className="text-rose-100 font-medium">
                    {overview?.emergencyStop?.triggeredBy || 'Admin'}
                  </span>{' '}
                  at{' '}
                  <span className="text-rose-100">
                    {overview?.emergencyStop?.triggeredAt
                      ? new Date(overview.emergencyStop.triggeredAt).toLocaleTimeString()
                      : 'Just now'}
                  </span>
                  .
                </p>
                <p className="text-[11px] text-rose-300/70 mt-1">
                  Note: External financial transactions already committed or emails already handed to
                  SMTP cannot be undone by stopping agents.
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveModal('emergencyResume')}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 shrink-0"
            >
              <RotateCw className="w-4 h-4" />
              <span>Resume Operations</span>
            </button>
          </div>
        </div>
      )}

      {/* TOP HEADER & CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400 shadow-md">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-tight">
                  Central Agent Manager
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                  TrustGate AI
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Centralized orchestration, live health monitoring, and authoritative task dispatch
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Auto-poll toggle */}
          <button
            onClick={() => setAutoPoll(!autoPoll)}
            title="Auto-refresh live statuses"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              autoPoll
                ? 'bg-slate-800/80 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                autoPoll ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span>{autoPoll ? 'Live 4s' : 'Paused'}</span>
          </button>

          {/* Manual Refresh */}
          <button
            onClick={() => fetchData()}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-brand-400' : ''}`} />
            <span>Refresh</span>
          </button>

          {/* Emergency Stop / Resume Button */}
          {!isEmergencyActive ? (
            <button
              onClick={() => setActiveModal('emergencyStop')}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-600/40 text-xs font-bold transition shadow-lg shadow-rose-950/30"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Emergency Stop</span>
            </button>
          ) : (
            <button
              onClick={() => setActiveModal('emergencyResume')}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition shadow-lg shadow-emerald-500/20"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Resume Operations</span>
            </button>
          )}
        </div>
      </div>

      {/* NATURAL LANGUAGE COMMAND BOX CONSOLE */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-dark-900/95 via-slate-900/90 to-dark-900/95 border border-brand-500/30 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/30 flex items-center justify-center">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                <span>Natural Language Command Box</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Admin Authority
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Deterministic rule parser &bull; Registered whitelisted operations only &bull; Confirmation required for destructive actions
              </p>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteCommand(false);
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="e.g. 'Disable the Email Agent and show me today\'s failed payments' or 'Verify audit chain'"
              className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-950/70 border border-slate-700/80 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 text-white text-xs placeholder:text-slate-500 outline-none transition"
            />
            {commandInput && (
              <button
                type="button"
                onClick={() => setCommandInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={commandLoading || !commandInput.trim()}
            className="flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold transition shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:pointer-events-none"
          >
            {commandLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>Execute Command</span>
          </button>
        </form>

        {/* Suggestion Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-slate-500 font-medium">Quick examples:</span>
          {[
            "Disable the Email Agent and show me today's failed payments",
            "Show today's failed payments",
            "Verify audit chain",
            "List expiring subscriptions",
            "List API keys",
            "Check payment gateway health",
            "List delivery logs",
          ].map((promptText) => (
            <button
              key={promptText}
              type="button"
              onClick={() => {
                setCommandInput(promptText);
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition"
            >
              {promptText}
            </button>
          ))}
        </div>

        {/* Command Results Panel */}
        {commandResults && (
          <div className="mt-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-bold text-white">
                  Command Results ({commandResults.results.length} step{commandResults.results.length > 1 ? 's' : ''})
                </span>
                <span className="text-[10px] text-slate-400 font-mono italic">
                  "{commandResults.command}"
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCommandResults(null)}
                className="text-slate-400 hover:text-white text-xs"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2">
              {commandResults.results.map((res) => (
                <div
                  key={res.stepIndex}
                  className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${
                    res.status === 'SUCCESS'
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                      : res.status === 'BLOCKED'
                      ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                      : 'bg-rose-950/20 border-rose-500/30 text-rose-200'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          res.status === 'SUCCESS'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : res.status === 'BLOCKED'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        Step {res.stepIndex}: {res.status}
                      </span>
                      <span className="font-mono text-[11px] text-slate-300">
                        {res.agentId} &rarr; {res.operation}
                      </span>
                    </div>
                    <p className="text-xs text-white font-medium">{res.summary}</p>
                    {res.error && (
                      <p className="text-[11px] text-rose-400">Error: {res.error}</p>
                    )}
                  </div>

                  {res.data && (
                    <details className="text-[11px] text-slate-400 cursor-pointer self-start sm:self-auto">
                      <summary className="hover:text-slate-200 font-mono">View Data</summary>
                      <pre className="mt-1 p-2 rounded bg-black/60 text-[10px] text-slate-300 overflow-x-auto max-h-40 max-w-md font-mono">
                        {JSON.stringify(res.data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* OVERVIEW STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Total Agents */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Agents</span>
            <Layers className="w-4 h-4 text-brand-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{overview?.totalAgents ?? 0}</span>
            <span className="text-[11px] text-emerald-400 font-medium">
              {overview?.enabledAgents ?? 0} active
            </span>
          </div>
        </div>

        {/* Enabled State */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Status</span>
            <Power className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-400">
              {overview?.enabledAgents ?? 0}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              / {overview?.disabledAgents ?? 0} disabled
            </span>
          </div>
        </div>

        {/* Running Tasks */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Running</span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold ${
                (overview?.runningTasks ?? 0) > 0 ? 'text-sky-400 animate-pulse' : 'text-slate-300'
              }`}
            >
              {overview?.runningTasks ?? 0}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">in-flight</span>
          </div>
        </div>

        {/* Failed Tasks */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Failed</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold ${
                (overview?.failedTasks ?? 0) > 0 ? 'text-rose-400' : 'text-slate-300'
              }`}
            >
              {overview?.failedTasks ?? 0}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">errors</span>
          </div>
        </div>

        {/* AI Provider Status */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">AI Engine</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2 flex flex-col">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  overview?.aiProvider?.available ? 'bg-purple-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-xs font-bold text-white truncate">
                {overview?.aiProvider?.available ? 'Ollama Online' : 'Fallback Active'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 truncate">
              {overview?.aiProvider?.model || 'llama3.2:1b'}
            </span>
          </div>
        </div>

        {/* System Lock State */}
        <div className="p-4 rounded-xl bg-dark-900/60 border border-slate-800/80 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-semibold uppercase tracking-wider">System Hold</span>
            <ShieldAlert
              className={`w-4 h-4 ${isEmergencyActive ? 'text-rose-400' : 'text-slate-600'}`}
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded border ${
                isEmergencyActive
                  ? 'text-rose-400 bg-rose-950/60 border-rose-500/40'
                  : 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20'
              }`}
            >
              {isEmergencyActive ? 'HOLD ACTIVE' : 'NORMAL'}
            </span>
          </div>
        </div>
      </div>

      {/* AGENT REGISTRY SECTION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>Registered Agents</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                {agents.length}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Active system agents and automated task dispatchers
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => {
            const isPayment = agent.type === 'PAYMENT';
            const isEmail = agent.type === 'COMMUNICATION';
            const isSecurity = agent.type === 'SECURITY';
            const isAutomation = agent.type === 'AUTOMATION';

            return (
              <div
                key={agent.id}
                className={`p-5 rounded-2xl bg-dark-900/80 border transition-all duration-200 flex flex-col justify-between ${
                  !agent.enabled
                    ? 'border-slate-800/60 opacity-75'
                    : 'border-slate-800 hover:border-slate-700 shadow-xl'
                }`}
              >
                <div>
                  {/* Top card bar */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-md ${
                          isPayment
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : isEmail
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                            : isSecurity
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : isAutomation
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                            : 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                        }`}
                      >
                        {isPayment ? (
                          agent.id === 'refund-agent' ? (
                            <RotateCcw className="w-5 h-5" />
                          ) : (
                            <CreditCard className="w-5 h-5" />
                          )
                        ) : isEmail ? (
                          <Mail className="w-5 h-5" />
                        ) : isSecurity ? (
                          agent.id === 'api-key-agent' ? (
                            <Key className="w-5 h-5" />
                          ) : (
                            <ShieldCheck className="w-5 h-5" />
                          )
                        ) : isAutomation ? (
                          <Layers className="w-5 h-5" />
                        ) : (
                          <Bot className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white tracking-tight">
                            {agent.name}
                          </h3>
                          <span className="text-[10px] text-slate-400 font-mono">
                            v{agent.version}
                          </span>
                        </div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                          {agent.type} AGENT
                        </span>
                      </div>
                    </div>

                    {/* Status Pill & Enable Toggle */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStatusColor(
                          agent.status
                        )}`}
                      >
                        {agent.status}
                      </span>

                      {/* Enable / Disable Button */}
                      <button
                        onClick={() => handleToggleAgent(agent)}
                        title={agent.enabled ? 'Click to disable' : 'Click to enable'}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none ${
                          agent.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm ${
                            agent.enabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-300 mt-3 line-clamp-2 leading-relaxed">
                    {agent.description}
                  </p>

                  {/* Health summary */}
                  <div className="mt-3.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span className="text-[11px] leading-relaxed line-clamp-2">
                      {agent.health?.message || 'Operational and responsive.'}
                    </span>
                  </div>

                  {/* Capabilities chips */}
                  <div className="mt-3.5 flex flex-wrap gap-1.5">
                    {agent.capabilities.map((cap) => (
                      <button
                        key={cap.id}
                        onClick={() => openRunTaskModal(agent, cap.id)}
                        disabled={!agent.enabled || isEmergencyActive}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Play className="w-2.5 h-2.5 text-emerald-400" />
                        <span>{cap.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bottom Card Actions */}
                <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">
                    <span>Runs: </span>
                    <span className="font-semibold text-slate-200">
                      {agent.statistics?.totalTasksRun ?? 0}
                    </span>
                    <span className="text-slate-600 mx-1.5">•</span>
                    <span className="text-emerald-400">
                      {agent.statistics?.successCount ?? 0} passed
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setSelectedAgent(agent);
                        setActiveModal('details');
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
                    >
                      Diagnostics
                    </button>

                    <button
                      onClick={() => openConfigModal(agent)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      title="Configure Agent Settings"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => openRunTaskModal(agent)}
                      disabled={!agent.enabled || isEmergencyActive}
                      className="px-3 py-1 rounded-lg text-xs font-bold bg-brand-500 hover:bg-brand-400 text-black transition flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none shadow-sm"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Run</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TASK MONITOR & EXECUTION HISTORY */}
      <div className="p-6 rounded-2xl bg-dark-900/60 border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Live Task Monitor & Execution History</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time audit log of dispatched tasks, verification results, and runtimes
            </p>
          </div>

          {/* Filters & Search */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search tasks, IDs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            {/* Agent Filter */}
            <select
              value={selectedAgentFilter}
              onChange={(e) => setSelectedAgentFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-brand-500"
            >
              <option value="ALL">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-brand-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="RUNNING">Running</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Task Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800/80">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800 select-none">
                <th className="py-2.5 px-3.5 font-semibold">Task ID</th>
                <th className="py-2.5 px-3.5 font-semibold">Agent & Type</th>
                <th className="py-2.5 px-3.5 font-semibold">Status</th>
                <th className="py-2.5 px-3.5 font-semibold">Duration</th>
                <th className="py-2.5 px-3.5 font-semibold">Started At</th>
                <th className="py-2.5 px-3.5 font-semibold">Initiator</th>
                <th className="py-2.5 px-3.5 font-semibold">Summary / Error</th>
                <th className="py-2.5 px-3.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No task execution records match the active criteria.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-900/40 transition group cursor-pointer"
                    onClick={() => {
                      setSelectedTask(t);
                      setActiveModal('taskDetails');
                    }}
                  >
                    {/* Task ID */}
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <span>{t.id}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(t.id, t.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition p-0.5 text-slate-400 hover:text-white"
                          title="Copy Task ID"
                        >
                          {copiedId === t.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Agent & Type */}
                    <td className="py-2.5 px-3.5">
                      <div className="font-semibold text-white">{t.taskType}</div>
                      <div className="text-[10px] text-slate-400">{t.agentName}</div>
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getStatusColor(
                          t.status
                        )}`}
                      >
                        {t.status === 'RUNNING' && (
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        )}
                        <span>{t.status}</span>
                      </span>
                    </td>

                    {/* Duration */}
                    <td className="py-2.5 px-3.5 text-slate-300">
                      {t.durationMs !== undefined ? `${t.durationMs}ms` : '—'}
                    </td>

                    {/* Started At */}
                    <td className="py-2.5 px-3.5 text-slate-400 text-[11px]">
                      {new Date(t.startTime).toLocaleTimeString()}
                    </td>

                    {/* Initiator */}
                    <td className="py-2.5 px-3.5 text-slate-300 truncate max-w-[120px]">
                      {t.initiatedBy}
                    </td>

                    {/* Summary */}
                    <td className="py-2.5 px-3.5 text-slate-300 max-w-[280px] truncate">
                      {t.status === 'FAILED' ? (
                        <span className="text-rose-400">{t.errorMessage || 'Task failed'}</span>
                      ) : (
                        <span>{t.resultSummary || 'Running...'}</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {t.status === 'RUNNING' && t.cancellable ? (
                        <button
                          onClick={() => handleCancelTask(t.id)}
                          className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-600/40 text-[10px] font-bold transition"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedTask(t);
                            setActiveModal('taskDetails');
                          }}
                          className="text-slate-400 hover:text-white text-[11px] font-semibold"
                        >
                          Details
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: RUN TASK MODAL */}
      {/* ========================================================================= */}
      {activeModal === 'runTask' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-dark-900 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400">
                  <Play className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">
                    Execute Agent Task
                  </h3>
                  <p className="text-xs text-slate-400">{selectedAgent.name}</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Task Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Supported Task Operation
              </label>
              <select
                value={selectedTaskType}
                onChange={(e) => {
                  setSelectedTaskType(e.target.value);
                  setTaskParams({});
                  setTaskExecutionResult(null);
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
              >
                {selectedAgent.capabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.riskLevel} Risk)
                  </option>
                ))}
              </select>

              {/* Task Description */}
              {(() => {
                const cap = selectedAgent.capabilities.find((c) => c.id === selectedTaskType);
                if (!cap) return null;
                return (
                  <div className="mt-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs text-slate-400">
                    <p>{cap.description}</p>
                  </div>
                );
              })()}
            </div>

            {/* Dynamic Parameters Form */}
            {selectedTaskType === 'VERIFY_PENDING_ORDERS' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Batch Size Limit
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={taskParams.batchSize ?? 25}
                  onChange={(e) =>
                    setTaskParams({ ...taskParams, batchSize: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Authoritatively checks up to this many orders against VirtualPay.
                </p>
              </div>
            )}

            {selectedTaskType === 'INSPECT_ORDER' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Order ID (Required)
                </label>
                <input
                  type="text"
                  placeholder="ord_1712345678_abcdef"
                  value={taskParams.orderId ?? ''}
                  onChange={(e) => setTaskParams({ ...taskParams, orderId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>
            )}

            {selectedTaskType === 'SEND_TEST_EMAIL' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Recipient Address
                  </label>
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={taskParams.toEmail ?? ''}
                    onChange={(e) => setTaskParams({ ...taskParams, toEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Subject</label>
                  <input
                    type="text"
                    placeholder="Diagnostic Delivery Ping"
                    value={taskParams.subject ?? 'Diagnostic Test'}
                    onChange={(e) => setTaskParams({ ...taskParams, subject: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Heading</label>
                  <input
                    type="text"
                    value={taskParams.heading ?? 'TrustGate Email Diagnostic'}
                    onChange={(e) => setTaskParams({ ...taskParams, heading: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Body</label>
                  <textarea
                    rows={3}
                    value={
                      taskParams.body ??
                      'This is an automated operational check from the TrustGate Agent Manager.'
                    }
                    onChange={(e) => setTaskParams({ ...taskParams, body: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            )}

            {selectedTaskType === 'GENERATE_AI_DRAFT' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Campaign Goal
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Announce new API rate limits"
                    value={taskParams.goal ?? ''}
                    onChange={(e) => setTaskParams({ ...taskParams, goal: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Campaign Type
                    </label>
                    <select
                      value={taskParams.campaignType ?? 'PROMOTIONAL'}
                      onChange={(e) =>
                        setTaskParams({ ...taskParams, campaignType: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                    >
                      <option value="PROMOTIONAL">Promotional</option>
                      <option value="RENEWAL_REMINDER">Renewal Reminder</option>
                      <option value="ANNOUNCEMENT">Announcement</option>
                      <option value="CUSTOM">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Tone</label>
                    <select
                      value={taskParams.tone ?? 'PROFESSIONAL'}
                      onChange={(e) => setTaskParams({ ...taskParams, tone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                    >
                      <option value="PROFESSIONAL">Professional</option>
                      <option value="FRIENDLY">Friendly</option>
                      <option value="URGENT">Urgent</option>
                      <option value="PERSUASIVE">Persuasive</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Execution Result Feedback */}
            {taskExecutionResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                  taskExecutionResult.status === 'COMPLETED'
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-200'
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  {taskExecutionResult.status === 'COMPLETED' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span>Status: {taskExecutionResult.status}</span>
                </div>
                <p className="text-[11px]">{taskExecutionResult.resultSummary}</p>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleExecuteTask}
                disabled={executingTask || !selectedAgent.enabled || isEmergencyActive}
                className="px-5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {executingTask && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{executingTask ? 'Dispatching...' : 'Dispatch Task'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: CONFIGURATION MODAL */}
      {/* ========================================================================= */}
      {activeModal === 'config' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md p-6 rounded-2xl bg-dark-900 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Configure {selectedAgent.name}
                </h3>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Task Timeout (seconds)
                </label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  value={configForm.taskTimeoutSeconds}
                  onChange={(e) =>
                    setConfigForm({ ...configForm, taskTimeoutSeconds: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Tasks exceeding this duration will be safely aborted.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Max Retries
                </label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={configForm.maxRetries}
                  onChange={(e) =>
                    setConfigForm({ ...configForm, maxRetries: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Log Level</label>
                <select
                  value={configForm.logLevel}
                  onChange={(e) =>
                    setConfigForm({ ...configForm, logLevel: e.target.value as any })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="INFO">INFO (Standard)</option>
                  <option value="DEBUG">DEBUG (Verbose)</option>
                  <option value="WARN">WARN (Warnings only)</option>
                  <option value="ERROR">ERROR (Errors only)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="px-5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold transition flex items-center gap-1.5"
              >
                {savingConfig && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{savingConfig ? 'Saving...' : 'Save Settings'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: AGENT DIAGNOSTICS & DETAILS MODAL */}
      {/* ========================================================================= */}
      {activeModal === 'details' && selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-xl p-6 rounded-2xl bg-dark-900 border border-slate-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-brand-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {selectedAgent.name} Diagnostics
                </h3>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Description</span>
                <p className="text-slate-200 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  {selectedAgent.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">Runtime Status</span>
                  <span className="font-bold text-white text-sm">{selectedAgent.status}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">Timeout Configuration</span>
                  <span className="font-bold text-white text-sm">
                    {Math.round((selectedAgent.config?.taskTimeoutMs || 30000) / 1000)} seconds
                  </span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block mb-1">
                  Health & Connectivity Report
                </span>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[11px]">
                  {selectedAgent.health?.message}
                </div>
              </div>

              {selectedAgent.health?.metrics && (
                <div>
                  <span className="text-slate-400 font-semibold block mb-1">Runtime Metrics</span>
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-emerald-400 overflow-x-auto">
                    {JSON.stringify(selectedAgent.health.metrics, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: TASK DETAILS INSPECTOR */}
      {/* ========================================================================= */}
      {activeModal === 'taskDetails' && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-2xl p-6 rounded-2xl bg-dark-900 border border-slate-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  <span>Task Execution Record</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getStatusColor(
                      selectedTask.status
                    )}`}
                  >
                    {selectedTask.status}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedTask.id}</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">Agent</span>
                <span className="font-semibold text-white">{selectedTask.agentName}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">Operation</span>
                <span className="font-semibold text-white">{selectedTask.taskType}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">Duration</span>
                <span className="font-semibold text-white">
                  {selectedTask.durationMs ? `${selectedTask.durationMs}ms` : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">Initiated By</span>
                <span className="font-semibold text-white truncate block">
                  {selectedTask.initiatedBy}
                </span>
              </div>
            </div>

            {selectedTask.resultSummary && (
              <div>
                <span className="text-xs font-semibold text-slate-400 block mb-1">
                  Summary Result
                </span>
                <p className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200">
                  {selectedTask.resultSummary}
                </p>
              </div>
            )}

            {selectedTask.errorMessage && (
              <div>
                <span className="text-xs font-semibold text-rose-400 block mb-1">
                  Error Details
                </span>
                <p className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 font-mono">
                  {selectedTask.errorMessage}
                </p>
              </div>
            )}

            {selectedTask.resultData && (
              <div>
                <span className="text-xs font-semibold text-slate-400 block mb-1">Output Data</span>
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-emerald-400 overflow-x-auto max-h-60">
                  {JSON.stringify(selectedTask.resultData, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: EMERGENCY STOP CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {activeModal === 'emergencyStop' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-dark-900 border border-rose-500/40 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Activate Emergency Stop
                </h3>
                <p className="text-xs text-rose-300">Halt all automated tasks immediately</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-200/90 leading-relaxed space-y-2">
              <p>
                <strong>Security Impact:</strong> Activating Emergency Stop immediately suspends all
                agent task dispatchers, stops recurring scans, and cancels supported in-progress jobs.
              </p>
              <p className="text-[11px] text-rose-300/80">
                Important: Stopping agents cannot undo external banking transfers that have already
                settled or recall emails already dispatched to remote mail servers.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Audit Reason (Required for administrative log)
              </label>
              <textarea
                rows={3}
                placeholder="Explain why Emergency Stop is being activated..."
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEmergencyStop}
                disabled={emergencySubmitting || !emergencyReason.trim()}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 shadow-lg shadow-rose-950/50"
              >
                {emergencySubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Emergency Stop</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: RESUME OPERATIONS CONFIRMATION */}
      {/* ========================================================================= */}
      {activeModal === 'emergencyResume' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md p-6 rounded-2xl bg-dark-900 border border-emerald-500/40 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-emerald-400">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <RotateCw className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Resume Normal Operations
                </h3>
                <p className="text-xs text-emerald-300">Clear emergency hold</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to lift the emergency hold? Normal task execution and scheduled
              automations will resume immediately.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEmergencyResume}
                disabled={emergencySubmitting}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
              >
                {emergencySubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Resume Operations</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ========================================================================= */}
      {/* MODAL 7: COMMAND BOX DESTRUCTIVE ACTION CONFIRMATION */}
      {/* ========================================================================= */}
      {pendingCommandConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md p-6 rounded-2xl bg-dark-900 border border-amber-500/40 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Confirmation Required
                </h3>
                <p className="text-xs text-amber-300">Destructive operation safety gate</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/20 text-xs text-amber-200/90 whitespace-pre-wrap leading-relaxed font-mono">
              {pendingCommandConfirm.confirmationPrompt}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              This action requires explicit admin authorization. Confirm to execute with live administrative authority.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPendingCommandConfirm(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleExecuteCommand(true)}
                disabled={commandLoading}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {commandLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm &amp; Execute</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default AgentManagerPage;
