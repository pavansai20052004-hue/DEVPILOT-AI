"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  BrainCircuit,
  Building2,
  CloudCog,
  CloudUpload,
  Command,
  Database,
  DollarSign,
  FlaskConical,
  GitBranch,
  GitPullRequestCreate,
  HeartPulse,
  Mic2,
  Puzzle,
  Radar,
  RadioTower,
  ShieldCheck,
  Terminal,
  Waypoints,
  Wrench,
} from "lucide-react";
import { AuthStatusButton } from "@/components/auth-provider";
import { DemoRunButton } from "@/components/demo-mode-panel";
import { JudgeModeButton } from "@/components/judge-mode-panel";
import { RoleSwitcher } from "@/components/role-provider";
import { TeamSwitcher } from "@/components/team-provider";
import { flatNavigation, navigationGroups } from "@/lib/navigation";

const navIcons: Record<string, typeof Activity> = {
  "/dashboard": BarChart3,
  "/logs": CloudUpload,
  "/kubernetes": Boxes,
  "/auto-heal": HeartPulse,
  "/agents": Bot,
  "/voice": Mic2,
  "/predictive-failures": Radar,
  "/model-training": BrainCircuit,
  "/terraform": Wrench,
  "/fix-pr": GitPullRequestCreate,
  "/infra-command": Terminal,
  "/chaos": FlaskConical,
  "/enterprise": Command,
  "/digital-twin": Waypoints,
  "/security": ShieldCheck,
  "/cost": DollarSign,
  "/plugins": Puzzle,
  "/demo": Activity,
  "/account": Building2,
};

const mobilePrimaryHrefs = new Set([
  "/dashboard",
  "/logs",
  "/auto-heal",
  "/security",
  "/demo",
]);

const mobileNavigation = flatNavigation.filter((item) =>
  mobilePrimaryHrefs.has(item.href),
);

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const groupAccentClasses = [
  {
    label: "text-cyan-100",
    icon: "text-cyan-200",
    active: "border-cyan-300/35 bg-cyan-300/10 text-cyan-50",
    rail: "bg-cyan-300",
  },
  {
    label: "text-lime-100",
    icon: "text-lime-200",
    active: "border-lime-300/35 bg-lime-300/10 text-lime-50",
    rail: "bg-lime-300",
  },
  {
    label: "text-amber-100",
    icon: "text-amber-200",
    active: "border-amber-300/35 bg-amber-300/10 text-amber-50",
    rail: "bg-amber-300",
  },
  {
    label: "text-rose-100",
    icon: "text-rose-200",
    active: "border-rose-300/35 bg-rose-300/10 text-rose-50",
    rail: "bg-rose-300",
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeItem = flatNavigation.find((item) =>
    isActivePath(pathname, item.href),
  );
  const activeGroup = navigationGroups.find((group) =>
    group.items.some((item) => isActivePath(pathname, item.href)),
  );

  return (
    <div className="min-h-screen bg-[var(--background)] text-zinc-100 lg:grid lg:grid-cols-[17.75rem_1fr]">
      <aside className="hidden border-r border-white/10 bg-[linear-gradient(180deg,rgba(12,17,24,0.98),rgba(7,8,11,0.99))] lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <div className="flex min-h-full flex-col px-4 py-5">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-300/35"
          >
            <div className="grid size-11 shrink-0 place-items-center rounded-md border border-cyan-300/35 bg-cyan-300/10">
              <CloudCog
                className="size-5 text-cyan-200"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                DevPilot AI
              </p>
              <p className="mt-1 truncate text-xs text-zinc-400">
                AI DevOps control plane
              </p>
            </div>
          </Link>

          <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="status-dot" />
                <span className="text-xs font-semibold text-zinc-200">
                  Production workspace
                </span>
              </div>
              <RadioTower className="size-4 text-lime-200" aria-hidden="true" />
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="size-3.5 text-cyan-200" aria-hidden="true" />
                GitHub
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Database className="size-3.5 text-lime-200" aria-hidden="true" />
                Postgres
              </span>
            </div>
          </div>

          <nav className="mt-5 space-y-5 pb-5" aria-label="DevPilot sections">
            {navigationGroups.map((group, groupIndex) => {
              const accent = groupAccentClasses[groupIndex % groupAccentClasses.length];

              return (
              <div key={group.label}>
                <div className="mb-2 flex items-center gap-2 px-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${accent.rail}`} />
                  <p className={`font-mono text-[11px] font-semibold uppercase tracking-normal ${accent.label}`}>
                    {group.label}
                  </p>
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = navIcons[item.href] ?? Activity;
                    const active = isActivePath(pathname, item.href);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={item.description}
                        className={`group relative flex items-start gap-3 rounded-md border px-3 py-3 text-sm transition ${
                          active
                            ? accent.active
                            : "border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-100"
                        }`}
                      >
                        {active ? (
                          <span className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-r ${accent.rail}`} />
                        ) : null}
                        <Icon
                          className={`mt-0.5 size-4 shrink-0 ${
                            active
                              ? accent.icon
                              : "text-zinc-600 group-hover:text-cyan-200"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold leading-5">
                            {item.label}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[rgba(7,8,11,0.88)] px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[92rem] flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-300/35 bg-cyan-300/10 lg:hidden"
                  aria-label="DevPilot AI home"
                >
                  <CloudCog
                    className="size-5 text-cyan-200"
                    aria-hidden="true"
                  />
                </Link>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-semibold uppercase text-cyan-100">
                    {activeGroup?.label ?? "DevPilot AI"}
                  </p>
                  <h1 className="truncate text-lg font-semibold text-white sm:text-xl">
                    {activeItem?.label ?? "Your AI DevOps Engineer"}
                  </h1>
                </div>
              </div>

              <nav
                className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden"
                aria-label="Mobile DevPilot sections"
              >
                {mobileNavigation.map((item) => {
                  const Icon = navIcons[item.href] ?? Activity;
                  const active = isActivePath(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                        active
                          ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50"
                          : "border-white/10 bg-white/[0.04] text-zinc-300"
                      }`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="flex flex-wrap items-center gap-2 2xl:justify-end">
              <JudgeModeButton variant="header" />
              <DemoRunButton variant="header" />
              <TeamSwitcher />
              <RoleSwitcher variant="compact" />
              <AuthStatusButton />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[92rem]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
