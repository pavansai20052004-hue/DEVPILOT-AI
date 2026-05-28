import type { ReactNode } from "react";
import { Activity } from "lucide-react";

export function SectionPage({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="section-page">
      <header className="insight-panel p-5 sm:p-6">
        <div className="relative z-10">
          <span className="premium-eyebrow">
            <Activity className="size-3.5" aria-hidden="true" />
            {kicker}
          </span>
        </div>
        <div className="relative z-10 mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-4xl">
            <h1 className="font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-300">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold text-zinc-300">
            <span className="status-chip">
              <span className="status-dot" />
              Live workflow
            </span>
            <span className="status-chip">Approval-ready</span>
          </div>
        </div>
      </header>

      <div className="section-page-content pt-5">{children}</div>
    </div>
  );
}
