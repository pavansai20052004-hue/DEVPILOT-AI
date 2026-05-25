"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Loader2,
  Radar,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { subscribeToDemoRuns } from "@/lib/demo-mode";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

type RiskLevel = "low" | "medium" | "high" | "critical";

type FailureAnomalyPattern = {
  signal: string;
  occurrences: number;
  historical_occurrences: number;
  confidence: number;
  evidence: string[];
};

type FailurePredictionResponse = {
  message: string;
  prediction: boolean;
  risk_level: RiskLevel;
  confidence: number;
  historical_logs_analyzed: number;
  anomaly_patterns: FailureAnomalyPattern[];
  warning: string;
  recommended_actions: string[];
  predicted_at: string;
};


const samplePreIncidentLogs = `2026-05-24T15:37:12Z api[prod] WARN p95 latency rose to 2140ms after release 9f31c2a
2026-05-24T15:37:43Z api[prod] WARN database connection failed twice in 60s; retrying
2026-05-24T15:38:10Z pod/production/api-7f9d8c6b5d Warning failed liveness probe: HTTP probe failed with statuscode: 500
2026-05-24T15:38:16Z deployment/devpilot-api WARN restart_count=3 while rollout is still progressing
2026-05-24T15:38:51Z github actions backend-ci workflow failed on startup contract check: DATABASE_URL missing`;

const riskClasses: Record<RiskLevel, string> = {
  low: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  medium: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  high: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  critical: "border-red-400/25 bg-red-400/10 text-red-100",
};

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;
}


function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
        <Icon className={`size-4 ${tone}`} aria-hidden="true" />
        {label}
      </div>
      <p className="font-mono text-2xl font-semibold tracking-normal text-white">
        {value}
      </p>
    </div>
  );
}

export function PredictiveFailurePanel() {
  const [currentLogs, setCurrentLogs] = useState(samplePreIncidentLogs);
  const [prediction, setPrediction] = useState<FailurePredictionResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPrediction = useCallback(async (logs: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/failures/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          current_logs: logs,
          lookback_limit: 100,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Failure prediction is unavailable."),
        );
      }

      setPrediction(payload as FailurePredictionResponse);
    } catch (predictionError) {
      setError(
        predictionError instanceof Error
          ? predictionError.message
          : "Could not reach the prediction API.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runPrediction(samplePreIncidentLogs);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [runPrediction]);

  useEffect(
    () =>
      subscribeToDemoRuns((payload) => {
        setCurrentLogs(payload.sample_logs);
        window.setTimeout(() => {
          void runPrediction(payload.sample_logs);
        }, 600);
      }),
    [runPrediction],
  );

  const visiblePatterns = useMemo(
    () => prediction?.anomaly_patterns.slice(0, 4) ?? [],
    [prediction],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runPrediction(currentLogs);
  }

  return (
    <section id="failure-prediction" className="bg-[#07090b] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            Predictive Guard
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Predict failures before they become incidents.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot compares fresh runtime signals with incident memory,
            detects anomaly patterns, and warns before the blast radius grows.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <Metric
              label="History"
              value={`${prediction?.historical_logs_analyzed ?? 0}`}
              icon={Clock3}
              tone="text-cyan-200"
            />
            <Metric
              label="Risk"
              value={prediction?.risk_level ?? "pending"}
              icon={TrendingUp}
              tone="text-amber-200"
            />
            <Metric
              label="Confidence"
              value={prediction ? formatPercent(prediction.confidence) : "0%"}
              icon={BrainCircuit}
              tone="text-lime-200"
            />
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-cyan-200">
                Anomaly Scan
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Historical log pattern match
              </h3>
            </div>
            <span
              className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase ${
                prediction ? riskClasses[prediction.risk_level] : "border-white/10 bg-white/5 text-zinc-300"
              }`}
            >
              {prediction?.risk_level ?? "pending"}
            </span>
          </div>

          <label
            htmlFor="prediction-logs"
            className="mt-5 flex items-center gap-2 text-sm font-semibold text-zinc-100"
          >
            <Radar className="size-4 text-cyan-200" aria-hidden="true" />
            Current Signals
          </label>
          <textarea
            id="prediction-logs"
            value={currentLogs}
            onChange={(event) => {
              setCurrentLogs(event.target.value);
              setPrediction(null);
              setError(null);
            }}
            className="mt-3 min-h-44 w-full resize-y rounded-md border border-white/10 bg-[#07090b] px-4 py-3 font-mono text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
            placeholder="Paste fresh warning signs, logs, metrics, or deploy events..."
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isLoading || !currentLogs.trim()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(103,232,249,0.14)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Radar className="size-4" aria-hidden="true" />
              )}
              Run Prediction
            </button>
            {prediction ? (
              <span className="text-sm text-zinc-500">
                Updated {new Date(prediction.predicted_at).toLocaleTimeString()}
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          {prediction ? (
            <div className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10">
                  {prediction.prediction ? (
                    <AlertCircle className="size-5 text-amber-200" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="size-5 text-emerald-200" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <p className="text-2xl font-semibold text-white">
                    {prediction.message}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-cyan-50/80">
                    {prediction.warning}
                  </p>
                </div>
              </div>

              {visiblePatterns.length ? (
                <div className="mt-5 grid gap-3">
                  {visiblePatterns.map((pattern) => (
                    <article
                      key={pattern.signal}
                      className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="size-4 text-cyan-200" aria-hidden="true" />
                          <p className="font-semibold text-white">{pattern.signal}</p>
                        </div>
                        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-zinc-300">
                          {formatPercent(pattern.confidence)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        {pattern.occurrences} current match(es),{" "}
                        {pattern.historical_occurrences} historical match(es).
                      </p>
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <Activity className="size-4 text-lime-200" aria-hidden="true" />
                  Recommended Actions
                </p>
                <ul className="grid gap-2 text-sm leading-6 text-zinc-300">
                  {prediction.recommended_actions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-lime-200" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
