"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  Lock,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { RetryNotice } from "@/components/retry-notice";
import { apiRequest } from "@/lib/api-client";
import { subscribeToDemoRuns } from "@/lib/demo-mode";
import { devPilotRoleHeaders } from "@/lib/rbac";

type UploadResult = {
  upload_id: string;
  status: string;
  filename?: string | null;
  line_count: number;
  character_count: number;
};

type LogAnalysisResult = {
  root_cause: string;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
  recommended_fix: string;
};

export function LogUploadPanel() {
  const { role, can, roleLabel } = useRole();
  const [logs, setLogs] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [analysis, setAnalysis] = useState<LogAnalysisResult | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<
    "upload" | "analysis" | null
  >(null);

  const logStats = useMemo(() => {
    const trimmed = logs.trim();
    const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;

    return {
      characters: logs.length,
      lines,
    };
  }, [logs]);
  const canUploadLogs = can("upload_logs");

  useEffect(
    () =>
      subscribeToDemoRuns((payload) => {
        setLogs(payload.sample_logs);
        setFileName(payload.log_upload.filename ?? "devpilot-demo-failures.txt");
        setResult(payload.log_upload);
        setAnalysis(payload.analysis);
        setError(null);
        setLastFailedAction(null);
        setIsSubmitting(false);
        setIsAnalyzing(false);
      }),
    [],
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setError(null);
    setLastFailedAction(null);
    setResult(null);
    setAnalysis(null);

    if (!file) {
      return;
    }

    const isTextFile =
      file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");

    if (!isTextFile) {
      setFileName(null);
      setError("Upload a .txt log file.");
      event.target.value = "";
      return;
    }

    try {
      const content = await file.text();
      setFileName(file.name);
      setLogs(content);
    } catch {
      setFileName(null);
      setError("Could not read that log file. Try another .txt file.");
      event.target.value = "";
    }
  }

  async function submitLogs() {
    setError(null);
    setLastFailedAction(null);
    setResult(null);

    if (!logs.trim()) {
      setError("Paste logs or choose a .txt file before submitting.");
      return;
    }

    if (!canUploadLogs) {
      setError("Log intake requires Admin or DevOps Engineer access.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = await apiRequest<UploadResult>("/api/logs/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({
          content: logs,
          filename: fileName,
          source: fileName ? "txt-file" : "pasted-text",
        }),
        errorMessage: "Log upload failed.",
        retries: 1,
      });

      setResult(payload);
    } catch (uploadError) {
      setLastFailedAction("upload");
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not reach the log upload API.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function analyzeLogs() {
    setError(null);
    setLastFailedAction(null);
    setAnalysis(null);

    if (!logs.trim()) {
      setError("Paste logs or choose a .txt file before analyzing.");
      return;
    }

    setIsAnalyzing(true);

    try {
      const payload = await apiRequest<LogAnalysisResult>("/analyze-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({ logs }),
        errorMessage: "Log analysis failed.",
        retries: 1,
      });

      setAnalysis(payload);
    } catch (analysisError) {
      setLastFailedAction("analysis");
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Could not reach the log analysis API.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitLogs();
  }

  return (
    <section id="log-upload" className="bg-[#07090b] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-emerald-200">
            Log Intake
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Upload incident logs for the first diagnosis pass.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            Incident payloads land in the backend intake API with source,
            volume, and timestamp metadata for downstream diagnosis.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="font-mono text-2xl font-semibold text-white">
                {logStats.lines}
              </p>
              <p className="mt-1 text-sm text-zinc-400">Detected lines</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="font-mono text-2xl font-semibold text-white">
                {logStats.characters}
              </p>
              <p className="mt-1 text-sm text-zinc-400">Characters ready</p>
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5"
        >
          <label
            htmlFor="logs"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100"
          >
            <FileText className="size-4 text-emerald-200" aria-hidden="true" />
            Paste Logs
          </label>
          <textarea
            id="logs"
            value={logs}
            onChange={(event) => {
              setLogs(event.target.value);
              setResult(null);
              setAnalysis(null);
              setError(null);
              setLastFailedAction(null);
            }}
            placeholder="Paste deployment, runtime, or CI logs here..."
            className="min-h-64 w-full resize-y rounded-md border border-white/10 bg-[#07090b] px-4 py-3 font-mono text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/20"
          />

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
            <label
              htmlFor="log-file"
              className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-md border border-dashed border-emerald-300/35 bg-emerald-300/8 px-4 py-3 text-sm text-zinc-200 transition hover:border-emerald-200"
            >
              <span className="truncate">
                {fileName ?? "Choose a .txt log file"}
              </span>
              <CloudUpload className="size-4 shrink-0 text-emerald-200" aria-hidden="true" />
              <input
                id="log-file"
                type="file"
                accept=".txt,text/plain"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting || isAnalyzing || !canUploadLogs}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(110,231,183,0.18)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : !canUploadLogs ? (
                <Lock className="size-4" aria-hidden="true" />
              ) : (
                <CloudUpload className="size-4" aria-hidden="true" />
              )}
              {canUploadLogs ? "Submit Logs" : "Locked"}
            </button>
            <button
              type="button"
              onClick={analyzeLogs}
              disabled={isSubmitting || isAnalyzing || !logs.trim()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(103,232,249,0.16)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAnalyzing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <BrainCircuit className="size-4" aria-hidden="true" />
              )}
              Analyze Logs
            </button>
          </div>

          {!canUploadLogs ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {roleLabel} can view incident data, but log intake requires
                Admin or DevOps Engineer access.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <RetryNotice
                message={error}
                onRetry={
                  logs.trim()
                    ? lastFailedAction === "analysis"
                      ? analyzeLogs
                      : canUploadLogs
                        ? submitLogs
                        : undefined
                    : undefined
                }
                retryLabel={
                  lastFailedAction === "analysis" ? "Retry analysis" : "Retry upload"
                }
              />
            </div>
          ) : null}

          {result ? (
            <div className="mt-4 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-200" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Logs uploaded successfully.</p>
                  <p className="mt-1 text-emerald-100/80">
                    ID {result.upload_id} received {result.line_count} lines and{" "}
                    {result.character_count} characters.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {analysis ? (
            <div className="mt-4 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">
              <div className="flex items-start gap-2">
                <BrainCircuit
                  className="mt-0.5 size-4 shrink-0 text-cyan-200"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-semibold">
                    {analysis.root_cause}
                    <span className="ml-2 rounded border border-cyan-200/25 px-2 py-0.5 font-mono text-[11px] uppercase text-cyan-100">
                      {analysis.severity}
                    </span>
                  </p>
                  <p className="mt-2 text-cyan-100/80">{analysis.explanation}</p>
                  <p className="mt-2 text-cyan-50">{analysis.recommended_fix}</p>
                </div>
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
