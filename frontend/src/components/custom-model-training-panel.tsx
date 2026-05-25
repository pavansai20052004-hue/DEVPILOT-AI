"use client";

import { useState } from "react";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";


type SourceBreakdown = {
  kubernetes: number;
  ci_cd: number;
  cloud_logs: number;
};

type ModelEvaluationSummary = {
  model_name: string;
  accuracy: number;
  average_score: number;
  root_cause_score: number;
  remediation_score: number;
  severity_score: number;
};

type ModelEvaluationCase = {
  id: string;
  source_type: keyof SourceBreakdown;
  expected_root_cause: string;
  expected_fix: string;
  custom_root_cause: string;
  generic_root_cause: string;
  custom_score: number;
  generic_score: number;
  winner: "custom" | "generic" | "tie";
};

type CustomModelEvaluation = {
  evaluated_at: string;
  pass_threshold: number;
  passed: boolean;
  improvement: number;
  custom_model: ModelEvaluationSummary;
  generic_baseline: ModelEvaluationSummary;
  cases: ModelEvaluationCase[];
};

type CustomModelTrainingResponse = {
  message: string;
  status: "trained" | "needs_more_data";
  model_name: string;
  base_model: string;
  training_examples: number;
  validation_examples: number;
  source_breakdown: SourceBreakdown;
  ready_for_fine_tuning: boolean;
  jsonl_preview: string[];
  evaluation: CustomModelEvaluation;
  trained_at: string;
};

const sourceLabels: Record<keyof SourceBreakdown, string> = {
  kubernetes: "Kubernetes",
  ci_cd: "CI/CD",
  cloud_logs: "Cloud logs",
};

const sourceTones: Record<keyof SourceBreakdown, string> = {
  kubernetes: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
  ci_cd: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  cloud_logs: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
};

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;
}

function formatPointDelta(value: number) {
  const points = Math.round(value * 100);
  return `${points >= 0 ? "+" : ""}${points} pts`;
}


function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{detail}</p>
    </div>
  );
}

export function CustomModelTrainingPanel() {
  const [result, setResult] = useState<CustomModelTrainingResponse | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trainModel() {
    setIsTraining(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/model/train`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          include_demo_data: true,
          min_examples: 6,
          validation_ratio: 0.3,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Model training failed."));
      }

      setResult(payload as CustomModelTrainingResponse);
    } catch (trainingError) {
      setError(
        trainingError instanceof Error
          ? trainingError.message
          : "Could not reach the model training API.",
      );
    } finally {
      setIsTraining(false);
    }
  }

  const evaluation = result?.evaluation;
  const passed = evaluation?.passed ?? false;

  return (
    <section
      id="custom-model-training"
      className="bg-[#0b0f11] px-5 py-14 sm:px-8 lg:px-10"
    >
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            Custom Model
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Train DevPilot on real incident memory.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot compiles supervised examples from Kubernetes failures,
            CI/CD failures, and cloud runtime logs, then evaluates the custom
            incident model against a generic baseline.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {(Object.keys(sourceLabels) as (keyof SourceBreakdown)[]).map((source) => (
              <div key={source} className={`rounded-lg border p-4 ${sourceTones[source]}`}>
                <p className="text-xs font-semibold uppercase opacity-75">
                  {sourceLabels[source]}
                </p>
                <p className="mt-2 font-mono text-2xl font-semibold">
                  {result?.source_breakdown[source] ?? 0}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
                  <BrainCircuit className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase text-cyan-200">
                    Training Run
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-white">
                    Custom incident model
                  </h3>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-400">
                {result
                  ? result.message
                  : "No training run has been started in this session."}
              </p>
            </div>

            <button
              type="button"
              onClick={trainModel}
              disabled={isTraining}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(103,232,249,0.16)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isTraining ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : result?.status === "trained" ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {isTraining ? "Training" : "Train Model"}
            </button>
          </div>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          {result ? (
            <>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricTile
                  label="Custom score"
                  value={formatPercent(result.evaluation.custom_model.average_score)}
                  detail={result.model_name}
                />
                <MetricTile
                  label="Generic score"
                  value={formatPercent(result.evaluation.generic_baseline.average_score)}
                  detail={result.evaluation.generic_baseline.model_name}
                />
                <MetricTile
                  label="Improvement"
                  value={formatPointDelta(result.evaluation.improvement)}
                  detail={`Target ${formatPointDelta(result.evaluation.pass_threshold)}`}
                />
                <MetricTile
                  label="Dataset"
                  value={`${result.training_examples}/${result.validation_examples}`}
                  detail="Train and validation examples."
                />
              </div>

              <div
                className={`mt-4 flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${
                  passed
                    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-50"
                    : "border-amber-300/25 bg-amber-300/10 text-amber-50"
                }`}
              >
                {passed ? (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <TrendingUp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                )}
                <p>
                  {passed
                    ? "Done condition met: DevPilot beat the generic LLM baseline."
                    : "The model needs more balanced examples before promotion."}
                </p>
              </div>

              <div className="mt-5 divide-y divide-white/10">
                {result.evaluation.cases.slice(0, 3).map((testCase) => (
                  <div key={testCase.id} className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr_auto] sm:items-start">
                    <div>
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${sourceTones[testCase.source_type]}`}>
                        {sourceLabels[testCase.source_type]}
                      </span>
                    </div>
                    <div>
                      <p className="line-clamp-2 text-sm leading-6 text-zinc-200">
                        {testCase.custom_root_cause}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                        Baseline: {testCase.generic_root_cause}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="size-4 text-cyan-200" aria-hidden="true" />
                      <span className="font-mono text-zinc-100">
                        {formatPercent(testCase.custom_score)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
