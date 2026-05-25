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
  DollarSign,
  FlaskConical,
  GitPullRequestCreate,
  HeartPulse,
  Mic2,
  Puzzle,
  Radar,
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

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeItem = flatNavigation.find((item) =>
    isActivePath(pathname, item.href),
  );

  return (
    <div className="min-h-screen bg-[#050708] text-zinc-100 lg:grid lg:grid-cols-[18rem_1fr]">
      <aside className="hidden border-r border-white/10 bg-[#080b0d]/95 lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <div className="flex min-h-full flex-col px-4 py-5">
          <Link
            href="/"
            className="group rounded-md border border-white/10 bg-[#0e1315] p-4 transition hover:border-emerald-300/40"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-md border border-emerald-300/35 bg-emerald-300/10">
                <CloudCog
                  className="size-5 text-emerald-200"
                  aria-hidden="true"
                />
              </div>
              <div>
                <p className="font-mono text-sm font-semibold uppercase text-white">
                  DevPilot AI
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Your AI DevOps Engineer
                </p>
              </div>
            </div>
          </Link>

          <nav className="mt-5 space-y-5" aria-label="DevPilot sections">
            {navigationGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-2 font-mono text-[11px] font-semibold uppercase tracking-normal text-zinc-600">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = navIcons[item.href] ?? Activity;
                    const active = isActivePath(pathname, item.href);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`group flex items-start gap-3 rounded-md border px-3 py-3 text-sm transition ${
                          active
                            ? "border-emerald-300/35 bg-emerald-300/10 text-emerald-50"
                            : "border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-100"
                        }`}
                      >
                        <Icon
                          className={`mt-0.5 size-4 shrink-0 ${
                            active
                              ? "text-emerald-200"
                              : "text-zinc-600 group-hover:text-cyan-200"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold leading-5">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-zinc-500">
                            {item.description}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050708]/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="grid size-10 shrink-0 place-items-center rounded-md border border-emerald-300/35 bg-emerald-300/10 lg:hidden"
                  aria-label="DevPilot AI home"
                >
                  <CloudCog
                    className="size-5 text-emerald-200"
                    aria-hidden="true"
                  />
                </Link>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-semibold uppercase text-emerald-100">
                    DevPilot AI
                  </p>
                  <h1 className="truncate text-base font-semibold text-white sm:text-lg">
                    {activeItem?.label ?? "Your AI DevOps Engineer"}
                  </h1>
                </div>
              </div>

              <nav
                className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden"
                aria-label="Mobile DevPilot sections"
              >
                {flatNavigation.map((item) => {
                  const Icon = navIcons[item.href] ?? Activity;
                  const active = isActivePath(pathname, item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                        active
                          ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-50"
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

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <JudgeModeButton variant="header" />
              <DemoRunButton variant="header" />
              <TeamSwitcher />
              <RoleSwitcher variant="compact" />
              <AuthStatusButton />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
