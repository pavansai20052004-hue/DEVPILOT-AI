"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  GitBranch,
  Loader2,
  Mail,
  RadioTower,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { devPilotTeamHeaders, useTeam } from "@/components/team-provider";
import { apiRequest } from "@/lib/api-client";

type ProductionComponentState = "operational" | "degraded" | "not_configured";

type ProductionComponentStatus = {
  id: string;
  name: string;
  status: ProductionComponentState;
  detail: string;
};

type ProductionMetric = {
  label: string;
  value: number | string;
  detail: string;
};

type ProductionMonitoringResponse = {
  generated_at: string;
  environment: string;
  storage: string;
  uptime_seconds: number;
  frontend_url: string;
  backend_url: string;
  components: ProductionComponentStatus[];
  metrics: ProductionMetric[];
};

type BetaFeedbackRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  company?: string | null;
  rating: number;
  feedback: string;
  interested_in_pilot: boolean;
  created_at: string;
};

type BetaFeedbackSummary = {
  total_feedback: number;
  average_rating?: number | null;
  interested_pilots: number;
  recent_feedback: BetaFeedbackRecord[];
};

type PilotLeadRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  company?: string | null;
  team_size?: string | null;
  primary_pain: string;
  source: string;
  desired_followup: boolean;
  created_at: string;
  updated_at: string;
};

type PilotLeadSummary = {
  total_leads: number;
  desired_followups: number;
  recent_leads: PilotLeadRecord[];
};

type FeedbackFormState = {
  name: string;
  email: string;
  role: string;
  company: string;
  rating: number;
  feedback: string;
  interested_in_pilot: boolean;
};

const initialFormState: FeedbackFormState = {
  name: "",
  email: "",
  role: "DevOps Lead",
  company: "",
  rating: 5,
  feedback: "",
  interested_in_pilot: true,
};

const pipelineItems = [
  "Backend pytest contracts",
  "Frontend lint and production build",
  "Playwright route verification",
  "High severity npm audit gate",
  "Scheduled live Vercel and Render smoke checks",
];

function statusTone(status: ProductionComponentState) {
  if (status === "operational") {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }

  if (status === "degraded") {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }

  return "border-zinc-500/25 bg-white/[0.04] text-zinc-300";
}

function StatusIcon({ status }: { status: ProductionComponentState }) {
  if (status === "operational") {
    return <CheckCircle2 className="size-4" aria-hidden="true" />;
  }

  if (status === "degraded") {
    return <AlertTriangle className="size-4" aria-hidden="true" />;
  }

  return <XCircle className="size-4" aria-hidden="true" />;
}

function formatUptime(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(0, minutes)}m`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export function ProductionMonitoringPanel() {
  const { teamId } = useTeam();
  const [status, setStatus] = useState<ProductionMonitoringResponse | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<BetaFeedbackSummary | null>(null);
  const [leadSummary, setLeadSummary] = useState<PilotLeadSummary | null>(null);
  const [form, setForm] = useState<FeedbackFormState>(initialFormState);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMonitoring = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = devPilotTeamHeaders(teamId);
      const [statusPayload, feedbackPayload, leadPayload] = await Promise.all([
        apiRequest<ProductionMonitoringResponse>("/monitoring/status", {
          cache: "no-store",
          headers,
          retries: 1,
          errorMessage: "Production monitoring status is unavailable.",
        }),
        apiRequest<BetaFeedbackSummary>("/beta/feedback", {
          cache: "no-store",
          headers,
          retries: 1,
          errorMessage: "Beta feedback is unavailable.",
        }),
        apiRequest<PilotLeadSummary>("/pilot/leads/summary", {
          cache: "no-store",
          headers,
          retries: 1,
          errorMessage: "Pilot leads are unavailable.",
        }),
      ]);

      setStatus(statusPayload);
      setFeedbackSummary(feedbackPayload);
      setLeadSummary(leadPayload);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load production monitoring.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadMonitoring();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadMonitoring]);

  const operationalCount = useMemo(() => {
    return status?.components.filter((component) => component.status === "operational").length ?? 0;
  }, [status]);

  const readinessPercent = useMemo(() => {
    if (!status?.components.length) {
      return 0;
    }

    return Math.round((operationalCount / status.components.length) * 100);
  }, [operationalCount, status]);

  const pilotLeadCount = useMemo(() => {
    const metric = status?.metrics.find((item) => item.label === "Pilot leads");
    return leadSummary?.total_leads ?? metric?.value ?? 0;
  }, [leadSummary, status]);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setNotice(null);
    setError(null);

    try {
      await apiRequest("/beta/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotTeamHeaders(teamId),
        },
        body: JSON.stringify(form),
        errorMessage: "Could not save beta feedback.",
      });
      setNotice("Feedback captured. This user signal is now part of the product pipeline.");
      setForm(initialFormState);
      await loadMonitoring();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not save beta feedback.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading && !status) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center rounded-md border border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-3 text-sm font-semibold text-zinc-300">
          <Loader2 className="size-5 animate-spin text-cyan-200" aria-hidden="true" />
          Loading production telemetry
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-md border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(88,166,255,0.12),rgba(63,185,80,0.08),rgba(255,255,255,0.03))] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                <RadioTower className="size-3.5" aria-hidden="true" />
                Live readiness
              </div>
              <h2 className="mt-4 text-2xl font-semibold text-white">
                Production control health
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                DevPilot is tracking deploy health, connected services, user feedback, and release gates from the same place operators already work.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadMonitoring()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold text-zinc-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              Refresh status
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Readiness
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {readinessPercent}%
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {operationalCount} of {status?.components.length ?? 0} systems operational
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Uptime
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {formatUptime(status?.uptime_seconds ?? 0)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                API process runtime
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Storage
              </p>
              <p className="mt-2 text-3xl font-semibold capitalize text-white">
                {status?.storage ?? "unknown"}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {status?.environment ?? "development"} environment
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/25 p-4">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Pilot leads
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {pilotLeadCount}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {feedbackSummary?.total_feedback ?? 0} beta feedback records
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-emerald-300/20 bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-emerald-300/25 bg-emerald-300/10">
              <Rocket className="size-5 text-emerald-100" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                CI/CD release gate
              </h2>
              <p className="text-xs text-zinc-400">
                Verified on GitHub Actions
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {pipelineItems.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200"
              >
                <CheckCircle2 className="size-4 shrink-0 text-emerald-200" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {error ? (
        <div className="rounded-md border border-red-300/25 bg-red-500/10 p-4 text-sm font-medium text-red-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm font-medium text-emerald-100">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        {status?.components.map((component) => (
          <article
            key={component.id}
            className="rounded-md border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-300/25"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">{component.name}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{component.detail}</p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${statusTone(component.status)}`}
              >
                <StatusIcon status={component.status} />
                {component.status.replace("_", " ")}
              </span>
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10">
              <Activity className="size-5 text-cyan-100" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Product metrics
              </h2>
              <p className="text-xs text-zinc-400">
                Last refreshed {status ? formatDate(status.generated_at) : "now"}
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {status?.metrics.map((metric) => (
              <div
                key={metric.label}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 p-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">{metric.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">{metric.detail}</p>
                </div>
                <span className="font-mono text-xl font-semibold text-cyan-100">
                  {metric.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-emerald-300/25 bg-emerald-300/10">
              <Users className="size-5 text-emerald-100" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Real user feedback
              </h2>
              <p className="text-xs text-zinc-400">
                Average rating {feedbackSummary?.average_rating ?? "N/A"}
              </p>
            </div>
          </div>

          <form onSubmit={submitFeedback} className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-zinc-300">
              Name
              <input
                className="premium-input h-10 w-full rounded-md px-3 text-sm"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                minLength={2}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-zinc-300">
              Email
              <input
                className="premium-input h-10 w-full rounded-md px-3 text-sm"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-zinc-300">
              Role
              <input
                className="premium-input h-10 w-full rounded-md px-3 text-sm"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
                required
                minLength={2}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-zinc-300">
              Company
              <input
                className="premium-input h-10 w-full rounded-md px-3 text-sm"
                value={form.company}
                onChange={(event) => setForm({ ...form, company: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-zinc-300 md:col-span-2">
              Feedback
              <textarea
                className="premium-input min-h-28 w-full rounded-md px-3 py-2 text-sm"
                value={form.feedback}
                onChange={(event) => setForm({ ...form, feedback: event.target.value })}
                required
                minLength={10}
              />
            </label>
            <div className="rounded-md border border-white/10 bg-black/20 p-3 md:col-span-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-3 text-sm font-medium text-zinc-300">
                  <input
                    type="checkbox"
                    className="size-4 accent-emerald-400"
                    checked={form.interested_in_pilot}
                    onChange={(event) =>
                      setForm({ ...form, interested_in_pilot: event.target.checked })
                    }
                  />
                  Interested in pilot program
                </label>
                <label className="flex min-w-56 items-center gap-3 text-sm font-medium text-zinc-300">
                  Rating
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={form.rating}
                    onChange={(event) =>
                      setForm({ ...form, rating: Number(event.target.value) })
                    }
                    className="min-w-0 flex-1 accent-cyan-300"
                  />
                  <span className="font-mono text-cyan-100">{form.rating}/5</span>
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-emerald-300/35 bg-emerald-300/10 px-4 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-300/20 md:col-span-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Save feedback
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-md border border-cyan-300/20 bg-white/[0.03] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10">
              <Building2 className="size-5 text-cyan-100" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Pilot lead inbox
              </h2>
              <p className="text-xs text-zinc-400">
                {leadSummary?.desired_followups ?? 0} requested follow-up from the public landing page
              </p>
            </div>
          </div>
          <span className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-semibold text-emerald-100">
            <Users className="size-3.5" aria-hidden="true" />
            {leadSummary?.total_leads ?? 0} total leads
          </span>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {leadSummary?.recent_leads.length ? (
            leadSummary.recent_leads.map((lead) => (
              <article
                key={lead.id}
                className="rounded-md border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{lead.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {lead.role}
                      {lead.company ? ` at ${lead.company}` : ""}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${
                      lead.desired_followup
                        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                        : "border-zinc-500/25 bg-white/[0.04] text-zinc-300"
                    }`}
                  >
                    <RadioTower className="size-3.5" aria-hidden="true" />
                    {lead.desired_followup ? "follow up" : "captured"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                  <a
                    href={`mailto:${lead.email}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-medium text-cyan-100 transition hover:border-cyan-300/30"
                  >
                    <Mail className="size-3.5" aria-hidden="true" />
                    {lead.email}
                  </a>
                  {lead.team_size ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">
                      <Users className="size-3.5" aria-hidden="true" />
                      {lead.team_size}
                    </span>
                  ) : null}
                </div>

                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {lead.primary_pain}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <span>Source: {lead.source.replaceAll("_", " ")}</span>
                  <span>{formatDate(lead.updated_at)}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-white/15 bg-black/20 p-6 text-sm text-zinc-400 lg:col-span-2">
              No pilot leads yet. The public landing form will populate this inbox.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md border border-violet-300/25 bg-violet-300/10">
            <ShieldCheck className="size-5 text-violet-100" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              Recent beta signals
            </h2>
            <p className="text-xs text-zinc-400">
              Evidence from real users and sales conversations
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {feedbackSummary?.recent_feedback.length ? (
            feedbackSummary.recent_feedback.map((feedback) => (
              <article
                key={feedback.id}
                className="rounded-md border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{feedback.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {feedback.role}
                      {feedback.company ? ` at ${feedback.company}` : ""}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                    <GitBranch className="size-3.5" aria-hidden="true" />
                    {feedback.rating}/5
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {feedback.feedback}
                </p>
                <p className="mt-3 text-xs text-zinc-500">
                  {formatDate(feedback.created_at)}
                </p>
              </article>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-white/15 bg-black/20 p-6 text-sm text-zinc-400 lg:col-span-2">
              No beta feedback yet. Add the first sales or customer conversation signal above.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
