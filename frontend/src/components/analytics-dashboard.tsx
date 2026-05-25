"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  DollarSign,
  FileText,
  HeartPulse,
  ShieldCheck,
  TimerReset,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { RetryNotice } from "@/components/retry-notice";
import { API_BASE_URL, apiRequest } from "@/lib/api-client";
import { JudgeModeResult, readJudgeModeResult } from "@/lib/demo-mode";

type IncidentMemoryRecord = {
  id: string;
  source: string;
  summary: string;
  severity?: string | null;
  explanation?: string | null;
  recommended_fix?: string | null;
  cloud_provider?: string | null;
  created_at: string;
  updated_at: string;
  has_logs: boolean;
  has_fix: boolean;
  similarity_score?: number | null;
};

type IncidentHistoryResponse = {
  incidents: IncidentMemoryRecord[];
};

type TrendPoint = {
  label: string;
  detected: number;
  healed: number;
};

type SourcePoint = {
  label: string;
  count: number;
  className: string;
};

type DashboardStats = {
  incidentsDetected: number;
  autoHealed: number;
  averageResolutionMinutes: number;
  downtimeSavedMinutes: number;
  autoHealRate: number;
  trend: TrendPoint[];
  sourceBreakdown: SourcePoint[];
  recentIncidents: IncidentMemoryRecord[];
};

type BusinessImpactStats = {
  downtimePreventedMinutes: number;
  moneySaved: number;
  engineerHoursSaved: number;
  slaImprovementPoints: number;
  protectedSla: number;
  autoHealed: number;
};

type IncidentReport = {
  generatedAt: string;
  reportWindow: string;
  summary: string;
  rootCause: string;
  actionsTaken: string[];
  timeSaved: string;
  timeSavedDetail: string;
  metrics: {
    incidentsDetected: string;
    autoHealed: string;
    averageResolution: string;
    autoHealRate: string;
  };
};

const detectedSources = new Set([
  "/api/logs/upload",
  "/analyze-log",
  "/ci-cd/checks",
  "/chaos/inject",
  "/kubernetes/status",
]);

const incidentActionSources = new Set([
  "/auto-heal",
  "/generate-fix",
  "/github/create-pull-request",
]);

const supportingActionSources = new Set([
  "/terraform/apply",
  "/terraform/remediate",
  "/infra/command",
  "/plugins/install",
  "/plugins/uninstall",
]);

const trendSignalSources = new Set([
  ...detectedSources,
  "/failures/predict",
  "/security/analyze",
  "/cost/optimize",
]);

const trendRecoverySources = new Set([
  ...incidentActionSources,
  "/terraform/apply",
  "/terraform/remediate",
]);

const sourceLabels: Record<string, string> = {
  "/api/logs/upload": "Log Intake",
  "/analyze-log": "AI Analysis",
  "/ci-cd/checks": "CI/CD Checks",
  "/chaos/inject": "Chaos Injection",
  "/kubernetes/status": "Cluster Health",
  "/failures/predict": "Failure Prediction",
  "/terraform/remediate": "Terraform Drift",
  "/terraform/apply": "Terraform Patch",
  "/cost/optimize": "Cloud Cost",
  "/security/analyze": "Security Analysis",
  "/auto-heal": "Auto Heal",
  "/generate-fix": "Generated Fix",
  "/github/create-pull-request": "Fix PR",
  "/infra/command": "Infra Command",
  "/plugins/install": "Plugin Install",
  "/plugins/uninstall": "Plugin Remove",
};

const sourceClasses = [
  "bg-emerald-300",
  "bg-amber-200",
  "bg-sky-200",
  "bg-lime-200",
  "bg-cyan-200",
  "bg-rose-200",
];

const manualResponseBaselineMinutes = 45;
const revenueAtRiskPerMinute = 275;
const engineerHourlyCost = 95;
const engineersPerIncident = 2;
const slaWindowMinutes = 30 * 24 * 60;

function buildDemoIncidents(): IncidentMemoryRecord[] {
  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  return [
    {
      id: "demo-8",
      source: "/auto-heal",
      summary: "Auto heal recovered production/api-7f9d8c6b5d-crashloop.",
      recommended_fix: "Infrastructure healed successfully.",
      created_at: minutesAgo(38),
      updated_at: minutesAgo(38),
      has_logs: false,
      has_fix: true,
    },
    {
      id: "demo-7",
      source: "/kubernetes/status",
      summary: "production/api-7f9d8c6b5d-crashloop: Container api is waiting: CrashLoopBackOff",
      severity: "high",
      recommended_fix: "Roll back the deployment and restore the previous runtime configuration.",
      created_at: minutesAgo(47),
      updated_at: minutesAgo(47),
      has_logs: true,
      has_fix: true,
    },
    {
      id: "demo-6",
      source: "/ci-cd/checks",
      summary: "GitHub Actions backend-ci failed because DATABASE_URL is missing.",
      severity: "high",
      recommended_fix: "Restore required production variables before promoting the release image.",
      cloud_provider: "aws",
      created_at: minutesAgo(54),
      updated_at: minutesAgo(54),
      has_logs: true,
      has_fix: true,
    },
    {
      id: "demo-5",
      source: "/generate-fix",
      summary: "API pod has CrashLoopBackOff because DATABASE_URL is missing.",
      cloud_provider: "aws",
      created_at: minutesAgo(58),
      updated_at: minutesAgo(58),
      has_logs: false,
      has_fix: true,
    },
    {
      id: "demo-4",
      source: "/auto-heal",
      summary: "Auto heal recovered production/worker-54b8c9d7c8-timeout.",
      recommended_fix: "Infrastructure healed successfully.",
      created_at: minutesAgo(1_385),
      updated_at: minutesAgo(1_385),
      has_logs: false,
      has_fix: true,
    },
    {
      id: "demo-3",
      source: "/analyze-log",
      summary: "Worker queue latency spiked after Redis connection pool exhaustion.",
      severity: "medium",
      recommended_fix: "Increase Redis pool limits and add queue backpressure.",
      created_at: minutesAgo(1_398),
      updated_at: minutesAgo(1_398),
      has_logs: true,
      has_fix: true,
    },
    {
      id: "demo-2",
      source: "/api/logs/upload",
      summary: "Uploaded log file: checkout-timeouts.txt",
      created_at: minutesAgo(2_860),
      updated_at: minutesAgo(2_860),
      has_logs: true,
      has_fix: false,
    },
    {
      id: "demo-1",
      source: "/auto-heal",
      summary: "Auto heal recovered production/checkout-6d4998f6fd-oom.",
      recommended_fix: "Infrastructure healed successfully.",
      created_at: minutesAgo(4_104),
      updated_at: minutesAgo(4_104),
      has_logs: false,
      has_fix: true,
    },
    {
      id: "demo-0",
      source: "/kubernetes/status",
      summary: "production/checkout-6d4998f6fd-oom: Container checkout restarted 6 times",
      severity: "critical",
      recommended_fix: "Raise memory limits and roll back the checkout release.",
      created_at: minutesAgo(4_128),
      updated_at: minutesAgo(4_128),
      has_logs: true,
      has_fix: true,
    },
  ];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Math.max(Math.round(value), 0));
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "0m";
  }

  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatElapsedMs(value: number) {
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;
}

function dayKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dayLabel(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function recordTime(record: IncidentMemoryRecord) {
  const time = new Date(record.created_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sourceLabel(source: string) {
  return sourceLabels[source] ?? source.replace("/", "").replaceAll("-", " ");
}

function calculateResolutionMinutes(records: IncidentMemoryRecord[]) {
  const detections = records
    .filter((record) => detectedSources.has(record.source))
    .sort((left, right) => recordTime(left) - recordTime(right));
  const heals = records
    .filter((record) => record.source === "/auto-heal")
    .sort((left, right) => recordTime(left) - recordTime(right));
  const usedDetectionIds = new Set<string>();

  return heals
    .map((heal) => {
      const healTime = recordTime(heal);
      const detection = [...detections]
        .reverse()
        .find((record) => {
          const detectionTime = recordTime(record);
          return (
            detectionTime > 0 &&
            detectionTime <= healTime &&
            healTime - detectionTime <= 24 * 60 * 60_000 &&
            !usedDetectionIds.has(record.id)
          );
        });

      if (!detection) {
        return null;
      }

      usedDetectionIds.add(detection.id);
      return Math.max((healTime - recordTime(detection)) / 60_000, 0);
    })
    .filter((minutes): minutes is number => minutes !== null);
}

function buildTrend(records: IncidentMemoryRecord[]) {
  const newestRecordTime = Math.max(0, ...records.map(recordTime));
  const anchor = new Date(newestRecordTime || Date.now());
  anchor.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - (6 - index));
    const key = dayKey(date);

    return {
      label: dayLabel(date),
      detected: records.filter(
        (record) =>
          trendSignalSources.has(record.source) &&
          dayKey(new Date(record.created_at)) === key,
      ).length,
      healed: records.filter(
        (record) =>
          trendRecoverySources.has(record.source) &&
          dayKey(new Date(record.created_at)) === key,
      ).length,
    };
  });
}

function buildSourceBreakdown(records: IncidentMemoryRecord[]) {
  const counts = records.reduce<Record<string, number>>((totals, record) => {
    totals[record.source] = (totals[record.source] ?? 0) + 1;
    return totals;
  }, {});

  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([source, count], index) => ({
      label: sourceLabel(source),
      count,
      className: sourceClasses[index % sourceClasses.length],
    }));
}

function analyzeRecords(records: IncidentMemoryRecord[]): DashboardStats {
  const incidentsDetected = records.filter((record) =>
    detectedSources.has(record.source),
  ).length;
  const autoHealed = records.filter((record) => record.source === "/auto-heal").length;
  const resolutionMinutes = calculateResolutionMinutes(records);
  const averageResolutionMinutes =
    resolutionMinutes.length > 0
      ? resolutionMinutes.reduce((total, minutes) => total + minutes, 0) /
        resolutionMinutes.length
      : 0;
  const estimatedDowntimeSaved =
    autoHealed * manualResponseBaselineMinutes -
    resolutionMinutes.reduce((total, minutes) => total + minutes, 0);

  return {
    incidentsDetected,
    autoHealed,
    averageResolutionMinutes,
    downtimeSavedMinutes: Math.max(Math.round(estimatedDowntimeSaved), 0),
    autoHealRate: incidentsDetected > 0 ? autoHealed / incidentsDetected : 0,
    trend: buildTrend(records),
    sourceBreakdown: buildSourceBreakdown(records),
    recentIncidents: [...records]
      .sort((left, right) => recordTime(right) - recordTime(left))
      .slice(0, 6),
  };
}

function calculateBusinessImpact(stats: DashboardStats): BusinessImpactStats {
  const downtimePreventedMinutes = stats.downtimeSavedMinutes;
  const engineerHoursSaved = (downtimePreventedMinutes / 60) * engineersPerIncident;
  const moneySaved =
    downtimePreventedMinutes * revenueAtRiskPerMinute +
    engineerHoursSaved * engineerHourlyCost;
  const manualDowntimeMinutes = stats.autoHealed * manualResponseBaselineMinutes;
  const remainingDowntimeMinutes = Math.max(
    manualDowntimeMinutes - downtimePreventedMinutes,
    0,
  );
  const baselineSla = 1 - manualDowntimeMinutes / slaWindowMinutes;
  const protectedSla = 1 - remainingDowntimeMinutes / slaWindowMinutes;

  return {
    downtimePreventedMinutes,
    moneySaved,
    engineerHoursSaved,
    slaImprovementPoints: Math.max((protectedSla - baselineSla) * 100, 0),
    protectedSla: Math.max(Math.min(protectedSla, 1), 0),
    autoHealed: stats.autoHealed,
  };
}

function sortedByNewest(records: IncidentMemoryRecord[]) {
  return [...records].sort((left, right) => recordTime(right) - recordTime(left));
}

function reportWindow(records: IncidentMemoryRecord[]) {
  const timestamps = records.map(recordTime).filter((time) => time > 0);

  if (timestamps.length === 0) {
    return "No incident window available";
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
  const oldest = dateFormatter.format(new Date(Math.min(...timestamps)));
  const newest = dateFormatter.format(new Date(Math.max(...timestamps)));

  return oldest === newest ? oldest : `${oldest} - ${newest}`;
}

function buildIncidentReport(
  records: IncidentMemoryRecord[],
  stats: DashboardStats,
  generatedAt: string,
): IncidentReport {
  const newestRecords = sortedByNewest(records);
  const latestIncident =
    newestRecords.find((record) => detectedSources.has(record.source)) ?? newestRecords[0];
  const rootCauseRecord =
    newestRecords.find(
      (record) =>
        detectedSources.has(record.source) &&
        (record.explanation || record.recommended_fix || record.severity),
    ) ?? latestIncident;
  const primaryActionRecords = newestRecords.filter((record) =>
    incidentActionSources.has(record.source),
  );
  const supportingActionRecords = newestRecords.filter((record) =>
    supportingActionSources.has(record.source),
  );
  const actionRecords = [
    ...primaryActionRecords,
    ...supportingActionRecords,
  ].slice(0, 5);
  const actionsTaken =
    actionRecords.length > 0
      ? actionRecords.map((record) => `${sourceLabel(record.source)}: ${record.summary}`)
      : ["No remediation action has been recorded yet."];
  const latestSummary = latestIncident
    ? `Latest signal: ${latestIncident.summary}`
    : "No incident signal is available yet.";
  const detectedSummary =
    stats.incidentsDetected > 0
      ? `DevPilot reviewed ${formatNumber(records.length)} memory records and found ${formatNumber(
          stats.incidentsDetected,
        )} incident signal(s). ${latestSummary}`
      : `DevPilot reviewed ${formatNumber(records.length)} memory records. ${latestSummary}`;

  return {
    generatedAt,
    reportWindow: reportWindow(records),
    summary: detectedSummary,
    rootCause:
      rootCauseRecord?.explanation ??
      rootCauseRecord?.summary ??
      "No root cause has been captured yet.",
    actionsTaken,
    timeSaved: formatDuration(stats.downtimeSavedMinutes),
    timeSavedDetail: `Estimated against a ${manualResponseBaselineMinutes} minute manual response baseline across ${formatNumber(
      stats.autoHealed,
    )} auto-healed incident(s).`,
    metrics: {
      incidentsDetected: formatNumber(stats.incidentsDetected),
      autoHealed: formatNumber(stats.autoHealed),
      averageResolution: formatDuration(stats.averageResolutionMinutes),
      autoHealRate: formatPercent(stats.autoHealRate),
    },
  };
}

async function downloadIncidentReportPdf(report: IncidentReport) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ format: "letter", unit: "pt" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  let y = 54;

  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const wrappedLines = (text: string, width = contentWidth) => {
    const lines = doc.splitTextToSize(text, width);
    return Array.isArray(lines) ? lines : [lines];
  };
  const drawLines = (lines: string[], lineHeight: number) => {
    lines.forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    });
  };
  const addSection = (heading: string, body: string) => {
    ensureSpace(46);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 83, 70);
    doc.text(heading, margin, y);
    y += 20;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(46, 54, 57);
    drawLines(wrappedLines(body), 15);
    y += 12;
  };

  doc.setProperties({
    title: "DevPilot Incident Report",
    subject: "Incident summary, root cause, actions taken, and time saved",
  });
  doc.setFillColor(7, 9, 11);
  doc.rect(0, 0, pageWidth, 112, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("DevPilot Incident Report", margin, y);
  y += 26;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(206, 213, 217);
  doc.text(`Generated ${report.generatedAt} | Window ${report.reportWindow}`, margin, y);
  y = 146;

  const metricWidth = contentWidth / 4;
  const metrics = [
    ["Incidents", report.metrics.incidentsDetected],
    ["Auto-healed", report.metrics.autoHealed],
    ["Avg resolution", report.metrics.averageResolution],
    ["Auto-heal rate", report.metrics.autoHealRate],
  ];

  metrics.forEach(([label, value], index) => {
    const x = margin + index * metricWidth;
    doc.setTextColor(96, 110, 116);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(label.toUpperCase(), x, y);
    doc.setTextColor(7, 9, 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(value, x, y + 24);
  });
  y += 58;

  addSection("Summary", report.summary);
  addSection("Root Cause", report.rootCause);

  ensureSpace(46);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 83, 70);
  doc.text("Actions Taken", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(46, 54, 57);
  report.actionsTaken.forEach((action, index) => {
    drawLines(wrappedLines(`${index + 1}. ${action}`), 15);
    y += 4;
  });
  y += 8;

  addSection("Time Saved", `${report.timeSaved}. ${report.timeSavedDetail}`);

  const generatedDate = new Date().toISOString().slice(0, 10);
  doc.save(`devpilot-incident-report-${generatedDate}.pdf`);
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <article className="devpilot-card p-5 transition hover:border-white/20">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-400">{label}</p>
          <p className="mt-3 break-words font-mono text-3xl font-semibold tracking-normal text-white">
            {value}
          </p>
        </div>
        <div className={`grid size-11 shrink-0 place-items-center rounded-md border ${tone}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-4 min-h-10 text-sm leading-5 text-zinc-400">{detail}</p>
    </article>
  );
}

function BusinessImpactMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <article className="devpilot-card p-5 transition hover:border-white/20">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-400">{label}</p>
          <p className="mt-3 break-words font-mono text-3xl font-semibold tracking-normal text-white">
            {value}
          </p>
        </div>
        <div className={`grid size-11 shrink-0 place-items-center rounded-md border ${tone}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-4 min-h-10 text-sm leading-5 text-zinc-400">{detail}</p>
    </article>
  );
}

function JudgeModeResultBanner({ result }: { result: JudgeModeResult }) {
  const steps = [
    "Sample failure loaded",
    "Diagnosis completed",
    "Fix generated",
    "Auto-heal completed",
    "Dashboard result shown",
  ];

  return (
    <section className="mt-5 rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-5 shadow-2xl shadow-black/20">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
              <CheckCircle2 className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase text-cyan-200">
                Judge Mode Complete
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">
                Full demo completed in {formatElapsedMs(result.elapsed_ms)}
              </h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            {result.incident}
          </p>
        </div>

        <div className="rounded-lg border border-lime-300/25 bg-lime-300/10 px-4 py-3 text-sm text-lime-50">
          {result.incident_records_created} memory records /{" "}
          {result.recovery_actions} recovery actions
        </div>
      </div>

      <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Fix applied
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{result.fix}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Judge pipeline
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {steps.map((step) => (
              <span
                key={step}
                className="inline-flex items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100"
              >
                <CheckCircle2 className="size-3" aria-hidden="true" />
                {step}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function BusinessImpactPanel({
  impact,
  usingDemoData,
}: {
  impact: BusinessImpactStats;
  usingDemoData: boolean;
}) {
  return (
    <section id="business-impact" className="mt-8">
      <div className="mb-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase text-amber-200">
            Business Impact
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            ROI at a glance
          </h2>
        </div>
        <div className="rounded-md border border-white/10 bg-[#0e1315] px-4 py-3 text-sm text-zinc-300">
          {usingDemoData ? "Demo impact model" : "Live impact model"} /{" "}
          {formatNumber(impact.autoHealed)} auto-healed incident(s)
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <BusinessImpactMetric
          label="Downtime prevented"
          value={formatDuration(impact.downtimePreventedMinutes)}
          detail={`${formatNumber(
            impact.downtimePreventedMinutes,
          )} minute(s) of customer impact avoided.`}
          icon={TimerReset}
          tone="border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
        />
        <BusinessImpactMetric
          label="Money saved"
          value={formatMoney(impact.moneySaved)}
          detail="Revenue exposure and engineering time protected."
          icon={DollarSign}
          tone="border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
        />
        <BusinessImpactMetric
          label="Engineer hours saved"
          value={`${impact.engineerHoursSaved.toFixed(1)}h`}
          detail="Estimated response toil removed from on-call work."
          icon={Users}
          tone="border-sky-300/30 bg-sky-300/10 text-sky-200"
        />
        <BusinessImpactMetric
          label="SLA improved"
          value={`+${impact.slaImprovementPoints.toFixed(2)} pts`}
          detail={`Projected protected SLA ${formatPercent(impact.protectedSla)}.`}
          icon={TrendingUp}
          tone="border-amber-300/30 bg-amber-300/10 text-amber-200"
        />
      </div>
    </section>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const width = 760;
  const height = 300;
  const padding = { top: 28, right: 34, bottom: 50, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const chartBottom = height - padding.bottom;
  const maxValue = Math.max(1, ...data.map((point) => Math.max(point.detected, point.healed)));
  const roundedMax = Math.max(4, Math.ceil(maxValue / 2) * 2);
  const bandWidth = data.length > 0 ? chartWidth / data.length : chartWidth;
  const xCenter = (index: number) => padding.left + bandWidth * index + bandWidth / 2;
  const yFor = (value: number) =>
    chartBottom - (value / roundedMax) * chartHeight;
  const pointsFor = (key: "detected" | "healed") =>
    data
      .map((point, index) => `${xCenter(index)},${yFor(point[key])}`)
      .join(" ");
  const totals = data.reduce(
    (summary, point) => ({
      detected: summary.detected + point.detected,
      healed: summary.healed + point.healed,
    }),
    { detected: 0, healed: 0 },
  );

  return (
    <div className="devpilot-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase text-emerald-200">Trend</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Incident velocity</h2>
          <p className="mt-2 text-sm text-zinc-500">
            {totals.detected} signals / {totals.healed} recovery actions over seven days
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-300" />
            Signals
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2 rounded-full bg-lime-200" />
            Actions
          </span>
        </div>
      </div>

      <div className="mt-6 h-80 overflow-hidden rounded-md border border-white/10 bg-[#070a0c] p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Seven day incident trend chart"
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="detected-bar" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.18" />
            </linearGradient>
            <linearGradient id="healed-bar" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#bef264" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#bef264" stopOpacity="0.16" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => {
            const value = Math.round((roundedMax / 4) * (4 - tick));
            const y = padding.top + tick * (chartHeight / 4);
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={padding.left - 12}
                  y={y + 4}
                  fill="#71717a"
                  fontSize="11"
                  fontFamily="var(--font-geist-mono)"
                  textAnchor="end"
                >
                  {value}
                </text>
              </g>
            );
          })}
          {data.map((point, index) => {
            const groupX = padding.left + bandWidth * index;
            const barWidth = Math.max(Math.min(bandWidth * 0.24, 22), 8);
            const detectedHeight =
              point.detected > 0
                ? Math.max(chartBottom - yFor(point.detected), 4)
                : 0;
            const healedHeight =
              point.healed > 0 ? Math.max(chartBottom - yFor(point.healed), 4) : 0;

            return (
              <g key={`${point.label}-bars`}>
                <rect
                  x={groupX + bandWidth * 0.5 - barWidth - 2}
                  y={chartBottom - detectedHeight}
                  width={barWidth}
                  height={detectedHeight}
                  rx="4"
                  fill="url(#detected-bar)"
                />
                <rect
                  x={groupX + bandWidth * 0.5 + 2}
                  y={chartBottom - healedHeight}
                  width={barWidth}
                  height={healedHeight}
                  rx="4"
                  fill="url(#healed-bar)"
                />
              </g>
            );
          })}
          <polyline
            points={pointsFor("detected")}
            fill="none"
            stroke="#6ee7b7"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={pointsFor("healed")}
            fill="none"
            stroke="#bef264"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
            vectorEffect="non-scaling-stroke"
          />
          {data.map((point, index) => {
            const x = xCenter(index);
            return (
              <g key={point.label}>
                <circle
                  cx={x}
                  cy={yFor(point.detected)}
                  r="5"
                  fill="#6ee7b7"
                  stroke="#07100d"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={x}
                  cy={yFor(point.healed)}
                  r="5"
                  fill="#bef264"
                  stroke="#07100d"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={x}
                  y={height - 18}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize="12"
                  fontFamily="var(--font-geist-mono)"
                >
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SourceBreakdownChart({ data }: { data: SourcePoint[] }) {
  const maxValue = Math.max(1, ...data.map((point) => point.count));

  return (
    <div className="devpilot-card p-5">
      <div>
        <p className="text-sm font-semibold uppercase text-cyan-200">Sources</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Signal mix</h2>
      </div>

      <div className="mt-6 grid gap-4">
        {data.map((point) => (
          <div key={point.label}>
            <div className="mb-2 flex items-center justify-between gap-4 text-sm">
              <span className="truncate text-zinc-300">{point.label}</span>
              <span className="font-mono text-zinc-100">{point.count}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className={`h-full rounded-full ${point.className}`}
                style={{ width: `${Math.max((point.count / maxValue) * 100, 8)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutoHealGauge({ rate }: { rate: number }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const boundedRate = Math.max(0, Math.min(rate, 1));
  const dashOffset = circumference * (1 - boundedRate);

  return (
    <div className="devpilot-card p-5">
      <div>
        <p className="text-sm font-semibold uppercase text-lime-200">Recovery</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Auto-heal rate</h2>
      </div>

      <div className="mt-7 flex items-center justify-center">
        <div className="relative size-44">
          <svg viewBox="0 0 160 160" className="size-full -rotate-90">
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="16"
            />
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke="#bef264"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth="16"
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="font-mono text-4xl font-semibold text-white">
                {Math.round(boundedRate * 100)}%
              </p>
              <p className="mt-1 text-xs uppercase text-zinc-500">resolved</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentIncidentList({ incidents }: { incidents: IncidentMemoryRecord[] }) {
  return (
    <div className="devpilot-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase text-amber-200">Memory</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Recent incidents</h2>
        </div>
        <Clock3 className="size-5 text-amber-200" aria-hidden="true" />
      </div>

      <div className="mt-6 divide-y divide-white/10">
        {incidents.map((incident) => (
          <div key={incident.id} className="grid gap-3 py-4 sm:grid-cols-[9.5rem_1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {sourceLabel(incident.source)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {new Date(incident.created_at).toLocaleString()}
              </p>
            </div>
            <p className="line-clamp-2 text-sm leading-6 text-zinc-300">
              {incident.summary}
            </p>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {incident.severity ? (
                <span className="rounded-md border border-rose-300/25 bg-rose-300/10 px-2 py-1 text-xs font-medium uppercase text-rose-100">
                  {incident.severity}
                </span>
              ) : null}
              {incident.has_fix ? (
                <span className="rounded-md border border-lime-300/25 bg-lime-300/10 px-2 py-1 text-xs font-medium text-lime-100">
                  Fix stored
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IncidentReportPanel({
  records,
  stats,
  usingDemoData,
  generatedAt,
}: {
  records: IncidentMemoryRecord[];
  stats: DashboardStats;
  usingDemoData: boolean;
  generatedAt: string | null;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const report = useMemo(
    () => buildIncidentReport(records, stats, generatedAt ?? "pending"),
    [generatedAt, records, stats],
  );

  async function handleDownload() {
    setIsExporting(true);
    setExportError(null);

    try {
      await downloadIncidentReportPdf(report);
    } catch (downloadError) {
      setExportError(
        downloadError instanceof Error
          ? downloadError.message
          : "Could not export incident report.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="devpilot-card mt-5 p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
              <FileText className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase text-cyan-200">
                Report
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">
                Incident report
              </h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-300">{report.summary}</p>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          disabled={isExporting || records.length === 0}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-50 transition hover:border-cyan-200 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="size-4" aria-hidden="true" />
          {isExporting ? "Exporting" : "Download PDF"}
        </button>
      </div>

      <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Root cause</p>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-300">
            {report.rootCause}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Actions taken</p>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-300">
            {report.actionsTaken[0]}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Time saved</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-white">
            {report.timeSaved}
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{report.timeSavedDetail}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-zinc-500">Source</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {usingDemoData ? "Demo analytics" : "Live incident memory"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {report.reportWindow} / generated {report.generatedAt}
          </p>
        </div>
      </div>

      {exportError ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-50">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{exportError}</p>
        </div>
      ) : null}
    </section>
  );
}

export function AnalyticsDashboard() {
  const [records, setRecords] = useState<IncidentMemoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [judgeResult, setJudgeResult] = useState<JudgeModeResult | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await apiRequest<IncidentHistoryResponse>(
        "/incidents/history?limit=100",
        {
          cache: "no-store",
          errorMessage: "Incident history is unavailable.",
          retries: 1,
        },
      );

      if (payload.incidents.length === 0) {
        setRecords(buildDemoIncidents());
        setUsingDemoData(true);
      } else {
        setRecords(payload.incidents);
        setUsingDemoData(false);
      }
      setLastUpdated(new Date().toLocaleString());
    } catch (historyError) {
      setRecords(buildDemoIncidents());
      setUsingDemoData(true);
      setLastUpdated(new Date().toLocaleString());
      setError(
        historyError instanceof Error
          ? historyError.message
          : "Could not load incident history.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHistory();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadHistory]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("judge") === "complete") {
      const timer = window.setTimeout(() => {
        setJudgeResult(readJudgeModeResult());
      }, 0);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, []);

  const stats = useMemo(() => analyzeRecords(records), [records]);
  const businessImpact = useMemo(() => calculateBusinessImpact(stats), [stats]);

  return (
    <div>
      <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-normal text-emerald-200">
            Incident Dashboard
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-white sm:text-5xl">
            Memory, trends, and recovery impact
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
            DevPilot analyzes incident memory, auto-heal runs, and recent
            signals so the team can see what happened and what time was saved.
          </p>
        </div>

        <div className="rounded-md border border-white/10 bg-[#0e1315] px-4 py-3 text-sm text-zinc-300">
          <span className="mr-2 inline-block size-2 rounded-full bg-emerald-300" />
          {isLoading ? "Loading memory" : usingDemoData ? "Demo analytics" : "Live memory"}
        </div>
      </header>

      {error ? (
        <div className="mt-5">
          <RetryNotice
            message={error}
            onRetry={loadHistory}
            retryLabel="Retry dashboard"
            tone="amber"
          />
        </div>
      ) : null}

      {judgeResult ? <JudgeModeResultBanner result={judgeResult} /> : null}

      <BusinessImpactPanel
        impact={businessImpact}
        usingDemoData={usingDemoData}
      />

      <section className="mt-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard
          label="Incidents detected"
          value={formatNumber(stats.incidentsDetected)}
          detail="Signals captured from logs, AI analysis, and cluster health checks."
          icon={Activity}
          tone="border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
        />
        <StatCard
          label="Incidents auto-healed"
          value={formatNumber(stats.autoHealed)}
          detail="Recovery runs completed by the auto-heal flow."
          icon={ShieldCheck}
          tone="border-lime-300/30 bg-lime-300/10 text-lime-200"
        />
        <StatCard
          label="Average resolution"
          value={formatDuration(stats.averageResolutionMinutes)}
          detail="Mean time between the matched incident signal and auto-heal completion."
          icon={TimerReset}
          tone="border-sky-300/30 bg-sky-300/10 text-sky-200"
        />
        <StatCard
          label="Downtime saved"
          value={formatDuration(stats.downtimeSavedMinutes)}
          detail="Estimated time recovered against a 45 minute manual response baseline."
          icon={Zap}
          tone="border-amber-300/30 bg-amber-300/10 text-amber-200"
        />
      </section>

      <IncidentReportPanel
        records={records}
        stats={stats}
        usingDemoData={usingDemoData}
        generatedAt={lastUpdated}
      />

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <TrendChart data={stats.trend} />
        <AutoHealGauge rate={stats.autoHealRate} />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <SourceBreakdownChart data={stats.sourceBreakdown} />
        <RecentIncidentList incidents={stats.recentIncidents} />
      </section>

      <footer className="mt-8 flex flex-wrap items-center gap-3 pb-8 text-sm text-zinc-500">
        <BarChart3 className="size-4 text-cyan-200" aria-hidden="true" />
        <span>{formatNumber(records.length)} memory records analyzed</span>
        <span className="text-zinc-700">/</span>
        <TrendingUp className="size-4 text-emerald-200" aria-hidden="true" />
        <span>Updated {lastUpdated ?? "pending"}</span>
        <span className="text-zinc-700">/</span>
        <HeartPulse className="size-4 text-lime-200" aria-hidden="true" />
        <span>Backend {API_BASE_URL}</span>
      </footer>
    </div>
  );
}
