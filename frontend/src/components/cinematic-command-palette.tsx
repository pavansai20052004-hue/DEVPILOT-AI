"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Command, Play, X, Zap } from "lucide-react";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const commands = [
    { label: "Open incident dashboard", href: "/dashboard", icon: Activity },
    { label: "Run demo mode", href: "/demo", icon: Play },
    { label: "Inspect auto-heal engine", href: "/auto-heal", icon: Zap },
    { label: "Review command center", href: "/enterprise", icon: Command },
  ];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/60 px-4 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="DevPilot command palette"
        >
          <motion.div
            className="w-full max-w-2xl overflow-hidden rounded-lg border border-[#30363D] bg-[#0D1117] shadow-2xl shadow-black/60"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.22 }}
          >
            <div className="flex items-center gap-3 border-b border-[#30363D] px-4 py-3">
              <Command className="size-4 text-[#58A6FF]" aria-hidden="true" />
              <span className="font-mono text-sm text-[#C9D1D9]">
                devpilot.command
              </span>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto grid size-8 place-items-center rounded-md text-[#8B949E] transition hover:bg-white/10 hover:text-white"
                aria-label="Close command palette"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-2 p-3">
              {commands.map((command) => {
                const Icon = command.icon;

                return (
                  <Link
                    key={command.href}
                    href={command.href}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-md border border-transparent px-3 py-3 text-sm font-semibold text-[#C9D1D9] transition hover:border-[#58A6FF]/40 hover:bg-[#58A6FF]/10 hover:text-white"
                  >
                    <Icon className="size-4 text-[#3FB950]" aria-hidden="true" />
                    {command.label}
                    <span className="ml-auto font-mono text-xs text-[#8B949E]">
                      Enter
                    </span>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
