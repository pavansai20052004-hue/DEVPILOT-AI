"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Bot, Globe2, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import {
  analysisCards,
  counters,
  type Incident,
  networkNodes,
  stageIndex,
} from "@/components/cinematic-intro-data";

export function IncidentAnalysisGrid({
  currentStageIndex,
  visibleIncidents,
}: {
  currentStageIndex: number;
  visibleIncidents: readonly Incident[];
}) {
  return (
    <motion.div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.8fr)]"
      initial={{ opacity: 0, y: 24 }}
      animate={{
        opacity: currentStageIndex >= stageIndex("alerts") ? 1 : 0.2,
        y: currentStageIndex >= stageIndex("alerts") ? 0 : 24,
      }}
      transition={{ duration: 0.6 }}
    >
      <div className="holographic-card rounded-lg border border-[#30363D] bg-[#161B22]/80 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-[#58A6FF]">
              live incident feed
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              Infrastructure alerts
            </h2>
          </div>
          <AlertTriangle className="size-5 text-[#F85149]" aria-hidden="true" />
        </div>
        <div className="grid gap-3">
          {visibleIncidents.map((incident, index) => (
            <motion.div
              key={incident.title}
              className="rounded-md border border-[#30363D] bg-[#0D1117]/78 p-3"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.12 }}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1 size-2 rounded-full ${incidentTone(incident.tone)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-white">
                      {incident.title}
                    </p>
                    <span className="font-mono text-xs text-[#8B949E]">
                      {incident.time}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#8B949E]">
                    {incident.detail}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="holographic-card rounded-lg border border-[#30363D] bg-[#161B22]/80 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-[#3FB950]">
              ai root cause engine
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              Analysis stream
            </h2>
          </div>
          <Bot className="size-5 text-[#3FB950]" aria-hidden="true" />
        </div>
        <div className="grid gap-3">
          {analysisCards.map((card, index) => {
            const Icon = card.icon;

            return (
              <motion.div
                key={card.label}
                className="rounded-md border border-[#30363D] bg-[#0D1117]/78 p-3"
                initial={{ opacity: 0, y: 14 }}
                animate={{
                  opacity: currentStageIndex >= stageIndex("analysis") ? 1 : 0.32,
                  y: currentStageIndex >= stageIndex("analysis") ? 0 : 14,
                }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="flex items-center gap-3">
                  <Icon className="size-4 text-[#58A6FF]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs uppercase text-[#8B949E]">
                      {card.label}
                    </p>
                    <p className="truncate text-sm font-semibold text-[#C9D1D9]">
                      {card.value}
                    </p>
                  </div>
                  <span className="rounded-md border border-[#3FB950]/30 bg-[#3FB950]/10 px-2 py-1 font-mono text-xs text-[#3FB950]">
                    {card.meter}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

export function InfrastructureMapPanel() {
  return (
    <motion.aside
      className="holographic-card rounded-lg border border-[#30363D] bg-[#161B22]/85 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, delay: 0.2 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-[#58A6FF]">
            infrastructure graph
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            Autonomous recovery map
          </h2>
        </div>
        <Globe2 className="size-5 text-[#58A6FF]" aria-hidden="true" />
      </div>

      <div className="network-globe relative mx-auto mt-5 aspect-square w-full max-w-[19rem] overflow-hidden rounded-full border border-[#30363D] bg-[#0D1117]">
        <div className="absolute inset-[15%] rounded-full border border-[#58A6FF]/20" />
        <div className="absolute inset-[27%] rounded-full border border-[#3FB950]/20" />
        {networkNodes.map((node) => (
          <span
            key={node.id}
            className="network-node absolute grid size-11 place-items-center rounded-full border border-[#58A6FF]/40 bg-[#161B22] font-mono text-[0.65rem] font-semibold text-[#C9D1D9]"
            style={
              {
                "--x": `${node.x}%`,
                "--y": `${node.y}%`,
              } as CSSProperties
            }
          >
            {node.label}
          </span>
        ))}
        <div className="absolute left-[22%] top-[30%] h-px w-[52%] rotate-[16deg] bg-[#58A6FF]/40" />
        <div className="absolute left-[28%] top-[62%] h-px w-[45%] -rotate-[22deg] bg-[#3FB950]/40" />
        <div className="absolute left-[48%] top-[18%] h-[56%] w-px rotate-[12deg] bg-[#58A6FF]/30" />
      </div>

      <button
        type="button"
        className="auto-heal-button mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[#3FB950]/60 bg-[#3FB950] px-4 text-sm font-bold text-[#071014] transition hover:bg-[#7EE787]"
      >
        <Zap className="size-4" aria-hidden="true" />
        Auto Heal Engine
      </button>

      <div className="mt-4 grid gap-3">
        {counters.map((counter) => {
          const Icon = counter.icon;

          return (
            <div
              key={counter.label}
              className="flex items-center gap-3 rounded-md border border-[#30363D] bg-[#0D1117]/78 p-3"
            >
              <Icon className="size-4 text-[#3FB950]" aria-hidden="true" />
              <span className="text-sm font-semibold text-[#C9D1D9]">
                {counter.label}
              </span>
              <span className="ml-auto font-mono text-lg font-semibold text-white">
                {counter.value}
              </span>
            </div>
          );
        })}
      </div>
    </motion.aside>
  );
}

function incidentTone(tone: Incident["tone"]) {
  if (tone === "danger") {
    return "bg-[#F85149] shadow-[0_0_16px_#F85149]";
  }
  if (tone === "success") {
    return "bg-[#3FB950] shadow-[0_0_16px_#3FB950]";
  }
  return "bg-[#D29922] shadow-[0_0_16px_#D29922]";
}
