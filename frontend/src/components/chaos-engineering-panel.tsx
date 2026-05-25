"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Loader2,
  Lock,
  Radar,
  RotateCw,
  ShieldCheck,
  Terminal,
  Undo2,
  Wrench,
  Zap,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

type ChaosFailureType = "pod_crash" | "network_outage" | "cicd_failure";

type ChaosInjectedFailure = {
  failure_type: ChaosFailureType;
  title: string;
  target: string;
  severity: "medium" | "high" | "critical";
  blast_radius: string;
  signals: string[];
  logs: string;
  injected_at: string;
};

type ChaosDetectionResult = {
  detected: boolean;
  root_cause: string;
  confidence: number;
  recommended_strategy: string;
  detected_at: string;
};

type ChaosTimelineStep = {
  stage: string;
  status: "simulated" | "completed";
  detail: string;
  completed_at: string;
};

type ChaosHealAction = {
  action: string;
  target: string;
  status: "simulated";
  detail: string;
};

type ChaosHealResult = {
  message: string;
  actions: ChaosHealAction[];
  healed_at: string;
};

type ChaosInjectionResponse = {
  mode: "chaos";
  message: string;
  failure: ChaosInjectedFailure;
  detection: ChaosDetectionResult;
  auto_heal: ChaosHealResult;
  timeline: ChaosTimelineStep[];
  incident_records_created: number;
  ran_at: string;
};


const scenarioOptions: {
  id: ChaosFailureType;
  label: string;
  detail: string;
  icon: typeof Activity;
  activeClassName: string;
}[] = [
  {
    id: "pod_crash",
    label: "Pod Crash",
    detail: "CrashLoopBackOff on an API replica",
    icon: Terminal,
    activeClassName: "border-red-300/50 bg-red-300/15 text-red-50",
  },
  {
    id: "network_outage",
    label: "Network Outage",
    detail: "Blocked service egress path",
    icon: Activity,
    activeClassName: "border-sky-300/50 bg-sky-300/15 text-sky-50",
  },
  {
    id: "cicd_failure",
    label: "CI/CD Failure",
    detail: "Release pipeline gate failure",
    icon: GitBranch,
    activeClassName: "border-amber-300/50 bg-amber-300/15 text-amber-50",
  },
];

const pendingTimeline: ChaosTimelineStep[] = [
  {
    stage: "Failure injected",
    status: "simulated",
    detail: "Waiting for an injected chaos event.",
    completed_at: "",
  },
  {
    stage: "Signal detected",
    status: "completed",
    detail: "Runtime, cluster, or pipeline signals will be correlated.",
    completed_at: "",
  },
  {
    stage: "Root cause ranked",
    status: "completed",
    detail: "DevPilot will pick the highest-confidence recovery path.",
    completed_at: "",
  },
  {
    stage: "Auto-heal executed",
    status: "simulated",
    detail: "Recovery actions will run in safe simulation mode.",
    completed_at: "",
  },
  {
    stage: "Recovery validated",
    status: "completed",
    detail: "Synthetic checks will confirm the system is healthy again.",
    completed_at: "",
  },
];

const actionIcons: Record<string, typeof Activity> = {
  restart_failed_pod: RotateCw,
  rollback_deployment: Undo2,
  patch_config: Wrench,
  restore_network_policy: Activity,
  patch_ci_workflow: GitBranch,
  validate_release_gate: ShieldCheck,
  validate_service_path: Radar,
};

const severityClasses: Record<ChaosInjectedFailure["severity"], string> = {
  medium: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  high: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  critical: "border-red-400/25 bg-red-400/10 text-red-100",
};


function formatActionLabel(action: string) {
  return action.replaceAll("_", " ");
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;
}

export function ChaosEngineeringPanel() {
  const { role, can, roleLabel } = useRole();
  const [selectedFailure, setSelectedFailure] =
    useState<ChaosFailureType>("pod_crash");
  const [result, setResult] = useState<ChaosInjectionResponse | null>(null);
  const [visibleStepCount, setVisibleStepCount] = useState(0);
  const [isInjecting, setIsInjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRunChaos = can("run_chaos");

  useEffect(() => {
    if (!result) {
      return;
    }

    const timers = result.timeline.map((_, index) =>
      window.setTimeout(() => {
        setVisibleStepCount(index + 1);
      }, 260 + index * 620),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [result]);

  const selectedScenario = useMemo(
    () => scenarioOptions.find((option) => option.id === selectedFailure),
    [selectedFailure],
  );

  async function injectFailure() {
    if (!canRunChaos) {
      setError("Chaos injection requires the Admin role.");
      return;
    }

    setIsInjecting(true);
    setError(null);
    setResult(null);
    setVisibleStepCount(1);

    try {
      const response = await fetch(`${API_BASE_URL}/chaos/inject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({
          failure_type: selectedFailure,
          namespace: "production",
          service: "devpilot-api",
          deployment: "devpilot-api",
          pod_name: "api-7f9d8c6b5d-chaos",
          workflow: "release-image",
          branch: "main",
          commit_sha: "chaos24",
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Chaos injection could not be completed."),
        );
      }

      setVisibleStepCount(0);
      setResult(payload as ChaosInjectionResponse);
    } catch (chaosError) {
      setError(
        chaosError instanceof Error
          ? chaosError.message
          : "Could not reach the chaos engineering API.",
      );
      setVisibleStepCount(0);
    } finally {
      setIsInjecting(false);
    }
  }

  const timeline = result?.timeline ?? pendingTimeline;
  const recoveryVisible = result ? visibleStepCount >= 4 : false;

  return (
    <section id="chaos-engineering" className="bg-[#07090b] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-red-200">
            Chaos Engineering
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Inject a controlled failure and watch DevPilot heal it.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            Simulate a pod crash, network outage, or CI/CD failure. DevPilot
            detects the blast radius, chooses the recovery path, and records the
            auto-heal run.
          </p>

          <div className="mt-7 grid gap-2 sm:grid-cols-3">
            {scenarioOptions.map((option) => {
              const Icon = option.icon;
              const selected = option.id === selectedFailure;

              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={isInjecting}
                  onClick={() => {
                    setSelectedFailure(option.id);
                    setError(null);
                  }}
                  className={`min-h-28 rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected
                      ? option.activeClassName
                      : "border-white/10 bg-[#111719] text-zinc-300 hover:border-red-200/35 hover:bg-white/5"
                  }`}
                >
                  <Icon className="mb-3 size-5" aria-hidden="true" />
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-2 block text-xs leading-5 opacity-80">
                    {option.detail}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={injectFailure}
            disabled={isInjecting || !canRunChaos}
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-md border border-red-300/40 bg-red-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(252,165,165,0.16)] transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isInjecting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : !canRunChaos ? (
              <Lock className="size-4" aria-hidden="true" />
            ) : (
              <Zap className="size-4" aria-hidden="true" />
            )}
            {canRunChaos ? "Inject Failure" : "Admin Only"}
          </button>

          {!canRunChaos ? (
            <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              {roleLabel} can observe chaos results, but failure injection is
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

        <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-red-200">
                {selectedScenario?.label ?? "Chaos"} Run
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {result?.failure.title ?? "Ready to inject"}
              </h3>
            </div>
            <span
              className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase ${
                result
                  ? severityClasses[result.failure.severity]
                  : "border-white/10 bg-white/5 text-zinc-300"
              }`}
            >
              {result?.failure.severity ?? "armed"}
            </span>
          </div>

          <div className="mt-5 rounded-lg border border-white/10 bg-[#07090b] p-4">
            {result ? (
              <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Target
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-red-50">
                    {result.failure.target}
                  </p>
                  <p className="mt-4 text-sm leading-6 text-zinc-300">
                    {result.failure.blast_radius}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Detection
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <CheckCircle2 className="size-4 text-lime-200" aria-hidden="true" />
                    <span className="text-sm font-semibold text-lime-50">
                      {formatPercent(result.detection.confidence)} confidence
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    {result.detection.root_cause}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                  {isInjecting ? (
                    <Loader2 className="size-5 animate-spin text-red-200" aria-hidden="true" />
                  ) : (
                    <Zap className="size-5 text-red-200" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {isInjecting ? "Injecting controlled failure" : "Chaos mode is armed"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {selectedScenario?.detail ?? "Select a failure mode"}.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-3">
            {timeline.map((step, index) => {
              const revealed = result ? index < visibleStepCount : false;
              const active = result
                ? index === visibleStepCount
                : isInjecting && index === 0;

              return (
                <article
                  key={step.stage}
                  className={`rounded-lg border p-4 transition ${
                    revealed
                      ? "border-lime-300/25 bg-lime-300/10"
                      : active
                        ? "border-red-300/30 bg-red-300/10"
                        : "border-white/10 bg-[#07090b]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                      {revealed ? (
                        <CheckCircle2 className="size-5 text-lime-200" aria-hidden="true" />
                      ) : active ? (
                        <Loader2 className="size-5 animate-spin text-red-200" aria-hidden="true" />
                      ) : (
                        <Activity className="size-5 text-zinc-500" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-white">{step.stage}</p>
                        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold uppercase text-zinc-400">
                          {step.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ShieldCheck className="size-4 text-lime-200" aria-hidden="true" />
              Auto-Heal Actions
            </div>

            {result ? (
              <div className="grid gap-3">
                {result.auto_heal.actions.map((action) => {
                  const Icon = actionIcons[action.action] ?? Wrench;

                  return (
                    <article
                      key={`${action.action}:${action.target}`}
                      className={`rounded-lg border p-4 transition ${
                        recoveryVisible
                          ? "border-lime-300/25 bg-lime-300/10"
                          : "border-white/10 bg-[#07090b]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid size-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                          {recoveryVisible ? (
                            <CheckCircle2 className="size-5 text-lime-200" aria-hidden="true" />
                          ) : (
                            <Icon className="size-5 text-zinc-500" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white">
                            {formatActionLabel(action.action)}
                          </p>
                          <p className="mt-1 break-all font-mono text-xs text-lime-100/80">
                            {action.target}
                          </p>
                          <p className="mt-3 text-sm leading-6 text-zinc-400">
                            {action.detail}
                          </p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
                Recovery actions will stream here after failure injection.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
