"use client";

import { FormEvent, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RadioTower,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";

type PilotLeadForm = {
  name: string;
  email: string;
  role: string;
  company: string;
  team_size: string;
  primary_pain: string;
};

const initialForm: PilotLeadForm = {
  name: "",
  email: "",
  role: "DevOps Lead",
  company: "",
  team_size: "10-50 engineers",
  primary_pain: "",
};

const proofPoints = [
  "Live Vercel frontend",
  "Render API with Postgres readiness",
  "CI, E2E, and smoke checks",
  "Pilot lead capture pipeline",
];

export function PilotLeadCapture() {
  const [form, setForm] = useState<PilotLeadForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setNotice(null);
    setError(null);

    try {
      await apiRequest("/pilot/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          source: "landing_page",
          desired_followup: true,
        }),
        errorMessage: "Could not capture pilot interest right now.",
      });
      setNotice("You are on the DevPilot pilot list. We captured your interest.");
      setForm(initialForm);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not capture pilot interest right now.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section
      id="pilot"
      className="scroll-mt-24 border-y border-white/10 bg-[#071014] px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto grid max-w-7xl gap-8 xl:grid-cols-[0.85fr_1.15fr] xl:items-start">
        <div>
          <div className="inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            <RadioTower className="size-3.5" aria-hidden="true" />
            Pilot pipeline
          </div>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
            Capture real buyer interest directly from the live product.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
            DevPilot now has a production lead path: visitors can request pilot
            access, the backend stores the signal, and the monitoring dashboard
            counts it as real user traction.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {proofPoints.map((point) => (
              <div
                key={point}
                className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-zinc-200"
              >
                <CheckCircle2 className="size-4 shrink-0 text-emerald-200" aria-hidden="true" />
                {point}
              </div>
            ))}
          </div>
        </div>

        <form
          onSubmit={submitLead}
          className="rounded-md border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(88,166,255,0.10),rgba(63,185,80,0.08),rgba(255,255,255,0.03))] p-5"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md border border-emerald-300/25 bg-emerald-300/10">
              <Users className="size-5 text-emerald-100" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Request pilot access
              </h3>
              <p className="text-xs text-zinc-400">
                For DevOps, SRE, platform, and engineering teams
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
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
              Work email
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
              Team size
              <select
                className="premium-input h-10 w-full rounded-md px-3 text-sm"
                value={form.team_size}
                onChange={(event) => setForm({ ...form, team_size: event.target.value })}
              >
                <option>1-10 engineers</option>
                <option>10-50 engineers</option>
                <option>50-200 engineers</option>
                <option>200+ engineers</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-zinc-300 md:col-span-2">
              Biggest incident response pain
              <textarea
                className="premium-input min-h-28 w-full rounded-md px-3 py-2 text-sm"
                value={form.primary_pain}
                onChange={(event) =>
                  setForm({ ...form, primary_pain: event.target.value })
                }
                required
                minLength={10}
              />
            </label>
          </div>

          {notice ? (
            <div className="mt-4 rounded-md border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm font-medium text-emerald-100">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 rounded-md border border-red-300/25 bg-red-500/10 p-3 text-sm font-medium text-red-100">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-cyan-300/35 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Request pilot access
          </button>

          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-zinc-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-200" aria-hidden="true" />
            Stored in DevPilot backend telemetry and visible to authenticated operators.
          </p>
        </form>
      </div>
    </section>
  );
}
