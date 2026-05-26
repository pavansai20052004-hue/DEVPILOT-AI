"use client";

import { FormEvent, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CloudCog,
  Loader2,
  Lock,
  Play,
  RotateCw,
  Scale3d,
  Server,
  Sparkles,
  Terminal,
  Undo2,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

type InfraCommandAction =
  | "restart_pods"
  | "rollback_deployment"
  | "scale_deployment";

type InfraCommandMode = "preview" | "executed";
type InfraCommandActionStatus = "planned" | "completed";

type InfraCommandPlan = {
  action: InfraCommandAction;
  namespace: string;
  target: string;
  replicas?: number | null;
  confidence: number;
  reasoning: string;
};

type InfraCommandActionResult = {
  action: InfraCommandAction;
  status: InfraCommandActionStatus;
  namespace: string;
  target: string;
  message: string;
  pod_names: string[];
  deployment_name?: string | null;
  replicas?: number | null;
  completed_at: string;
};

type InfraCommandResponse = {
  command: string;
  mode: InfraCommandMode;
  context?: string | null;
  plan: InfraCommandPlan;
  actions: InfraCommandActionResult[];
  message: string;
  generated_at: string;
};


const examples = [
  "restart payment pods",
  "rollback staging",
  "scale web service to 10 replicas",
];

const actionLabels: Record<InfraCommandAction, string> = {
  restart_pods: "Restart pods",
  rollback_deployment: "Rollback deployment",
  scale_deployment: "Scale deployment",
};

const actionIcons: Record<InfraCommandAction, typeof RotateCw> = {
  restart_pods: RotateCw,
  rollback_deployment: Undo2,
  scale_deployment: Scale3d,
};

const statusClasses: Record<InfraCommandActionStatus, string> = {
  planned: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  completed: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
};


function formatActionValue(action: InfraCommandAction) {
  return actionLabels[action];
}

function formatConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`;
}

function modeClasses(mode: InfraCommandMode) {
  return mode === "executed"
    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
    : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
}

export function PlainEnglishInfraPanel() {
  const { role, can, roleLabel } = useRole();
  const canExecute = can("recover_cluster");
  const [command, setCommand] = useState(examples[0]);
  const [namespace, setNamespace] = useState("production");
  const [context, setContext] = useState("");
  const [kubeconfigPath, setKubeconfigPath] = useState("");
  const [response, setResponse] = useState<InfraCommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<InfraCommandMode | null>(null);

  async function submitCommand(execute: boolean) {
    if (execute && !canExecute) {
      setError("Executing infrastructure commands requires Admin or DevOps Engineer access.");
      return;
    }

    setPendingMode(execute ? "executed" : "preview");
    setError(null);

    try {
      const apiResponse = await fetch(`${API_BASE_URL}/infra/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({
          command,
          context: context.trim() || undefined,
          execute,
          kubeconfig_path: kubeconfigPath.trim() || undefined,
          namespace: namespace.trim() || "production",
        }),
      });
      const payload: unknown = await apiResponse.json();

      if (!apiResponse.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Could not run the infrastructure command."),
        );
      }

      setResponse(payload as InfraCommandResponse);
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Could not run the infrastructure command.",
      );
    } finally {
      setPendingMode(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitCommand(false);
  }

  const ActionIcon = response ? actionIcons[response.plan.action] : Terminal;

  return (
    <section id="plain-english-infra" className="mt-5 rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
              <Bot className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase text-cyan-200">
                Plain English Infra
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">
                Command infrastructure with natural language
              </h2>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#07090b] px-4 py-3 text-sm text-zinc-300">
          <span className="mr-2 inline-block size-2 rounded-full bg-cyan-300" />
          {roleLabel}
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-zinc-100">
            Command
            <textarea
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setError(null);
              }}
              rows={4}
              className="w-full resize-none rounded-md border border-white/10 bg-[#07090b] px-4 py-3 text-sm font-normal leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {examples.map((example, index) => (
              <button
                key={`${index}:${example}`}
                type="button"
                onClick={() => {
                  setCommand(example);
                  setError(null);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                {example}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
              Namespace
              <input
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
                className="h-11 w-full rounded-md border border-white/10 bg-[#07090b] px-3 font-mono text-sm font-normal text-zinc-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
              Context
              <input
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="Current"
                className="h-11 w-full rounded-md border border-white/10 bg-[#07090b] px-3 font-mono text-sm font-normal text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
              Kubeconfig
              <input
                value={kubeconfigPath}
                onChange={(event) => setKubeconfigPath(event.target.value)}
                placeholder="Default"
                className="h-11 w-full rounded-md border border-white/10 bg-[#07090b] px-3 font-mono text-sm font-normal text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="submit"
              disabled={Boolean(pendingMode)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingMode === "preview" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Bot className="size-4" aria-hidden="true" />
              )}
              Preview Plan
            </button>
            <button
              type="button"
              onClick={() => submitCommand(true)}
              disabled={Boolean(pendingMode) || !canExecute}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingMode === "executed" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : canExecute ? (
                <Play className="size-4" aria-hidden="true" />
              ) : (
                <Lock className="size-4" aria-hidden="true" />
              )}
              Execute Action
            </button>
          </div>

          {!canExecute ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{roleLabel} can preview commands. Admin or DevOps Engineer access can execute them.</p>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-50">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}
        </form>

        <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Interpreter
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {response ? formatActionValue(response.plan.action) : "Awaiting command"}
              </h3>
            </div>
            {response ? (
              <span className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold uppercase ${modeClasses(response.mode)}`}>
                {response.mode}
              </span>
            ) : (
              <CloudCog className="size-5 text-cyan-200" aria-hidden="true" />
            )}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-semibold uppercase text-zinc-500">Action</p>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
                <ActionIcon className="size-4 text-cyan-200" aria-hidden="true" />
                {response ? formatActionValue(response.plan.action) : "Pending"}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-semibold uppercase text-zinc-500">Target</p>
              <p className="mt-2 break-all font-mono text-sm text-white">
                {response
                  ? `${response.plan.namespace}/${response.plan.target}`
                  : "pending"}
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-semibold uppercase text-zinc-500">Confidence</p>
              <p className="mt-2 font-mono text-sm text-white">
                {response ? formatConfidence(response.plan.confidence) : "0%"}
              </p>
            </div>
          </div>

          {response ? (
            <div className="mt-4 rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-semibold uppercase text-zinc-500">
                Reasoning
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {response.plan.reasoning}
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3">
            {response?.actions.map((action) => {
              const ResultIcon = actionIcons[action.action];

              return (
                <article
                  key={`${action.action}:${action.target}:${action.completed_at}`}
                  className="rounded-lg border border-white/10 bg-[#101618] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ResultIcon className="size-4 text-lime-200" aria-hidden="true" />
                        <p className="font-semibold text-white">
                          {formatActionValue(action.action)}
                        </p>
                      </div>
                      <p className="mt-2 break-all font-mono text-xs text-zinc-500">
                        {action.target}
                      </p>
                    </div>
                    <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold uppercase ${statusClasses[action.status]}`}>
                      {action.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-300">
                    {action.message}
                  </p>
                  {action.pod_names.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {action.pod_names.map((podName, index) => (
                        <span
                          key={`${index}:${podName}`}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-zinc-300"
                        >
                          {podName}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {response ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              <CheckCircle2 className="size-4 text-emerald-200" aria-hidden="true" />
              <span>{response.message}</span>
              <span className="text-zinc-700">/</span>
              <Server className="size-4 text-cyan-200" aria-hidden="true" />
              <span>{response.context ?? "current context"}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
