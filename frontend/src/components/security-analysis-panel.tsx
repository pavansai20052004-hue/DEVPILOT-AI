"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  FileWarning,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

type SecuritySeverity = "low" | "medium" | "high" | "critical";
type SecurityCategory = "secret" | "dockerfile" | "yaml" | "configuration";

type SecurityIssue = {
  id: string;
  title: string;
  severity: SecuritySeverity;
  category: SecurityCategory;
  target_path: string;
  line_number?: number | null;
  evidence: string;
  recommendation: string;
};

type SecurityAnalysisResponse = {
  message: string;
  target_count: number;
  issue_count: number;
  secret_count: number;
  dockerfile_issue_count: number;
  yaml_issue_count: number;
  highest_severity?: SecuritySeverity | null;
  issues: SecurityIssue[];
  suggested_fixes: string[];
  generated_at: string;
};


const demoSecurityReport: SecurityAnalysisResponse = {
  message: "Security analysis found 19 issue(s).",
  target_count: 3,
  issue_count: 19,
  secret_count: 5,
  dockerfile_issue_count: 5,
  yaml_issue_count: 7,
  highest_severity: "critical",
  generated_at: new Date().toISOString(),
  suggested_fixes: [
    "Move the value into a secrets manager or runtime secret reference, then rotate the exposed credential.",
    "Remove privileged mode and grant only the specific Linux capabilities required.",
    "Create a dedicated application user and set USER before CMD.",
    "Pin images to immutable tags or digests.",
  ],
  issues: [
    {
      id: "secret:Dockerfile:4:admin_password",
      title: "Possible hard-coded secret",
      severity: "critical",
      category: "secret",
      target_path: "Dockerfile",
      line_number: 4,
      evidence: "ENV ADMIN_PASSWORD=***",
      recommendation:
        "Move the value into a secrets manager or runtime secret reference, then rotate the exposed credential.",
    },
    {
      id: "yaml:privileged:k8s/devpilot-api.yaml:13",
      title: "Kubernetes container runs privileged",
      severity: "critical",
      category: "yaml",
      target_path: "k8s/devpilot-api.yaml",
      line_number: 13,
      evidence: "privileged: true",
      recommendation:
        "Remove privileged mode and grant only the specific Linux capabilities required.",
    },
    {
      id: "secret-yaml-value:k8s/devpilot-api.yaml:18",
      title: "Kubernetes environment variable contains a literal secret",
      severity: "critical",
      category: "secret",
      target_path: "k8s/devpilot-api.yaml",
      line_number: 18,
      evidence: "name: DATABASE_PASSWORD value: ***",
      recommendation:
        "Replace the literal value with valueFrom.secretKeyRef or an external secret controller reference.",
    },
    {
      id: "docker-missing-user:Dockerfile",
      title: "Dockerfile does not switch to a non-root user",
      severity: "high",
      category: "dockerfile",
      target_path: "Dockerfile",
      evidence: "No USER instruction found.",
      recommendation: "Create a dedicated application user and set USER before CMD.",
    },
    {
      id: "yaml:hostnetwork:k8s/devpilot-api.yaml:8",
      title: "Kubernetes workload uses host networking",
      severity: "high",
      category: "yaml",
      target_path: "k8s/devpilot-api.yaml",
      line_number: 8,
      evidence: "hostNetwork: true",
      recommendation:
        "Disable hostNetwork unless there is a documented node-level requirement.",
    },
  ],
};

const severityClasses: Record<SecuritySeverity, string> = {
  low: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  medium: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  high: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  critical: "border-red-400/25 bg-red-400/10 text-red-100",
};

const categoryLabels: Record<SecurityCategory, string> = {
  secret: "Secret",
  dockerfile: "Dockerfile",
  yaml: "YAML",
  configuration: "Config",
};


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

export function SecurityAnalysisPanel() {
  const [report, setReport] = useState<SecurityAnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSecurityReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/security/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({}),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Security analysis is unavailable."));
      }

      setReport(payload as SecurityAnalysisResponse);
      setUsingDemoData(false);
    } catch {
      setReport({
        ...demoSecurityReport,
        generated_at: new Date().toISOString(),
      });
      setUsingDemoData(true);
      setError("Using demo security findings until the security analysis API is reachable.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadSecurityReport();
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [loadSecurityReport]);

  const visibleIssues = useMemo(() => report?.issues.slice(0, 6) ?? [], [report]);
  const generatedAt = report
    ? new Date(report.generated_at).toLocaleTimeString()
    : "pending";

  return (
    <section className="mt-8 grid gap-5 xl:grid-cols-[0.82fr_1.18fr]">
      <div className="rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase text-red-200">
              Security Analysis
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-white">
              Security report
            </h2>
          </div>
          <div className="grid size-11 shrink-0 place-items-center rounded-md border border-red-300/30 bg-red-300/10">
            <ShieldAlert className="size-5 text-red-200" aria-hidden="true" />
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-zinc-400">
          Configs are checked for secret exposure, insecure Kubernetes YAML, and
          Dockerfile risks before deployment.
        </p>

        <div className="mt-6 rounded-lg border border-red-300/20 bg-red-300/10 p-4">
          <p className="text-sm font-medium text-red-100">Issues found</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <p className="font-mono text-5xl font-semibold tracking-normal text-white">
              {report?.issue_count ?? 0}
            </p>
            <span
              className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase ${
                report?.highest_severity
                  ? severityClasses[report.highest_severity]
                  : "border-white/10 bg-white/5 text-zinc-300"
              }`}
            >
              {report?.highest_severity ?? "clean"}
            </span>
          </div>
          <p className="mt-2 text-sm text-red-100/75">
            {report?.message ?? "Security report pending."}
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Metric
            label="Secrets"
            value={`${report?.secret_count ?? 0}`}
            icon={KeyRound}
            tone="text-red-200"
          />
          <Metric
            label="YAML risks"
            value={`${report?.yaml_issue_count ?? 0}`}
            icon={AlertTriangle}
            tone="text-amber-200"
          />
          <Metric
            label="Dockerfile"
            value={`${report?.dockerfile_issue_count ?? 0}`}
            icon={FileWarning}
            tone="text-cyan-200"
          />
          <Metric
            label="Targets"
            value={`${report?.target_count ?? 0}`}
            icon={ShieldCheck}
            tone="text-lime-200"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void loadSecurityReport();
            }}
            disabled={isLoading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-red-300/40 bg-red-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(252,165,165,0.12)] transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-4" aria-hidden="true" />
            )}
            Refresh Report
          </button>
          <span className="text-sm text-zinc-500">
            {isLoading
              ? "Scanning configs"
              : usingDemoData
                ? "Demo report"
                : `Updated ${generatedAt}`}
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
            <p className="text-sm font-semibold uppercase text-amber-200">
              Findings
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Security issues and fixes
            </h2>
          </div>
          <span className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase text-zinc-300">
            {report?.issue_count ?? 0} findings
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {visibleIssues.length ? (
            visibleIssues.map((issue) => (
              <article
                key={issue.id}
                className="rounded-lg border border-white/10 bg-[#07090b] p-4"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-semibold text-white">
                        {issue.title}
                      </p>
                      <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold uppercase text-zinc-300">
                        {categoryLabels[issue.category]}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-xs text-zinc-500">
                      {issue.target_path}
                      {issue.line_number ? `:${issue.line_number}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${severityClasses[issue.severity]}`}
                  >
                    {issue.severity}
                  </span>
                </div>

                <pre className="mt-4 overflow-auto rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs leading-5 text-zinc-300">
                  {issue.evidence}
                </pre>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {issue.recommendation}
                </p>
              </article>
            ))
          ) : (
            <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
              No secrets, insecure YAML settings, or Dockerfile issues were detected.
            </div>
          )}
        </div>

        {report?.suggested_fixes.length ? (
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ShieldCheck className="size-4 text-lime-200" aria-hidden="true" />
              Suggested Fixes
            </p>
            <ul className="grid gap-2 text-sm leading-6 text-zinc-300">
              {report.suggested_fixes.slice(0, 4).map((fix) => (
                <li key={fix} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-lime-200" />
                  <span>{fix}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
