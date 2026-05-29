"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Play, Terminal } from "lucide-react";
import { bootLines, stageIndex } from "@/components/cinematic-intro-data";

export function HeroBootPanel({
  bootLineCount,
  currentStageIndex,
  reducedMotion,
  typedBootLine,
}: {
  bootLineCount: number;
  currentStageIndex: number;
  reducedMotion: boolean | null;
  typedBootLine: string;
}) {
  return (
    <motion.div
      className="relative overflow-hidden rounded-lg border border-[#30363D] bg-[#161B22]/80 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-5"
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#58A6FF,#3FB950,transparent)]" />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-md border border-[#58A6FF]/30 bg-[#58A6FF]/10 px-3 py-1.5 font-mono text-xs text-[#58A6FF]">
          <span className="size-1.5 rounded-full bg-[#3FB950] shadow-[0_0_12px_#3FB950]" />
          incident replay / production
        </span>
        <span className="inline-flex items-center gap-2 rounded-md border border-[#30363D] bg-[#0D1117]/70 px-3 py-1.5 font-mono text-xs text-[#8B949E]">
          <Terminal className="size-3.5" aria-hidden="true" />
          boot sequence
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)] xl:items-center">
        <div>
          <motion.p
            className="font-mono text-sm uppercase text-[#58A6FF]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            autonomous self-healing devops engineer
          </motion.p>
          <motion.h1
            className="glitch-title mt-4 text-5xl font-black leading-none text-white sm:text-6xl lg:text-7xl xl:whitespace-nowrap"
            initial={{ opacity: 0, filter: "blur(16px)", scale: 0.96 }}
            animate={{
              opacity: currentStageIndex >= stageIndex("brand") ? 1 : 0.34,
              filter:
                currentStageIndex >= stageIndex("brand")
                  ? "blur(0px)"
                  : "blur(10px)",
              scale: currentStageIndex >= stageIndex("brand") ? 1 : 0.98,
            }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <span className="relative z-10">DevPilot AI</span>
            <span aria-hidden="true" className="glitch-title__layer glitch-title__layer--blue">
              DevPilot AI
            </span>
            <span aria-hidden="true" className="glitch-title__layer glitch-title__layer--green">
              DevPilot AI
            </span>
          </motion.h1>
          <motion.p
            className="mt-4 max-w-3xl text-2xl font-semibold leading-tight text-[#C9D1D9] sm:text-3xl"
            initial={{ opacity: 0, y: 16 }}
            animate={{
              opacity: currentStageIndex >= stageIndex("brand") ? 1 : 0,
              y: currentStageIndex >= stageIndex("brand") ? 0 : 16,
            }}
            transition={{ delay: 0.25, duration: 0.6 }}
          >
            Detect. Diagnose. Fix. Heal.
          </motion.p>
          <motion.p
            className="mt-4 max-w-2xl text-base leading-7 text-[#8B949E]"
            initial={{ opacity: 0 }}
            animate={{
              opacity: currentStageIndex >= stageIndex("analysis") ? 1 : 0.32,
            }}
          >
            A premium AI operations cockpit that turns Kubernetes alerts, failed
            deployments, Terraform drift, and incident memory into human-approved
            recovery actions.
          </motion.p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[#3FB950]/50 bg-[#3FB950] px-5 text-sm font-bold text-[#071014] shadow-[0_0_40px_rgba(63,185,80,0.3)] transition hover:bg-[#7EE787]"
            >
              <Play className="size-4" aria-hidden="true" />
              Enter Live Cockpit
            </Link>
            <a
              href="#roi"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[#30363D] bg-[#161B22]/80 px-5 text-sm font-bold text-[#C9D1D9] transition hover:border-[#58A6FF]/60 hover:text-white"
            >
              View Recovery ROI
              <ChevronRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="rounded-lg border border-[#30363D] bg-[#0D1117]/90 shadow-2xl shadow-black/30">
          <div className="flex items-center gap-2 border-b border-[#30363D] px-4 py-3">
            <span className="size-2.5 rounded-full bg-[#F85149]" />
            <span className="size-2.5 rounded-full bg-[#D29922]" />
            <span className="size-2.5 rounded-full bg-[#3FB950]" />
            <span className="ml-2 font-mono text-xs text-[#8B949E]">
              devpilot.boot
            </span>
          </div>
          <div className="min-h-[15rem] p-4 font-mono text-sm leading-6 text-[#C9D1D9]">
            {bootLines.slice(0, bootLineCount).map((line, index) => {
              const isTypingLine = !reducedMotion && index === bootLineCount - 1;
              const visibleLine = isTypingLine
                ? typedBootLine || line.slice(0, 1)
                : line;

              return (
                <motion.div
                  key={line}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.24, delay: index * 0.03 }}
                  className={index >= 4 ? "text-[#3FB950]" : "text-[#C9D1D9]"}
                >
                  <span className="text-[#58A6FF]">&gt;</span> {visibleLine}
                </motion.div>
              );
            })}
            <span className="terminal-cursor text-[#58A6FF]">_</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
