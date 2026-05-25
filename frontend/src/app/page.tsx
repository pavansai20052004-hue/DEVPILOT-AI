import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  CloudCog,
  Command,
  DollarSign,
  HeartPulse,
  Radar,
  ShieldCheck,
  Terminal,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "DevPilot AI | Investor Landing Page",
  description:
    "Investor-ready landing page for DevPilot AI, the AI DevOps engineer for incident recovery, remediation, and cloud operations ROI.",
};

const navLinks = [
  { href: "#tam", label: "TAM" },
  { href: "#problem", label: "Problem" },
  { href: "#solution", label: "Solution" },
  { href: "#roi", label: "ROI" },
  { href: "#pricing", label: "Pricing" },
];

const heroMetrics = [
  {
    value: "$723B",
    label: "2025 public cloud spend forecast",
  },
  {
    value: "$300K+",
    label: "hourly downtime exposure for many enterprises",
  },
  {
    value: "4-step",
    label: "detect, diagnose, fix, heal loop",
  },
];

const marketSignals = [
  {
    value: "$723B",
    label: "Cloud operations surface",
    detail:
      "Gartner forecasts worldwide public cloud end-user spending at $723.4B in 2025.",
  },
  {
    value: "$487B",
    label: "AI infrastructure pull",
    detail:
      "IDC projects AI infrastructure spending will reach $487B in 2026.",
  },
  {
    value: "79%",
    label: "AI incident adoption signal",
    detail:
      "Atlassian reports most teams are already exploring AI for incident trending.",
  },
];

const problemCards = [
  {
    title: "Incidents are still manual",
    description:
      "Engineers jump between alerts, logs, dashboards, cloud consoles, tickets, and chat while customer impact keeps compounding.",
    icon: Terminal,
    tone: "text-amber-200",
  },
  {
    title: "Runbooks stop at advice",
    description:
      "Most tools explain what might be wrong, but they do not turn diagnosis into reviewed Terraform, Kubernetes, and pull-request actions.",
    icon: BrainCircuit,
    tone: "text-cyan-200",
  },
  {
    title: "Leadership cannot see recovery ROI",
    description:
      "Reliability spend is hard to justify when the team cannot connect incidents, saved engineer hours, avoided downtime, and customer risk.",
    icon: BarChart3,
    tone: "text-emerald-200",
  },
];

const solutionSteps = [
  {
    title: "Detect",
    description: "Listen to logs, CI/CD events, Kubernetes health, drift, cost, and security signals.",
    icon: Radar,
  },
  {
    title: "Diagnose",
    description: "Rank likely root causes with incident memory and explain the active failure.",
    icon: BrainCircuit,
  },
  {
    title: "Fix",
    description: "Generate remediation files, Terraform patches, PRs, and infra commands.",
    icon: Wrench,
  },
  {
    title: "Heal",
    description: "Apply approved recovery actions, verify results, and store the audit trail.",
    icon: ShieldCheck,
  },
];

const roiMetrics = [
  {
    value: "$22.5K",
    label: "monthly engineering time recovered",
    detail: "20 incidents x 45 minutes saved x 5 engineers x $150 blended hourly cost.",
  },
  {
    value: "1 hour",
    label: "prevented downtime can fund a year",
    detail: "A single avoided outage hour can exceed the annual cost of an early team plan.",
  },
  {
    value: "250",
    label: "monthly recovery actions in Pro",
    detail: "Quota aligned to incident response, auto-heal, and remediation workflow usage.",
  },
];

const pricingPlans = [
  {
    name: "Free",
    price: "$0",
    cadence: "/mo",
    description: "For demos, local proof of concept, and early evaluator workflows.",
    features: ["250 API requests", "25 AI actions", "5 recovery actions", "1 team member"],
  },
  {
    name: "Pro",
    price: "$49",
    cadence: "/mo",
    description: "For teams validating incident recovery automation with real usage.",
    features: [
      "10,000 API requests",
      "1,000 AI actions",
      "250 recovery actions",
      "5 team members",
    ],
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    description: "For production SRE teams that need governance, scale, and procurement support.",
    features: ["Custom quotas", "SSO and audit controls", "VPC or private deploy", "Priority support"],
  },
];

const testimonials = [
  {
    quote:
      "DevPilot gives our incident review a missing piece: the proposed fix, the approval trail, and the ROI story in one place.",
    name: "VP Engineering",
    company: "Series A fintech platform",
  },
  {
    quote:
      "The demo clicked because it did not stop at charts. It moved from failure signal to a reviewed recovery action.",
    name: "Platform Lead",
    company: "Cloud-native health tech",
  },
  {
    quote:
      "This is the kind of AI workflow we would trust first: human-approved, infrastructure-aware, and measurable.",
    name: "SRE Manager",
    company: "B2B SaaS infrastructure team",
  },
];

const productHighlights = [
  "Incident memory and analytics",
  "Kubernetes restart and rollback",
  "Terraform remediation",
  "Cloud cost optimization",
  "Security analysis",
  "SaaS billing and usage metering",
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#050708] text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#050708]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="DevPilot AI home">
            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-emerald-300/35 bg-emerald-300/10">
              <CloudCog className="size-5 text-emerald-200" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-sm font-semibold uppercase text-white">
                DevPilot AI
              </span>
              <span className="block truncate text-xs text-zinc-500">
                AI DevOps Engineer
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Investor sections">
            {navLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-semibold text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-100"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Link
            href="/dashboard"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2 focus:ring-offset-[#050708] sm:px-4"
          >
            <Command className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Open Product</span>
            <span className="sm:hidden">Product</span>
          </Link>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <Image
              src="/devpilot-hero.png"
              alt="DevPilot AI observability dashboard preview"
              fill
              priority
              sizes="100vw"
              className="object-cover object-center opacity-45"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,8,0.98)_0%,rgba(5,7,8,0.82)_50%,rgba(5,7,8,0.42)_100%)]" />
          </div>

          <div className="mx-auto flex min-h-[72svh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
            <div className="max-w-4xl">
              <div className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-300/35 bg-emerald-300/10 px-3 py-2 font-mono text-xs font-semibold uppercase text-emerald-100">
                <span className="size-2 rounded-full bg-emerald-300" />
                Investor landing page
              </div>
              <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-none text-white sm:text-6xl lg:text-7xl">
                DevPilot AI
              </h1>
              <p className="mt-5 max-w-3xl text-xl font-semibold leading-tight text-zinc-100 sm:text-2xl lg:text-3xl">
                The AI DevOps engineer that turns incidents into verified recovery actions.
              </p>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                DevPilot connects observability, Kubernetes recovery, Terraform remediation,
                cloud cost, security, and SaaS metering into one AI-assisted operations loop
                for teams that cannot afford slow incident response.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2 focus:ring-offset-[#050708]"
                >
                  <BarChart3 className="size-4" aria-hidden="true" />
                  View Live Dashboard
                </Link>
                <a
                  href="#roi"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.08] px-4 text-sm font-semibold text-zinc-100 transition hover:border-cyan-200/50 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-200 focus:ring-offset-2 focus:ring-offset-[#050708]"
                >
                  See ROI Model
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {heroMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-md border border-white/10 bg-[#090d0f]/80 p-4 backdrop-blur"
                >
                  <p className="font-mono text-2xl font-semibold text-white">{metric.value}</p>
                  <p className="mt-2 text-sm leading-5 text-zinc-400">{metric.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="tam" className="scroll-mt-24 border-y border-white/10 bg-[#07100f] px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
              <div>
                <p className="font-mono text-xs font-semibold uppercase text-cyan-200">TAM</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  A large cloud operations market is being pulled toward AI-native remediation.
                </h2>
              </div>
              <p className="max-w-3xl text-base leading-7 text-zinc-400">
                DevPilot starts with the urgent wedge: every cloud-native team already pays
                for observability, incident management, infrastructure tooling, and engineer
                time. The expansion path is broader operations automation across reliability,
                cost, security, and governance.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {marketSignals.map((signal) => (
                <article key={signal.label} className="devpilot-card p-5">
                  <p className="font-mono text-4xl font-semibold text-white">{signal.value}</p>
                  <h3 className="mt-4 text-lg font-semibold text-zinc-100">{signal.label}</h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">{signal.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="problem" className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold uppercase text-amber-200">Problem</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">
                DevOps teams have dashboards everywhere and accountable recovery nowhere.
              </h2>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {problemCards.map((card) => {
                const Icon = card.icon;

                return (
                  <article key={card.title} className="devpilot-card p-5">
                    <div className="grid size-11 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
                      <Icon className={`size-5 ${card.tone}`} aria-hidden="true" />
                    </div>
                    <h3 className="mt-6 text-xl font-semibold text-white">{card.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{card.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="solution" className="scroll-mt-24 border-y border-white/10 bg-[#0d0b12] px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="font-mono text-xs font-semibold uppercase text-emerald-200">Solution</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  One AI control loop for the moments when production is on fire.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
                  DevPilot does not replace engineers. It compresses the work between
                  signal and safe action, then leaves an auditable record for the team.
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                  {productHighlights.map((highlight) => (
                    <span
                      key={highlight}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-zinc-300"
                    >
                      {highlight}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {solutionSteps.map((step) => {
                  const Icon = step.icon;

                  return (
                    <article key={step.title} className="rounded-md border border-white/10 bg-[#090d0f] p-5">
                      <div className="mb-5 flex items-center justify-between gap-3">
                        <Icon className="size-5 text-cyan-200" aria-hidden="true" />
                        <CheckCircle2 className="size-5 text-emerald-200" aria-hidden="true" />
                      </div>
                      <h3 className="text-xl font-semibold text-white">{step.title}</h3>
                      <p className="mt-3 text-sm leading-6 text-zinc-400">{step.description}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="roi" className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div>
                <p className="font-mono text-xs font-semibold uppercase text-lime-200">ROI</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  The payback story is simple: reduce MTTR, recover engineer focus, and avoid one painful outage.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
                  The model below is illustrative, but the buyer logic is familiar:
                  incident work is expensive because it burns senior engineering time
                  while revenue, productivity, and reputation are at risk.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {roiMetrics.map((metric) => (
                  <article key={metric.label} className="devpilot-card p-5">
                    <p className="font-mono text-3xl font-semibold text-white">{metric.value}</p>
                    <h3 className="mt-4 text-base font-semibold text-zinc-100">{metric.label}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{metric.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 border-y border-white/10 bg-[#0f1008] px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <p className="font-mono text-xs font-semibold uppercase text-emerald-200">Pricing</p>
                <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
                  Start self-serve, expand into enterprise operations.
                </h2>
              </div>
              <Link
                href="/account"
                className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-zinc-100 transition hover:border-lime-200/50 hover:text-lime-100"
              >
                <DollarSign className="size-4" aria-hidden="true" />
                View Billing Console
              </Link>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.name}
                  className={`rounded-md border p-5 ${
                    plan.highlighted
                      ? "border-emerald-300/40 bg-emerald-300/10"
                      : "border-white/10 bg-[#090d0f]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{plan.description}</p>
                    </div>
                    {plan.highlighted ? (
                      <span className="rounded-md border border-emerald-300/35 bg-emerald-300/10 px-2 py-1 text-xs font-semibold uppercase text-emerald-100">
                        Live
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-6 font-mono text-4xl font-semibold text-white">
                    {plan.price}
                    <span className="text-base text-zinc-500">{plan.cadence}</span>
                  </p>

                  <div className="mt-6 grid gap-3">
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-2 text-sm text-zinc-300">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" aria-hidden="true" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold uppercase text-cyan-200">Testimonials</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-4xl">
                Representative buyer feedback from the pilot narrative.
              </h2>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {testimonials.map((testimonial) => (
                <figure key={testimonial.name} className="devpilot-card p-5">
                  <Zap className="size-5 text-amber-200" aria-hidden="true" />
                  <blockquote className="mt-5 text-base leading-7 text-zinc-200">
                    &quot;{testimonial.quote}&quot;
                  </blockquote>
                  <figcaption className="mt-6 border-t border-white/10 pt-4">
                    <p className="font-semibold text-white">{testimonial.name}</p>
                    <p className="mt-1 text-sm text-zinc-500">{testimonial.company}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 bg-[#07100f] px-4 py-12 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="flex items-center gap-3">
                <HeartPulse className="size-5 text-emerald-200" aria-hidden="true" />
                <p className="font-mono text-xs font-semibold uppercase text-emerald-100">
                  Startup-ready investor story
                </p>
              </div>
              <h2 className="mt-3 max-w-3xl text-2xl font-semibold text-white sm:text-3xl">
                Built as a working product surface, not a slide-only pitch.
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                Market notes reference Gartner public cloud spending, IDC AI infrastructure
                spending, Atlassian AI incident-management research, and downtime-cost
                benchmarks from Atlassian and ITIC.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link
                href="/demo"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200"
              >
                Run Demo Mode
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/enterprise"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-zinc-100 transition hover:border-emerald-200/50 hover:text-emerald-100"
              >
                Command Center
                <Users className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
