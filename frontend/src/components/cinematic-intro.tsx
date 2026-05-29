"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { CommandPalette } from "@/components/cinematic-command-palette";
import { CinematicCockpitPanel } from "@/components/cinematic-cockpit-panel";
import {
  ParticleNetwork,
  useAmbientSound,
  useCinematicTimeline,
  writeClipboardText,
} from "@/components/cinematic-intro-effects";
import { CinematicIntroHeader } from "@/components/cinematic-intro-header";
import { HeroBootPanel } from "@/components/cinematic-intro-hero";
import {
  codeOutput,
  incidentFeed,
  stageIndex,
} from "@/components/cinematic-intro-data";
import {
  IncidentAnalysisGrid,
  InfrastructureMapPanel,
} from "@/components/cinematic-monitoring-panels";

export function CinematicIntro() {
  const reducedMotion = useReducedMotion();
  const { stage, bootLineCount, typedBootLine, skipIntro } =
    useCinematicTimeline(reducedMotion);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const currentStageIndex = stageIndex(stage);
  const autoHealActive = currentStageIndex >= stageIndex("heal");
  const cockpitVisible = currentStageIndex >= stageIndex("cockpit");

  useAmbientSound(soundEnabled, reducedMotion);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visibleIncidents = useMemo(() => {
    if (currentStageIndex < stageIndex("alerts")) {
      return incidentFeed.slice(0, 1);
    }
    if (currentStageIndex < stageIndex("analysis")) {
      return incidentFeed.slice(0, 3);
    }
    return incidentFeed;
  }, [currentStageIndex]);

  const copyCode = useCallback(async () => {
    try {
      await writeClipboardText(codeOutput);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <section className="cinematic-intro relative isolate min-h-screen overflow-hidden border-b border-[#30363D] bg-[#0D1117] text-[#C9D1D9]">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_20%_10%,rgba(88,166,255,0.24),transparent_30rem),radial-gradient(circle_at_80%_20%,rgba(63,185,80,0.18),transparent_26rem),linear-gradient(180deg,#0D1117_0%,#090D13_62%,#0D1117_100%)]" />
      <div className="cinematic-grid absolute inset-0 -z-10 opacity-70" />
      <ParticleNetwork reducedMotion={reducedMotion} />
      <div className="cinematic-scanline pointer-events-none absolute inset-0" />

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[92rem] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <CinematicIntroHeader
          cockpitVisible={cockpitVisible}
          currentStageIndex={currentStageIndex}
          onCommandOpen={() => setCommandOpen(true)}
          onSkip={skipIntro}
          onSoundToggle={() => setSoundEnabled((current) => !current)}
          soundEnabled={soundEnabled}
        />

        <div className="grid flex-1 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start">
          <div className="grid gap-4">
            <HeroBootPanel
              bootLineCount={bootLineCount}
              currentStageIndex={currentStageIndex}
              reducedMotion={reducedMotion}
              typedBootLine={typedBootLine}
            />
            <IncidentAnalysisGrid
              currentStageIndex={currentStageIndex}
              visibleIncidents={visibleIncidents}
            />
          </div>

          <InfrastructureMapPanel />
        </div>

        <CinematicCockpitPanel
          autoHealActive={autoHealActive}
          copied={copied}
          currentStageIndex={currentStageIndex}
          onCopyCode={copyCode}
          setSidebarCollapsed={setSidebarCollapsed}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </section>
  );
}
