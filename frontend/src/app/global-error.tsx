"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main
          style={{
            alignItems: "center",
            background: "#050708",
            color: "#f4f4f5",
            display: "grid",
            minHeight: "100vh",
            padding: "24px",
          }}
        >
          <section
            style={{
              background: "rgba(251, 191, 36, 0.1)",
              border: "1px solid rgba(252, 211, 77, 0.28)",
              borderRadius: "8px",
              margin: "0 auto",
              maxWidth: "640px",
              padding: "24px",
            }}
          >
            <AlertTriangle aria-hidden="true" />
            <h1>DevPilot needs a quick retry.</h1>
            <p>
              A top-level rendering error was contained so the browser tab did
              not crash.
            </p>
            {retry ? (
              <button
                type="button"
                onClick={retry}
                style={{
                  alignItems: "center",
                  background: "#fde68a",
                  border: "1px solid rgba(253, 230, 138, 0.7)",
                  borderRadius: "6px",
                  color: "#18181b",
                  cursor: "pointer",
                  display: "inline-flex",
                  fontWeight: 700,
                  gap: "8px",
                  height: "40px",
                  marginTop: "16px",
                  padding: "0 16px",
                }}
              >
                <RotateCw aria-hidden="true" size={16} />
                Retry
              </button>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
