"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Lock,
  Loader2,
  RotateCw,
  Settings2,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { RetryNotice } from "@/components/retry-notice";
import { apiRequest } from "@/lib/api-client";
import { subscribeToDemoRuns } from "@/lib/demo-mode";
import { devPilotRoleHeaders } from "@/lib/rbac";

type HealAction = {
  action: string;
  target: string;
  status: "simulated";
  detail: string;
};

type HealResult = {
  message: string;
  actions: HealAction[];
  healed_at: string;
};

const actionIcons = {
  restart_failed_pod: RotateCw,
  rollback_deployment: Undo2,
  patch_config: Settings2,
};

export function AutoHealPanel() {
  const { role, can, roleLabel } = useRole();
  const [isHealing, setIsHealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HealResult | null>(null);
  const canRunAutoHeal = can("run_auto_heal");

  useEffect(
    () =>
      subscribeToDemoRuns((payload) => {
        setResult(payload.auto_heal);
        setError(null);
        setIsHealing(false);
      }),
    [],
  );

  async function runAutoHeal() {
    if (!canRunAutoHeal) {
      setError("Auto Heal requires the Admin role.");
      return;
    }

    setIsHealing(true);
    setError(null);
    setResult(null);

    try {
      const payload = await apiRequest<HealResult>("/auto-heal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({
          namespace: "production",
          failed_pod: "api-7f9d8c6b5d-crashloop",
          deployment: "devpilot-api",
          config_map: "devpilot-api-config",
        }),
        errorMessage: "Auto Heal failed.",
        retries: 1,
      });

      setResult(payload);
    } catch (healError) {
      setError(
        healError instanceof Error
          ? healError.message
          : "Could not reach the Auto Heal API.",
      );
    } finally {
      setIsHealing(false);
    }
  }

  return (
    <section id="auto-heal" className="bg-[#0b0f11] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-lime-200">
            Manual Fallback
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Review the recovery sequence the agent can apply.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            The same sequence restarts a failed pod, rolls back the active
            deployment, and patches runtime configuration.
          </p>
          <button
            type="button"
            onClick={runAutoHeal}
            disabled={isHealing || !canRunAutoHeal}
            className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(190,242,100,0.16)] transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isHealing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : !canRunAutoHeal ? (
              <Lock className="size-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4" aria-hidden="true" />
            )}
            {canRunAutoHeal ? "Run Manual Heal" : "Admin Only"}
          </button>
          {!canRunAutoHeal ? (
            <div className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              {roleLabel} can review the recovery plan, but Auto Heal execution is
              reserved for Admins.
            </div>
          ) : null}

          {result ? (
            <div className="mt-4 rounded-md border border-lime-300/25 bg-lime-300/10 px-4 py-3 text-sm text-lime-50">
              <div className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-lime-200"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-semibold">{result.message}</p>
                  <p className="mt-1 text-lime-100/75">
                    Completed at {new Date(result.healed_at).toLocaleString()}.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <div className="grid gap-3">
            {(result?.actions ?? [
              {
                action: "restart_failed_pod",
                target: "production/api-7f9d8c6b5d-crashloop",
                status: "simulated" as const,
                detail: "Waiting to restart failed pod.",
              },
              {
                action: "rollback_deployment",
                target: "production/devpilot-api",
                status: "simulated" as const,
                detail: "Waiting to roll back deployment.",
              },
              {
                action: "patch_config",
                target: "production/devpilot-api-config",
                status: "simulated" as const,
                detail: "Waiting to patch configuration.",
              },
            ]).map((action) => {
              const Icon =
                actionIcons[action.action as keyof typeof actionIcons] ?? ShieldCheck;
              const completed = Boolean(result);

              return (
                <div
                  key={action.action}
                  className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                      {completed ? (
                        <CheckCircle2
                          className="size-5 text-lime-200"
                          aria-hidden="true"
                        />
                      ) : (
                        <Icon className="size-5 text-zinc-400" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white">
                        {action.action.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 truncate font-mono text-xs text-emerald-100/80">
                        {action.target}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-zinc-400">
                        {action.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error ? (
            <div className="mt-4">
              <RetryNotice
                message={error}
                onRetry={canRunAutoHeal ? runAutoHeal : undefined}
                retryLabel="Retry heal"
              />
            </div>
          ) : null}

        </div>
      </div>
    </section>
  );
}
