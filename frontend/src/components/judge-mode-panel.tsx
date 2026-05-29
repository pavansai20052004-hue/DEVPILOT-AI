"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  ShieldCheck,
  Stethoscope,
  TimerReset,
  Wrench,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";
import {
  DemoRunPayload,
  JudgeModeResult,
  publishDemoRun,
  writeJudgeModeResult,
} from "@/lib/demo-mode";


const judgeSteps = [
  { label: "Load sample failure", icon: FileText },
  { label: "Run diagnosis", icon: Stethoscope },
  { label: "Generate fix", icon: Wrench },
  { label: "Auto-heal", icon: ShieldCheck },
  { label: "Show dashboard result", icon: BarChart3 },
];

function isDemoRunPayload(value: unknown): value is DemoRunPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    (value as { mode?: unknown }).mode === "demo"
  );
}


function formatElapsedMs(value: number | null) {
  if (value === null) {
    return "30s budget";
  }

  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function buildJudgeModeResult(
  payload: DemoRunPayload,
  elapsedMs: number,
): JudgeModeResult {
  return {
    status: "completed",
    elapsed_ms: elapsedMs,
    completed_at: new Date().toISOString(),
    incident: payload.analysis.root_cause,
    severity: payload.analysis.severity,
    fix: payload.analysis.recommended_fix,
    recovery_actions: payload.auto_heal.actions.length,
    incident_records_created: payload.incident_records_created,
  };
}

export function JudgeModeButton({
  variant = "panel",
}: {
  variant?: "header" | "panel";
}) {
  const router = useRouter();
  const { setRole } = useRole();
  const [isRunning, setIsRunning] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isHeader = variant === "header";

  async function runJudgeMode() {
    setIsRunning(true);
    setCompletedSteps([]);
    setActiveStep(0);
    setElapsedMs(null);
    setError(null);

    const startedAt = performance.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(`${API_BASE_URL}/demo/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const elapsed = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Judge Mode failed to run."));
      }

      if (!isDemoRunPayload(payload)) {
        throw new Error("Judge Mode returned an unexpected demo response.");
      }

      const result = buildJudgeModeResult(payload, elapsed);
      setRole("admin");
      publishDemoRun(payload);
      writeJudgeModeResult(result);
      setElapsedMs(elapsed);
      setCompletedSteps([0, 1, 2, 3]);
      setActiveStep(4);

      window.setTimeout(() => {
        setCompletedSteps([0, 1, 2, 3, 4]);
        setActiveStep(null);
        router.push(`/dashboard?judge=complete&elapsed=${elapsed}`);
      }, 450);
    } catch (judgeError) {
      setError(
        judgeError instanceof DOMException && judgeError.name === "AbortError"
          ? "Judge Mode exceeded the 30 second demo budget."
          : judgeError instanceof Error
            ? judgeError.message
            : "Could not reach the Judge Mode API.",
      );
      setActiveStep(null);
    } finally {
      window.clearTimeout(timeoutId);
      setIsRunning(false);
    }
  }

  const buttonClassName = isHeader
    ? "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-cyan-300/45 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_12px_30px_rgba(125,211,252,0.14)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
    : "inline-flex h-12 items-center justify-center gap-2 rounded-md border border-cyan-300/45 bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_12px_30px_rgba(125,211,252,0.14)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className={isHeader ? "flex flex-col items-end gap-2" : "grid gap-4"}>
      <button
        type="button"
        onClick={runJudgeMode}
        disabled={isRunning}
        className={buttonClassName}
      >
        {isRunning ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : elapsedMs !== null ? (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        {isRunning ? "Running Judge Mode" : "Judge Mode"}
      </button>

      {!isHeader ? (
        <>
          <div className="grid gap-2 sm:grid-cols-5">
            {judgeSteps.map((step, index) => {
              const Icon = step.icon;
              const isComplete = completedSteps.includes(index);
              const isActive = activeStep === index;

              return (
                <div
                  key={step.label}
                  className={`rounded-lg border p-3 ${
                    isComplete
                      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                      : isActive
                        ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                        : "border-white/10 bg-[#07090b] text-zinc-400"
                  }`}
                >
                  <Icon className="mb-3 size-4" aria-hidden="true" />
                  <p className="text-xs font-semibold leading-5">{step.label}</p>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
            <TimerReset className="size-4 text-cyan-200" aria-hidden="true" />
            <span>Elapsed {formatElapsedMs(elapsedMs)}</span>
          </div>
        </>
      ) : null}

      {!isHeader && error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}

export function JudgeModePanel() {
  return (
    <section id="judge-mode" className="bg-[#08100f] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            Judge Mode
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            One click runs the full incident story.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot loads the sample failure, diagnoses it, generates the
            remediation, runs auto-heal, and opens the dashboard result.
          </p>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-cyan-200">
                30 Second Demo
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Sample failure to dashboard
              </h3>
            </div>
            <span className="rounded-md border border-lime-300/25 bg-lime-300/10 px-3 py-2 font-mono text-xs font-semibold text-lime-100">
              Target &lt; 30s
            </span>
          </div>

          <JudgeModeButton />
        </div>
      </div>
    </section>
  );
}
