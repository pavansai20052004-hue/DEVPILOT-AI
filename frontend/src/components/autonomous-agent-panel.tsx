"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  Bug,
  CheckCircle2,
  Clock3,
  Database,
  FileCode2,
  ListChecks,
  Lock,
  Loader2,
  MonitorCheck,
  Radar,
  RotateCw,
  ServerCog,
  ShieldCheck,
  Undo2,
  UserCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { subscribeToDemoRuns } from "@/lib/demo-mode";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL } from "@/lib/api-client";

type DevPilotAgentId =
  | "monitoring"
  | "bug_sentinel"
  | "frontend_guardian"
  | "backend_guardian"
  | "database_guardian"
  | "ui_monitor"
  | "root_cause"
  | "fix_generator"
  | "auto_heal"
  | "security"
  | "release_auditor";

type DevPilotAgentState = "waiting" | "active" | "completed" | "blocked";

type AutonomousActionStatus =
  | "observed"
  | "decided"
  | "pending_approval"
  | "approved"
  | "completed"
  | "simulated"
  | "skipped"
  | "rejected"
  | "failed";

type AutonomousApprovalStatus =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "failed";

type AutonomousActionLogRecord = {
  id: string;
  cycle_id: string;
  incident_id?: string | null;
  agent_id: DevPilotAgentId;
  agent_name: string;
  action_type: string;
  target: string;
  status: AutonomousActionStatus;
  detail: string;
  created_at: string;
};

type DevPilotAgentProfile = {
  id: DevPilotAgentId;
  name: string;
  mission: string;
  status: DevPilotAgentState;
  last_action: string;
  last_action_at?: string | null;
  handoff_to?: string | null;
  actions_logged: number;
};

type AgentCollaborationHandoff = {
  from_agent: string;
  to_agent: string;
  status: "pending" | "completed";
  detail: string;
};

type AutonomousAgentDecision = {
  incident_id?: string | null;
  summary: string;
  severity?: string | null;
  strategy: string;
  confidence: number;
  actions: string[];
  reason: string;
};

type AutonomousApprovalRecord = {
  id: string;
  cycle_id: string;
  incident_id?: string | null;
  summary: string;
  severity?: string | null;
  strategy: string;
  confidence: number;
  actions: string[];
  cloud_provider: "aws" | "azure" | "gcp";
  status: AutonomousApprovalStatus;
  requested_at: string;
  reviewed_at?: string | null;
  reviewed_by_role?: string | null;
  reviewer_note?: string | null;
  applied_at?: string | null;
  failure_reason?: string | null;
};

type AutonomousAgentStatus = {
  enabled: boolean;
  running: boolean;
  mode: "simulation" | "kubernetes";
  interval_seconds: number;
  apply_real_kubernetes_actions: boolean;
  require_human_approval: boolean;
  last_checked_at?: string | null;
  last_decision?: AutonomousAgentDecision | null;
  last_error?: string | null;
  total_actions_logged: number;
  pending_approvals: AutonomousApprovalRecord[];
  recent_actions: AutonomousActionLogRecord[];
  agents: DevPilotAgentProfile[];
  handoffs: AgentCollaborationHandoff[];
};


const actionIcons = {
  monitor_incidents: Activity,
  monitor_kubernetes: Activity,
  decide_remediation: Bot,
  generate_remediation: FileCode2,
  restart_failed_pod: RotateCw,
  rollback_deployment: Undo2,
  patch_config: Wrench,
  remediation_completed: ShieldCheck,
  configure_agent: Bot,
  agent_error: AlertCircle,
  approval_requested: UserCheck,
  approval_approved: CheckCircle2,
  approval_rejected: XCircle,
  audit_frontend_routes: MonitorCheck,
  audit_pending_work: ListChecks,
  chaos_injection: AlertCircle,
  chaos_detected: Activity,
  chaos_recovered: ShieldCheck,
  monitor_ui_sections: Radar,
  restore_network_policy: Wrench,
  patch_ci_workflow: FileCode2,
  security_scan: ShieldCheck,
  security_review: ShieldCheck,
  scan_error_backlog: Bug,
  validate_backend_contracts: ServerCog,
  verify_database_storage: Database,
  validate_release_gate: ShieldCheck,
  validate_service_path: ShieldCheck,
};

const agentIcons: Record<DevPilotAgentId, typeof Activity> = {
  monitoring: Radar,
  bug_sentinel: Bug,
  frontend_guardian: MonitorCheck,
  backend_guardian: ServerCog,
  database_guardian: Database,
  ui_monitor: Radar,
  root_cause: Bot,
  fix_generator: FileCode2,
  auto_heal: Wrench,
  security: ShieldCheck,
  release_auditor: ListChecks,
};

const statusClasses: Record<AutonomousActionStatus, string> = {
  observed: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  decided: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  pending_approval: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  approved: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  completed: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  simulated: "border-lime-300/25 bg-lime-300/10 text-lime-100",
  skipped: "border-zinc-500/25 bg-white/5 text-zinc-300",
  rejected: "border-red-400/25 bg-red-400/10 text-red-100",
  failed: "border-red-400/25 bg-red-400/10 text-red-100",
};

const agentStatusClasses: Record<DevPilotAgentState, string> = {
  waiting: "border-zinc-500/25 bg-white/5 text-zinc-300",
  active: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  completed: "border-lime-300/25 bg-lime-300/10 text-lime-100",
  blocked: "border-red-400/25 bg-red-400/10 text-red-100",
};

const approvalStatusClasses: Record<AutonomousApprovalStatus, string> = {
  pending: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  approved: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  applied: "border-lime-300/25 bg-lime-300/10 text-lime-100",
  rejected: "border-red-400/25 bg-red-400/10 text-red-100",
  failed: "border-red-400/25 bg-red-400/10 text-red-100",
};

function formatActionLabel(actionType: string) {
  return actionType.replaceAll("_", " ");
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString();
}

export function AutonomousAgentPanel() {
  const { role, can, roleLabel } = useRole();
  const [status, setStatus] = useState<AutonomousAgentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [reviewingApprovalId, setReviewingApprovalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRunAgents = can("run_agents");
  const canApproveAgentActions = can("approve_agent_actions");

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/agent/status`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as AutonomousAgentStatus;

      if (!response.ok) {
        throw new Error("Autonomous agent status is unavailable.");
      }

      setStatus(payload);
      setError(null);
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not reach the autonomous agent API.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function runCollaboration() {
    if (!canRunAgents) {
      setError("Multi-agent collaboration requires the Admin role.");
      return;
    }

    setIsCollaborating(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/agents/collaborate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: "{}",
      });
      const payload = (await response.json()) as
        | AutonomousAgentStatus
        | { detail?: string };

      if (!response.ok) {
        throw new Error(
          "detail" in payload && payload.detail
            ? payload.detail
            : "Could not run multi-agent collaboration.",
        );
      }

      setStatus(payload as AutonomousAgentStatus);
    } catch (collaborationError) {
      setError(
        collaborationError instanceof Error
          ? collaborationError.message
          : "Could not reach the multi-agent API.",
      );
    } finally {
      setIsCollaborating(false);
    }
  }

  async function reviewApproval(approvalId: string, approved: boolean) {
    if (!canApproveAgentActions) {
      setError("Autonomous remediation approval requires Admin or DevOps Engineer access.");
      return;
    }

    setReviewingApprovalId(approvalId);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/agent/approvals/${approvalId}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...devPilotRoleHeaders(role),
          },
          body: JSON.stringify({ approved }),
        },
      );
      const payload = (await response.json()) as
        | AutonomousAgentStatus
        | { detail?: string };

      if (!response.ok) {
        throw new Error(
          "detail" in payload && payload.detail
            ? payload.detail
            : "Could not review autonomous remediation.",
        );
      }

      setStatus(payload as AutonomousAgentStatus);
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not reach the approval API.",
      );
    } finally {
      setReviewingApprovalId(null);
    }
  }

  useEffect(() => {
    window.setTimeout(() => {
      void loadStatus();
    }, 0);
    const statusInterval = window.setInterval(() => {
      void loadStatus();
    }, 5_000);
    const unsubscribeDemoRuns = subscribeToDemoRuns(() => {
      window.setTimeout(() => {
        void loadStatus();
      }, 600);
    });

    return () => {
      window.clearInterval(statusInterval);
      unsubscribeDemoRuns();
    };
  }, [loadStatus]);

  const currentDecision = status?.last_decision;
  const visibleActions = useMemo(
    () => status?.recent_actions.slice(0, 12) ?? [],
    [status?.recent_actions],
  );
  const visibleApprovals = status?.pending_approvals ?? [];
  const visibleAgents = status?.agents ?? [];
  const visibleHandoffs = status?.handoffs ?? [];

  return (
    <section id="autonomous-agent" className="bg-[#0b0f11] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-lime-200">
            Autonomous Agent
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Specialist agents audit, fix, and verify the full product.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot now assigns focused agents for bugs, frontend, backend,
            database, full UI monitoring, release gaps, security, and auto-heal
            execution with human approval.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <Bot className="size-4 text-lime-200" aria-hidden="true" />
                State
              </div>
              <p className="text-2xl font-semibold text-white">
                {isLoading ? "Loading" : status?.running ? "Running" : "Paused"}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <Clock3 className="size-4 text-sky-200" aria-hidden="true" />
                Interval
              </div>
              <p className="font-mono text-2xl font-semibold text-white">
                {status?.interval_seconds ?? 0}s
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <ShieldCheck className="size-4 text-emerald-200" aria-hidden="true" />
                Actions
              </div>
              <p className="font-mono text-2xl font-semibold text-white">
                {status?.total_actions_logged ?? 0}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={runCollaboration}
            disabled={isCollaborating || !canRunAgents}
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(190,242,100,0.16)] transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCollaborating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : !canRunAgents ? (
              <Lock className="size-4" aria-hidden="true" />
            ) : (
              <Bot className="size-4" aria-hidden="true" />
            )}
            {canRunAgents ? "Run Collaboration" : "Admin Only"}
          </button>

          {!canRunAgents ? (
            <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              {roleLabel} can watch agent activity, but collaboration runs are
              reserved for Admins.
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-lime-200">
                Decision Engine
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {currentDecision
                  ? formatActionLabel(currentDecision.strategy)
                  : "Waiting for incident signal"}
              </h3>
            </div>
            <span className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase text-zinc-300">
              {status?.mode ?? "simulation"}
            </span>
          </div>

          {currentDecision ? (
            <div className="mt-4 rounded-lg border border-lime-300/20 bg-lime-300/10 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-lime-200" aria-hidden="true" />
                <p className="font-semibold text-lime-50">
                  {Math.round(currentDecision.confidence * 100)}% confidence
                </p>
                {currentDecision.severity ? (
                  <span className="rounded-md border border-red-300/25 bg-red-300/10 px-2 py-1 text-xs font-semibold uppercase text-red-100">
                    {currentDecision.severity}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-lime-50/80">
                {currentDecision.summary}
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                {currentDecision.reason}
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
              Last checked {formatDate(status?.last_checked_at)}.
            </div>
          )}

          <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-50">
                <UserCheck className="size-4 text-amber-200" aria-hidden="true" />
                Approval Gate
              </div>
              <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs font-semibold uppercase text-amber-100">
                {visibleApprovals.length} pending
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {visibleApprovals.map((approval) => {
                const isReviewing = reviewingApprovalId === approval.id;

                return (
                  <article
                    key={approval.id}
                    className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-white">
                          {formatActionLabel(approval.strategy)}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                          {approval.summary}
                        </p>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${approvalStatusClasses[approval.status]}`}
                      >
                        {approval.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {approval.actions.map((action) => (
                        <span
                          key={`${approval.id}:${action}`}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold uppercase text-zinc-300"
                        >
                          {formatActionLabel(action)}
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void reviewApproval(approval.id, true)}
                        disabled={
                          isReviewing ||
                          Boolean(reviewingApprovalId) ||
                          !canApproveAgentActions
                        }
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isReviewing ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : !canApproveAgentActions ? (
                          <Lock className="size-4" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                        )}
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void reviewApproval(approval.id, false)}
                        disabled={
                          isReviewing ||
                          Boolean(reviewingApprovalId) ||
                          !canApproveAgentActions
                        }
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-300/30 bg-red-300/10 px-4 text-sm font-semibold text-red-50 transition hover:bg-red-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <XCircle className="size-4" aria-hidden="true" />
                        Reject
                      </button>
                      <span className="text-xs text-zinc-500">
                        Requested {formatDate(approval.requested_at)}
                      </span>
                    </div>
                  </article>
                );
              })}

              {!visibleApprovals.length ? (
                <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
                  {status?.require_human_approval === false
                    ? "Approval gate is disabled for this agent."
                    : "No generated remediation is waiting for approval."}
                </div>
              ) : null}
            </div>
          </div>

          {!canApproveAgentActions && visibleApprovals.length ? (
            <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              {roleLabel} can watch pending remediation, but approval requires
              Admin or DevOps Engineer access.
            </div>
          ) : null}

          {status?.last_error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{status.last_error}</p>
            </div>
          ) : null}

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Bot className="size-4 text-lime-200" aria-hidden="true" />
              Agent Team
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleAgents.map((agent) => {
                const Icon = agentIcons[agent.id] ?? Bot;

                return (
                  <article
                    key={agent.id}
                    className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                        <Icon className="size-5 text-lime-200" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-white">{agent.name}</p>
                          <span
                            className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${agentStatusClasses[agent.status]}`}
                          >
                            {agent.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                          {agent.mission}
                        </p>
                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-300">
                          {agent.last_action}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span>{agent.actions_logged} action(s)</span>
                          {agent.handoff_to ? (
                            <>
                              <span className="text-zinc-700">/</span>
                              <span>to {agent.handoff_to}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}

              {!visibleAgents.length && !isLoading ? (
                <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400 sm:col-span-2">
                  Agent profiles are waiting for the backend status response.
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Activity className="size-4 text-cyan-200" aria-hidden="true" />
              Collaboration Handoffs
            </div>

            <div className="grid gap-2">
              {visibleHandoffs.map((handoff) => (
                <div
                  key={`${handoff.from_agent}:${handoff.to_agent}`}
                  className="rounded-lg border border-white/10 bg-[#07090b] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {handoff.from_agent} to {handoff.to_agent}
                    </p>
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${
                        handoff.status === "completed"
                          ? "border-lime-300/25 bg-lime-300/10 text-lime-100"
                          : "border-zinc-500/25 bg-white/5 text-zinc-300"
                      }`}
                    >
                      {handoff.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {handoff.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              {isLoading ? (
                <Loader2 className="size-4 animate-spin text-lime-200" aria-hidden="true" />
              ) : (
                <Activity className="size-4 text-lime-200" aria-hidden="true" />
              )}
              Action Log
            </div>

            <div className="grid gap-3">
              {visibleActions.map((action) => {
                const Icon =
                  actionIcons[action.action_type as keyof typeof actionIcons] ?? Activity;

                return (
                  <article
                    key={action.id}
                    className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                        <Icon className="size-5 text-lime-200" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-white">
                              {action.agent_name}
                            </p>
                            <p className="mt-1 text-sm text-zinc-400">
                              {formatActionLabel(action.action_type)}
                            </p>
                          </div>
                          <span
                            className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${statusClasses[action.status]}`}
                          >
                            {action.status}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-emerald-100/80">
                          {action.target}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-zinc-400">
                          {action.detail}
                        </p>
                        <p className="mt-2 text-xs text-zinc-600">
                          {formatDate(action.created_at)}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}

              {!visibleActions.length && !isLoading ? (
                <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
                  No autonomous actions logged yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
