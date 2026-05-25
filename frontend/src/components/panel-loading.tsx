export function PanelLoading({ label = "Loading panel" }: { label?: string }) {
  return (
    <div
      className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-sm text-zinc-400"
      role="status"
      aria-live="polite"
    >
      <div className="mb-4 h-4 w-40 animate-pulse rounded bg-white/10" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-md bg-white/10" />
        <div className="h-32 animate-pulse rounded-md bg-white/10" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
