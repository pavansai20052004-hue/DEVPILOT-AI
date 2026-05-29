"use client";

import { motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Server,
  Zap,
} from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import {
  cockpitNavItems,
  codeOutput,
  recoveryProofs,
} from "@/components/cinematic-intro-data";

export function CinematicCockpitPanel({
  autoHealActive,
  copied,
  currentStageIndex,
  onCopyCode,
  setSidebarCollapsed,
  sidebarCollapsed,
}: {
  autoHealActive: boolean;
  copied: boolean;
  currentStageIndex: number;
  onCopyCode: () => void;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
}) {
  return (
    <motion.div
      className="mb-4 overflow-hidden rounded-lg border border-[#30363D] bg-[#161B22]/90 shadow-2xl shadow-black/50 backdrop-blur-xl"
      initial={{ opacity: 0, y: 36, scale: 0.98 }}
      animate={{
        opacity: currentStageIndex >= 4 ? 1 : 0.34,
        y: currentStageIndex >= 4 ? 0 : 36,
        scale: currentStageIndex >= 4 ? 1 : 0.98,
      }}
      transition={{ duration: 0.75, ease: "easeOut" }}
    >
      <div className="grid lg:grid-cols-[auto_minmax(0,1fr)]">
        <aside
          className={`hidden border-r border-[#30363D] bg-[#0D1117]/80 p-3 transition-all lg:block ${
            sidebarCollapsed ? "w-16" : "w-64"
          }`}
        >
          <button
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            className="mb-4 grid size-10 place-items-center rounded-md border border-[#30363D] text-[#8B949E] transition hover:border-[#58A6FF]/60 hover:text-white"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="size-4" aria-hidden="true" />
            )}
          </button>
          <div className="grid gap-2">
            {cockpitNavItems.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  className="flex h-10 items-center gap-3 rounded-md border border-transparent px-2 text-sm font-semibold text-[#8B949E] transition hover:border-[#30363D] hover:bg-white/5 hover:text-white"
                >
                  <Icon className="size-4 shrink-0 text-[#58A6FF]" aria-hidden="true" />
                  {!sidebarCollapsed ? <span>{item.label}</span> : null}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 p-3 sm:p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Server className="size-5 text-[#58A6FF]" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">
                DevPilot cockpit
              </span>
              <span className="rounded-md border border-[#3FB950]/30 bg-[#3FB950]/10 px-2 py-1 font-mono text-xs text-[#3FB950]">
                {autoHealActive ? "auto-heal online" : "monitoring"}
              </span>
            </div>
            <button
              type="button"
              className="auto-heal-button inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#3FB950]/60 bg-[#3FB950] px-4 text-sm font-bold text-[#071014] transition hover:bg-[#7EE787]"
            >
              <Zap className="size-4" aria-hidden="true" />
              Auto Heal
            </button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.78fr)]">
            <div className="rounded-lg border border-[#30363D] bg-[#0D1117]/78">
              <div className="flex items-center justify-between gap-3 border-b border-[#30363D] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Code2 className="size-4 text-[#58A6FF]" aria-hidden="true" />
                  <span className="font-mono text-xs text-[#8B949E]">
                    recovery.plan.ts
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onCopyCode}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[#30363D] px-2 text-xs font-semibold text-[#8B949E] transition hover:border-[#58A6FF]/60 hover:text-white"
                >
                  {copied ? (
                    <CheckCircle2 className="size-3.5 text-[#3FB950]" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-sm leading-7 text-[#C9D1D9]">
                <code>{codeOutput}</code>
              </pre>
            </div>

            <div className="grid gap-3">
              {recoveryProofs.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[#30363D] bg-[#0D1117]/78 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="size-4 text-[#3FB950]" aria-hidden="true" />
                      <p className="font-mono text-xs uppercase text-[#8B949E]">
                        {item.label}
                      </p>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {item.value}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
