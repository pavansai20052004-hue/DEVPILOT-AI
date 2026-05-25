"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

export default function AppError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  unstable_retry?: () => void;
}) {
  const retry = unstable_retry ?? reset;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-5 text-amber-50">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-white">
            DevPilot could not render this screen.
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-50/80">
            The rest of the app is still available. Retry the screen after the
            backend or browser state settles.
          </p>
          {retry ? (
            <button
              type="button"
              onClick={retry}
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-200/40 bg-amber-200 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-amber-100"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
