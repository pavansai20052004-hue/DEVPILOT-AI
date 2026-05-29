"use client";

import Link from "next/link";
import { ChevronRight, CloudCog, Command, Volume2, VolumeX } from "lucide-react";
import { timeline } from "@/components/cinematic-intro-data";

export function CinematicIntroHeader({
  cockpitVisible,
  currentStageIndex,
  onCommandOpen,
  onSkip,
  onSoundToggle,
  soundEnabled,
}: {
  cockpitVisible: boolean;
  currentStageIndex: number;
  onCommandOpen: () => void;
  onSkip: () => void;
  onSoundToggle: () => void;
  soundEnabled: boolean;
}) {
  return (
    <header className="flex items-center justify-between gap-3 rounded-lg border border-[#30363D]/80 bg-[#161B22]/70 px-3 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <Link
        href="/"
        className="flex min-w-0 items-center gap-3"
        aria-label="DevPilot AI home"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[#58A6FF]/40 bg-[#58A6FF]/10">
          <CloudCog className="size-5 text-[#58A6FF]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">
            DevPilot AI
          </span>
          <span className="block truncate font-mono text-xs text-[#8B949E]">
            autonomous cloud OS
          </span>
        </span>
      </Link>

      <div className="hidden items-center gap-2 md:flex">
        {timeline.map((item, index) => (
          <span
            key={item}
            className={`h-1.5 w-10 rounded-full transition ${
              index <= currentStageIndex ? "bg-[#3FB950]" : "bg-[#30363D]"
            }`}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCommandOpen}
          className="hidden h-10 items-center gap-2 rounded-md border border-[#30363D] bg-[#0D1117]/70 px-3 font-mono text-xs font-semibold text-[#C9D1D9] transition hover:border-[#58A6FF]/60 hover:text-white sm:inline-flex"
        >
          <Command className="size-3.5" aria-hidden="true" />
          Ctrl K
        </button>
        <button
          type="button"
          onClick={onSoundToggle}
          className="grid size-10 place-items-center rounded-md border border-[#30363D] bg-[#0D1117]/70 text-[#8B949E] transition hover:border-[#58A6FF]/60 hover:text-white"
          aria-label={soundEnabled ? "Disable ambient sound" : "Enable ambient sound"}
        >
          {soundEnabled ? (
            <Volume2 className="size-4" aria-hidden="true" />
          ) : (
            <VolumeX className="size-4" aria-hidden="true" />
          )}
        </button>
        {!cockpitVisible ? (
          <button
            type="button"
            onClick={onSkip}
            className="h-10 rounded-md border border-[#30363D] bg-[#0D1117]/70 px-3 text-xs font-semibold text-[#8B949E] transition hover:border-[#58A6FF]/60 hover:text-white"
          >
            Skip
          </button>
        ) : null}
        <Link
          href="/dashboard"
          className="hidden h-10 items-center justify-center gap-2 rounded-md border border-[#3FB950]/50 bg-[#3FB950] px-3 text-sm font-semibold text-[#071014] shadow-[0_0_28px_rgba(63,185,80,0.24)] transition hover:bg-[#7EE787] sm:inline-flex"
        >
          Launch Cockpit
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
