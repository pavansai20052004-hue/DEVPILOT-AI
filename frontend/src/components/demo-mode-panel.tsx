"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  FileText,
  GitBranch,
  Loader2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";
import {
  DemoRunPayload,
  publishDemoRun,
  readDemoRunPayload,
  subscribeToDemoRuns,
} from "@/lib/demo-mode";


function isDemoRunPayload(value: unknown): value is DemoRunPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    (value as { mode?: unknown }).mode === "demo"
  );
}


function scrollToDemoPanels() {
  window.setTimeout(() => {
    document
      .getElementById("log-upload")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

export function DemoRunButton({
  variant = "panel",
  onComplete,
}: {
  variant?: "header" | "panel";
  onComplete?: (payload: DemoRunPayload) => void;
}) {
  const { setRole } = useRole();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const isHeader = variant === "header";

  async function runDemo() {
    setIsRunning(true);
    setError(null);
    setLoadedAt(null);

    try {
      const response = await fetch(`${API_BASE_URL}/demo/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Demo mode failed to start."));
      }

      if (!isDemoRunPayload(payload)) {
        throw new Error("Demo mode returned an unexpected response.");
      }

      setRole("admin");
      publishDemoRun(payload);
      onComplete?.(payload);
      setLoadedAt(new Date(payload.ran_at).toLocaleTimeString());
      scrollToDemoPanels();
    } catch (demoError) {
      setError(
        demoError instanceof Error
          ? demoError.message
          : "Could not reach the demo API.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  const buttonClassName = isHeader
    ? "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(190,242,100,0.16)] transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
    : "inline-flex h-12 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(190,242,100,0.16)] transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className={isHeader ? "flex flex-col items-end gap-2" : "grid gap-3"}>
      <button
        type="button"
        onClick={runDemo}
        disabled={isRunning}
        className={buttonClassName}
      >
        {isRunning ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : loadedAt ? (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        {isRunning ? "Loading Demo" : loadedAt ? "Demo Loaded" : "Run Demo"}
      </button>

      {!isHeader && error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}

export function DemoModePanel() {
  const [payload, setPayload] = useState<DemoRunPayload | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPayload(readDemoRunPayload());
    }, 0);
    const unsubscribe = subscribeToDemoRuns(setPayload);

    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const summary = useMemo(() => {
    const unhealthyPods = payload?.cluster_status.unhealthy_pods.length ?? 2;
    const ciFailures = payload?.cicd_failures.length ?? 2;
    const logLines = payload?.sample_logs.split(/\r?\n/).length ?? 17;

    return [
      {
        label: "Kubernetes failures",
        value: unhealthyPods,
        detail: "CrashLoopBackOff and image pull failures",
        icon: Boxes,
        tone: "border-sky-300/25 bg-sky-300/10 text-sky-100",
      },
      {
        label: "CI/CD failures",
        value: ciFailures,
        detail: "Backend tests and release image checks",
        icon: GitBranch,
        tone: "border-amber-300/25 bg-amber-300/10 text-amber-100",
      },
      {
        label: "Sample logs",
        value: logLines,
        detail: "Kubernetes events, CI output, and app logs",
        icon: FileText,
        tone: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
      },
    ];
  }, [payload]);

  return (
    <section id="demo-mode" className="bg-[#07090b] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-lime-200">
            Demo Mode
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Load a full incident in one click.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            The demo preloads Kubernetes failures, CI/CD failures, sample logs,
            generated remediation files, and a simulated recovery run.
          </p>
          <div className="mt-7">
            <DemoRunButton variant="panel" onComplete={setPayload} />
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {summary.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.label}
                  className={`rounded-lg border p-4 ${item.tone}`}
                >
                  <Icon className="mb-4 size-5" aria-hidden="true" />
                  <p className="font-mono text-3xl font-semibold text-white">
                    {item.value}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{item.label}</p>
                  <p className="mt-3 text-xs leading-5 opacity-80">
                    {item.detail}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-[#07090b] p-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border border-lime-300/30 bg-lime-300/10">
                <ShieldCheck className="size-5 text-lime-200" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-white">
                  {payload ? payload.message : "Ready for a judge-friendly dry run."}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {payload
                    ? `${payload.incident_records_created} memory records seeded at ${new Date(
                        payload.ran_at,
                      ).toLocaleString()}.`
                    : "No kubeconfig, OpenAI key, GitHub token, or file upload is needed."}
                </p>
              </div>
            </div>
          </div>

          {payload ? (
            <div className="mt-4 grid gap-3">
              {payload.cicd_failures.map((failure) => (
                <div
                  key={`${failure.workflow}:${failure.job}`}
                  className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-amber-50">
                      {failure.workflow} / {failure.job}
                    </p>
                    <span className="rounded-md border border-amber-200/25 px-2 py-1 font-mono text-xs uppercase text-amber-100">
                      {failure.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-amber-50/80">
                    {failure.failure_summary}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
