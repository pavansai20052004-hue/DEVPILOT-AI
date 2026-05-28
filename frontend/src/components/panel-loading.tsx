export function PanelLoading({ label = "Loading panel" }: { label?: string }) {
  return (
    <div
      className="insight-panel p-5 text-sm text-zinc-400"
      role="status"
      aria-live="polite"
    >
      <div className="relative z-10">
        <div className="mb-5 h-4 w-48 animate-pulse rounded bg-cyan-200/20" />
        <div className="mb-6 h-10 max-w-xl animate-pulse rounded bg-white/10" />
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="h-28 animate-pulse rounded-md bg-white/10" />
          <div className="h-28 animate-pulse rounded-md bg-white/10" />
          <div className="h-28 animate-pulse rounded-md bg-white/10" />
          <div className="h-28 animate-pulse rounded-md bg-white/10" />
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
