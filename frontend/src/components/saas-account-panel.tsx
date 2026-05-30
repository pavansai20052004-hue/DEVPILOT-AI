"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  Plus,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { useAuth } from "@/components/auth-provider";
import {
  BillingPlanId,
  devPilotTeamHeaders,
  SaaSBootstrap,
  TeamUsageMetric,
  useTeam,
} from "@/components/team-provider";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

const usageLabels: Record<TeamUsageMetric["metric"], string> = {
  api_requests: "API requests",
  ai_actions: "AI actions",
  autonomous_actions: "Agent actions",
  auto_heal_actions: "Recovery actions",
};

type AuthIntegrationCheck = {
  configured: boolean;
  ready: boolean;
  detail: string;
  provider_name?: string | null;
};

type AuthIntegrationsReadiness = {
  smtp: AuthIntegrationCheck;
  sso: AuthIntegrationCheck;
};

export function SaaSAccountPanel() {
  const { session } = useAuth();
  const { role, can, roleLabel } = useRole();
  const { teamId, setTeamId } = useTeam();
  const [bootstrap, setBootstrap] = useState<SaaSBootstrap | null>(null);
  const [integrations, setIntegrations] =
    useState<AuthIntegrationsReadiness | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [updatingPlanId, setUpdatingPlanId] = useState<BillingPlanId | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("Acme Platform");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [newTeamPlan, setNewTeamPlan] = useState<BillingPlanId>("free");
  const [inviteEmail, setInviteEmail] = useState("teammate@acme.test");
  const [inviteRole, setInviteRole] = useState("member");
  const canManageBilling = can("manage_billing");
  const canChangePlans = role === "admin";

  const loadBootstrap = useCallback(
    async (activeTeamId = teamId) => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/saas/bootstrap`, {
          cache: "no-store",
          headers: devPilotTeamHeaders(activeTeamId),
        });
        const payload: unknown = await response.json();

        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, "SaaS account data is unavailable."));
        }

        setBootstrap(payload as SaaSBootstrap);
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not reach the SaaS account API.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [teamId],
  );

  const loadIntegrations = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/integrations/readiness`, {
        cache: "no-store",
        credentials: "include",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Integration status is unavailable."),
        );
      }

      setIntegrations(payload as AuthIntegrationsReadiness);
    } catch {
      setIntegrations(null);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBootstrap();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadBootstrap]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadIntegrations();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadIntegrations]);

  const currentPlan = bootstrap?.usage.plan;
  const currentTeam = bootstrap?.usage.team;
  const memberCount = bootstrap?.usage.members.length ?? 0;
  const apiUsage = bootstrap?.usage.usage.find(
    (metric) => metric.metric === "api_requests",
  );
  const aiUsage = bootstrap?.usage.usage.find(
    (metric) => metric.metric === "ai_actions",
  );

  const billingPeriod = useMemo(() => {
    if (!bootstrap) {
      return "Pending";
    }

    const start = new Date(bootstrap.usage.billing_period_start).toLocaleDateString();
    const end = new Date(bootstrap.usage.billing_period_end).toLocaleDateString();
    return `${start} to ${end}`;
  }, [bootstrap]);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsCreatingTeam(true);

    try {
        const response = await fetch(`${API_BASE_URL}/saas/teams`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...devPilotTeamHeaders(teamId),
          },
          body: JSON.stringify({
            name: teamName,
            owner_email: ownerEmail || session?.user?.email || "",
            plan_id: newTeamPlan,
          }),
        });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Team account creation failed."));
      }

      const createdTeam = payload as SaaSBootstrap["current_team"];
      setTeamId(createdTeam.id);
      await loadBootstrap(createdTeam.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create the team account.",
      );
    } finally {
      setIsCreatingTeam(false);
    }
  }

  async function updatePlan(planId: BillingPlanId) {
    if (!currentTeam) {
      return;
    }
    if (!canChangePlans) {
      setError("Billing plan changes require the Admin role.");
      return;
    }

    setError(null);
    setUpdatingPlanId(planId);

    try {
      const response = await fetch(
        `${API_BASE_URL}/saas/teams/${currentTeam.id}/plan`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...devPilotTeamHeaders(teamId),
            ...devPilotRoleHeaders(role),
          },
          body: JSON.stringify({ plan_id: planId }),
        },
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Plan update failed."));
      }

      await loadBootstrap(currentTeam.id);
    } catch (planError) {
      setError(
        planError instanceof Error
          ? planError.message
          : "Could not update the billing plan.",
      );
    } finally {
      setUpdatingPlanId(null);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentTeam) {
      return;
    }
    if (!canManageBilling) {
      setError("Team member invites require Admin or DevOps Engineer access.");
      return;
    }

    setError(null);
    setIsInviting(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/saas/teams/${currentTeam.id}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...devPilotTeamHeaders(teamId),
            ...devPilotRoleHeaders(role),
          },
          body: JSON.stringify({
            email: inviteEmail,
            role: inviteRole,
          }),
        },
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Team invite failed."));
      }

      await loadBootstrap(currentTeam.id);
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : "Could not invite the team member.",
      );
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <section className="bg-[#07100f] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            SaaS Control Plane
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Team accounts, plans, and usage metering.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot now separates customer workspaces, tracks monthly usage,
            and gates billing-plan changes behind account roles.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <Building2 className="size-4 text-cyan-200" aria-hidden="true" />
                Active Team
              </div>
              <p className="text-2xl font-semibold text-white">
                {currentTeam?.name ?? "Loading"}
              </p>
              <p className="mt-2 truncate text-xs text-zinc-500">
                {currentTeam?.id ?? teamId}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <CreditCard className="size-4 text-lime-200" aria-hidden="true" />
                Plan
              </div>
              <p className="text-2xl font-semibold text-white">
                {currentPlan?.name ?? "Pending"}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {currentPlan ? `$${currentPlan.monthly_price_usd}/mo` : billingPeriod}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <Users className="size-4 text-sky-200" aria-hidden="true" />
                Members
              </div>
              <p className="font-mono text-2xl font-semibold text-white">
                {memberCount}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {currentPlan?.included_members ?? 0} included
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <TrendingUp className="size-4 text-emerald-200" aria-hidden="true" />
                API Usage
              </div>
              <p className="font-mono text-2xl font-semibold text-white">
                {apiUsage?.used ?? 0}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {apiUsage?.remaining ?? 0} remaining this month
              </p>
            </div>
          </div>

          <div className="mt-7 rounded-lg border border-white/10 bg-[#101618] p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="size-4 text-cyan-200" aria-hidden="true" />
              Launch Integrations
            </div>
            <div className="grid gap-3">
              <IntegrationStatus
                label="SMTP password reset"
                check={integrations?.smtp ?? null}
              />
              <IntegrationStatus
                label={integrations?.sso.provider_name ?? "OIDC SSO"}
                check={integrations?.sso ?? null}
              />
            </div>
          </div>

          <form
            onSubmit={createTeam}
            className="mt-7 rounded-lg border border-white/10 bg-[#101618] p-4"
          >
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Plus className="size-4 text-cyan-200" aria-hidden="true" />
              Create Customer Team
            </div>
            <div className="grid gap-3">
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
                placeholder="Team name"
              />
              <input
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
                placeholder={session?.user?.email ?? "Owner email"}
              />
              <select
                value={newTeamPlan}
                onChange={(event) =>
                  setNewTeamPlan(event.target.value as BillingPlanId)
                }
                className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm font-semibold text-zinc-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
              <button
                type="submit"
                disabled={isCreatingTeam}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingTeam ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Create Team
              </button>
            </div>
          </form>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-cyan-200">
                  Billing Plans
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Free and Pro tiers
                </h3>
              </div>
              <span className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase text-zinc-300">
                {roleLabel}
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {(bootstrap?.plans ?? []).map((plan) => {
                const active = currentPlan?.id === plan.id;
                const updating = updatingPlanId === plan.id;

                return (
                  <article
                    key={plan.id}
                    className={`rounded-lg border p-4 ${
                      active
                        ? "border-lime-300/35 bg-lime-300/10"
                        : "border-white/10 bg-[#07090b]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-white">
                          {plan.name}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                          ${plan.monthly_price_usd}/month
                        </p>
                      </div>
                      {active ? (
                        <CheckCircle2 className="size-5 text-lime-200" aria-hidden="true" />
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-zinc-300">
                      <p>{plan.included_members} members included</p>
                      <p>{plan.monthly_api_requests.toLocaleString()} API requests</p>
                      <p>{plan.monthly_ai_actions.toLocaleString()} AI actions</p>
                      <p>
                        {plan.monthly_auto_heal_actions.toLocaleString()} recovery actions
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void updatePlan(plan.id)}
                      disabled={active || updating || !canChangePlans}
                      className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {updating ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CreditCard className="size-4" aria-hidden="true" />
                      )}
                      {active ? "Current Plan" : "Select Plan"}
                    </button>
                  </article>
                );
              })}
            </div>

            {!canChangePlans ? (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>{roleLabel} can inspect billing. Admin access can change plans.</p>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-emerald-200">
                  Usage Tracking
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Current billing period
                </h3>
              </div>
              <span className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase text-zinc-300">
                {billingPeriod}
              </span>
            </div>

            <div className="grid gap-3">
              {(bootstrap?.usage.usage ?? []).map((metric) => (
                <div
                  key={metric.metric}
                  className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Zap className="size-4 text-cyan-200" aria-hidden="true" />
                      <p className="font-semibold text-white">
                        {usageLabels[metric.metric]}
                      </p>
                    </div>
                    <p className="font-mono text-sm text-zinc-300">
                      {metric.used.toLocaleString()} / {metric.limit.toLocaleString()}
                    </p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-md bg-white/10">
                    <div
                      className="h-full rounded-md bg-cyan-300"
                      style={{ width: `${metric.percent_used}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    {metric.remaining.toLocaleString()} remaining
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-sky-200">
                  Team Members
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Customer workspace access
                </h3>
              </div>
              {isLoading ? (
                <Loader2 className="size-5 animate-spin text-zinc-500" aria-hidden="true" />
              ) : null}
            </div>

            <div className="grid gap-2">
              {(bootstrap?.usage.members ?? []).map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#07090b] px-4 py-3"
                >
                  <p className="font-semibold text-white">{member.email}</p>
                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold uppercase text-zinc-300">
                    {member.role}
                  </span>
                </div>
              ))}
            </div>

            <form onSubmit={inviteMember} className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem_9rem]">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
                placeholder="Email"
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
                className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm font-semibold text-zinc-100 outline-none transition focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={isInviting || !canManageBilling}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-sky-300/40 bg-sky-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isInviting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Users className="size-4" aria-hidden="true" />
                )}
                Invite
              </button>
            </form>
          </div>

          {!bootstrap && !isLoading ? (
            <div className="rounded-lg border border-white/10 bg-[#101618] p-4 text-sm text-zinc-400">
              SaaS account data is waiting for the backend response.
            </div>
          ) : null}
        </div>
      </div>

      {aiUsage && aiUsage.remaining <= 5 ? (
        <div className="mx-auto mt-5 max-w-7xl rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
          AI action quota is close to the plan limit for this billing period.
        </div>
      ) : null}
    </section>
  );
}

function IntegrationStatus({
  label,
  check,
}: {
  label: string;
  check: AuthIntegrationCheck | null;
}) {
  const ready = check?.ready === true;
  let status = "Checking";
  if (check) {
    if (ready) {
      status = "Ready";
    } else if (check.configured) {
      status = "Needs setup";
    } else {
      status = "Not configured";
    }
  }
  const Icon = ready ? CheckCircle2 : AlertCircle;

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        ready
          ? "border-lime-300/30 bg-lime-300/10"
          : "border-amber-300/20 bg-amber-300/10"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-white">{label}</p>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            {check?.detail ?? "Checking provider configuration."}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold uppercase ${
            ready
              ? "border-lime-300/30 bg-lime-300/15 text-lime-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
          }`}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {status}
        </span>
      </div>
    </div>
  );
}
