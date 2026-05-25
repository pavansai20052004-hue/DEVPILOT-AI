import { AlertCircle, RotateCw } from "lucide-react";

export function RetryNotice({
  message,
  onRetry,
  retryLabel = "Retry",
  tone = "red",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  tone?: "amber" | "red";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-300/25 bg-amber-300/10 text-amber-50"
      : "border-red-400/25 bg-red-400/10 text-red-100";

  return (
    <div
      className={`flex flex-col gap-3 rounded-md border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between ${toneClass}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-current/25 bg-black/10 px-3 text-xs font-semibold transition hover:bg-black/20"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
