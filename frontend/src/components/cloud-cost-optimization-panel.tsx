"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cloud,
  DollarSign,
  HardDrive,
  Loader2,
  Server,
  TrendingDown,
} from "lucide-react";

type CloudProvider = "aws" | "azure" | "gcp";
type CostAction =
  | "delete_idle"
  | "stop_or_schedule"
  | "rightsize_instance"
  | "archive_storage";

type CostRecommendation = {
  id: string;
  resource_id: string;
  resource_name: string;
  cloud_provider: CloudProvider;
  service: string;
  region: string;
  action: CostAction;
  current_size?: string | null;
  recommended_size?: string | null;
  current_monthly_cost: number;
  recommended_monthly_cost: number;
  estimated_monthly_savings: number;
  confidence: number;
  reason: string;
};

type CostOptimizationResponse = {
  message: string;
  currency: string;
  analyzed_resource_count: number;
  recommendation_count: number;
  idle_resource_count: number;
  rightsizing_count: number;
  current_monthly_cost: number;
  optimized_monthly_cost: number;
  estimated_monthly_savings: number;
  estimated_annual_savings: number;
  recommendations: CostRecommendation[];
  generated_at: string;
};


const demoCostOptimization: CostOptimizationResponse = {
  message: "Estimated USD 209.16/month in cloud savings.",
  currency: "USD",
  analyzed_resource_count: 7,
  recommendation_count: 6,
  idle_resource_count: 4,
  rightsizing_count: 2,
  current_monthly_cost: 303.48,
  optimized_monthly_cost: 94.32,
  estimated_monthly_savings: 209.16,
  estimated_annual_savings: 2509.92,
  generated_at: new Date().toISOString(),
  recommendations: [
    {
      id: "idle:aws-ec2-staging-worker",
      resource_id: "aws-ec2-staging-worker",
      resource_name: "staging-worker-batch",
      cloud_provider: "aws",
      service: "ec2",
      region: "us-east-1",
      action: "stop_or_schedule",
      current_size: "t3.large",
      current_monthly_cost: 60.74,
      recommended_monthly_cost: 0,
      estimated_monthly_savings: 60.74,
      confidence: 0.88,
      reason: "No meaningful activity was detected for about 9 day(s).",
    },
    {
      id: "idle:aws-rds-dev-reports",
      resource_id: "aws-rds-dev-reports",
      resource_name: "dev-reporting-db",
      cloud_provider: "aws",
      service: "rds",
      region: "us-east-1",
      action: "stop_or_schedule",
      current_size: "db.t3.medium",
      current_monthly_cost: 58.4,
      recommended_monthly_cost: 8.76,
      estimated_monthly_savings: 49.64,
      confidence: 0.88,
      reason: "No meaningful activity was detected for about 8 day(s).",
    },
    {
      id: "rightsize:aws-ec2-prod-api-1",
      resource_id: "aws-ec2-prod-api-1",
      resource_name: "prod-api-primary",
      cloud_provider: "aws",
      service: "ec2",
      region: "us-east-1",
      action: "rightsize_instance",
      current_size: "m5.large",
      recommended_size: "t3.medium",
      current_monthly_cost: 70.08,
      recommended_monthly_cost: 30.37,
      estimated_monthly_savings: 39.71,
      confidence: 0.82,
      reason: "CPU averages 8% and memory averages 34%, so m5.large can likely move to t3.medium with capacity headroom.",
    },
    {
      id: "rightsize:aws-cache-session",
      resource_id: "aws-cache-session",
      resource_name: "session-cache",
      cloud_provider: "aws",
      service: "redis",
      region: "us-east-1",
      action: "rightsize_instance",
      current_size: "cache.t3.medium",
      recommended_size: "cache.t3.small",
      current_monthly_cost: 49.64,
      recommended_monthly_cost: 24.82,
      estimated_monthly_savings: 24.82,
      confidence: 0.82,
      reason: "CPU averages 18% and memory averages 41%, so cache.t3.medium can likely move to cache.t3.small with capacity headroom.",
    },
    {
      id: "idle:aws-alb-preview",
      resource_id: "aws-alb-preview",
      resource_name: "preview-alb-unused",
      cloud_provider: "aws",
      service: "load_balancer",
      region: "us-east-1",
      action: "stop_or_schedule",
      current_monthly_cost: 18.25,
      recommended_monthly_cost: 0,
      estimated_monthly_savings: 18.25,
      confidence: 0.88,
      reason: "No meaningful activity was detected for about 7 day(s).",
    },
    {
      id: "idle:aws-ebs-orphaned-volume",
      resource_id: "aws-ebs-orphaned-volume",
      resource_name: "checkout-old-root-volume",
      cloud_provider: "aws",
      service: "volume",
      region: "us-east-1",
      action: "delete_idle",
      current_monthly_cost: 16,
      recommended_monthly_cost: 0,
      estimated_monthly_savings: 16,
      confidence: 0.88,
      reason: "Resource is detached, so it can be removed after snapshot or backup validation.",
    },
  ],
};

const actionLabels: Record<CostAction, string> = {
  delete_idle: "Delete idle",
  stop_or_schedule: "Stop or schedule",
  rightsize_instance: "Right-size",
  archive_storage: "Archive storage",
};

const actionClasses: Record<CostAction, string> = {
  delete_idle: "border-rose-300/25 bg-rose-300/10 text-rose-100",
  stop_or_schedule: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  rightsize_instance: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  archive_storage: "border-lime-300/25 bg-lime-300/10 text-lime-100",
};

function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

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

export function CloudCostOptimizationPanel() {
  const [optimization, setOptimization] = useState<CostOptimizationResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingDemoData, setUsingDemoData] = useState(false);

  const loadOptimization = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/cost/optimize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          cloud_provider: "aws",
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Cloud cost optimization is unavailable."),
        );
      }

      setOptimization(payload as CostOptimizationResponse);
      setUsingDemoData(false);
    } catch {
      setOptimization({
        ...demoCostOptimization,
        generated_at: new Date().toISOString(),
      });
      setUsingDemoData(true);
      setError("Using demo cost estimates until the cloud cost API is reachable.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadOptimization();
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [loadOptimization]);

  const topRecommendations = useMemo(
    () => optimization?.recommendations.slice(0, 6) ?? [],
    [optimization],
  );
  const currency = optimization?.currency ?? "USD";
  const updatedAt = optimization
    ? new Date(optimization.generated_at).toLocaleTimeString()
    : "pending";

  return (
    <section className="mt-8 grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
      <div className="rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase text-lime-200">
              Cost Optimization
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-white">
              Cloud savings
            </h2>
          </div>
          <div className="grid size-11 shrink-0 place-items-center rounded-md border border-lime-300/30 bg-lime-300/10">
            <DollarSign className="size-5 text-lime-200" aria-hidden="true" />
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-zinc-400">
          Idle resources and oversized instances are analyzed against utilization,
          activity, and estimated monthly spend.
        </p>

        <div className="mt-6 rounded-lg border border-lime-300/20 bg-lime-300/10 p-4">
          <p className="text-sm font-medium text-lime-100">Estimated monthly savings</p>
          <p className="mt-2 font-mono text-5xl font-semibold tracking-normal text-white">
            {formatCurrency(optimization?.estimated_monthly_savings ?? 0, currency)}
          </p>
          <p className="mt-2 text-sm text-lime-100/75">
            {formatCurrency(optimization?.estimated_annual_savings ?? 0, currency)} annualized
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Metric
            label="Idle resources"
            value={`${optimization?.idle_resource_count ?? 0}`}
            icon={HardDrive}
            tone="text-amber-200"
          />
          <Metric
            label="Cheaper sizes"
            value={`${optimization?.rightsizing_count ?? 0}`}
            icon={Server}
            tone="text-cyan-200"
          />
          <Metric
            label="Current spend"
            value={formatCurrency(optimization?.current_monthly_cost ?? 0, currency)}
            icon={Cloud}
            tone="text-sky-200"
          />
          <Metric
            label="Optimized spend"
            value={formatCurrency(optimization?.optimized_monthly_cost ?? 0, currency)}
            icon={TrendingDown}
            tone="text-lime-200"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void loadOptimization();
            }}
            disabled={isLoading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(190,242,100,0.12)] transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <DollarSign className="size-4" aria-hidden="true" />
            )}
            Refresh Savings
          </button>
          <span className="text-sm text-zinc-500">
            {isLoading
              ? "Analyzing inventory"
              : usingDemoData
                ? "Demo estimate"
                : `Updated ${updatedAt}`}
          </span>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase text-cyan-200">
              Recommendations
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Idle cleanup and right-sizing
            </h2>
          </div>
          <span className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase text-zinc-300">
            {optimization?.recommendation_count ?? 0} actions
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {topRecommendations.length ? (
            topRecommendations.map((recommendation) => (
              <article
                key={recommendation.id}
                className="rounded-lg border border-white/10 bg-[#07090b] p-4"
              >
                <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-semibold text-white">
                        {recommendation.resource_name}
                      </p>
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${actionClasses[recommendation.action]}`}
                      >
                        {actionLabels[recommendation.action]}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-zinc-500">
                      {recommendation.cloud_provider.toUpperCase()} / {recommendation.region} /{" "}
                      {recommendation.service}
                    </p>
                  </div>
                  <div className="md:text-right">
                    <p className="font-mono text-2xl font-semibold text-lime-100">
                      {formatCurrency(recommendation.estimated_monthly_savings, currency)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">saved monthly</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <p className="text-sm leading-6 text-zinc-400">
                    {recommendation.reason}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-zinc-300">
                      {formatCurrency(recommendation.current_monthly_cost, currency)}
                    </span>
                    <TrendingDown className="size-4 text-lime-200" aria-hidden="true" />
                    <span className="rounded-md border border-lime-300/25 bg-lime-300/10 px-2 py-1 font-mono text-xs text-lime-100">
                      {formatCurrency(recommendation.recommended_monthly_cost, currency)}
                    </span>
                  </div>
                </div>

                {recommendation.current_size && recommendation.recommended_size ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <CheckCircle2 className="size-4 text-cyan-200" aria-hidden="true" />
                    <span>
                      {recommendation.current_size} to {recommendation.recommended_size}
                    </span>
                    <span className="text-zinc-700">/</span>
                    <span>{formatPercent(recommendation.confidence)} confidence</span>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
              No idle resources or cheaper instance sizes were found in the current inventory.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
