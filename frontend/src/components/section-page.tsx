import type { ReactNode } from "react";

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
      <header className="border-b border-white/10 pb-6">
        <p className="font-mono text-xs font-semibold uppercase tracking-normal text-emerald-200">
          {kicker}
        </p>
        <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
              {description}
            </p>
          </div>
          <div className="rounded-md border border-white/10 bg-[#0e1315] px-4 py-3 font-mono text-xs uppercase text-zinc-500">
            Connected DevOps workspace
          </div>
        </div>
      </header>

      <div className="section-page-content pt-6">{children}</div>
    </div>
  );
}
