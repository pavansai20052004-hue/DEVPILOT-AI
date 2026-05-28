"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Lock,
  Loader2,
  RotateCw,
  Server,
  Undo2,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { subscribeToDemoRuns } from "@/lib/demo-mode";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

type KubernetesContainerStatus = {
  name: string;
  ready: boolean;
  restart_count: number;
  state: string;
  reason?: string | null;
};

type KubernetesPodStatus = {
  namespace: string;
  name: string;
  phase: string;
  ready: boolean;
  restart_count: number;
  node_name?: string | null;
  owner_kind?: string | null;
  owner_name?: string | null;
  deployment_name?: string | null;
  unhealthy: boolean;
  reasons: string[];
  containers: KubernetesContainerStatus[];
};

type KubernetesClusterStatus = {
  context?: string | null;
  namespaces: string[];
  pods: KubernetesPodStatus[];
  unhealthy_pods: KubernetesPodStatus[];
  checked_at: string;
};

type KubernetesActionResult = {
  message: string;
  namespace: string;
  pod_name?: string | null;
  deployment_name?: string | null;
  action: "restart_pod" | "rollback_deployment";
  completed_at: string;
};



function podStatusClasses(unhealthy: boolean) {
  return unhealthy
    ? "border-red-300/25 bg-red-300/10 text-red-100"
    : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
}

function buildDemoClusterStatus(): KubernetesClusterStatus {
  const checkedAt = new Date().toISOString();

  return {
    context: "devpilot-demo",
    namespaces: ["default", "production", "staging"],
    checked_at: checkedAt,
    pods: [
      {
        namespace: "production",
        name: "api-7f9d8c6b5d-crashloop",
        phase: "Running",
        ready: false,
        restart_count: 6,
        node_name: "demo-node-a",
        owner_kind: "ReplicaSet",
        owner_name: "api-7f9d8c6b5d",
        deployment_name: "api",
        unhealthy: true,
        reasons: [
          "Container api is waiting: CrashLoopBackOff",
          "Readiness probe failed after release 9f31c2a",
        ],
        containers: [
          {
            name: "api",
            ready: false,
            restart_count: 6,
            state: "waiting",
            reason: "CrashLoopBackOff",
          },
        ],
      },
      {
        namespace: "production",
        name: "worker-54b8c9d7c8-healthy",
        phase: "Running",
        ready: true,
        restart_count: 0,
        node_name: "demo-node-b",
        owner_kind: "ReplicaSet",
        owner_name: "worker-54b8c9d7c8",
        deployment_name: "worker",
        unhealthy: false,
        reasons: [],
        containers: [
          {
            name: "worker",
            ready: true,
            restart_count: 0,
            state: "running",
          },
        ],
      },
      {
        namespace: "staging",
        name: "web-6d4998f6fd-ready",
        phase: "Running",
        ready: true,
        restart_count: 1,
        node_name: "demo-node-c",
        owner_kind: "ReplicaSet",
        owner_name: "web-6d4998f6fd",
        deployment_name: "web",
        unhealthy: false,
        reasons: [],
        containers: [
          {
            name: "web",
            ready: true,
            restart_count: 1,
            state: "running",
          },
        ],
      },
    ],
    unhealthy_pods: [],
  };
}

export function KubernetesClusterPanel() {
  const { role, can, roleLabel } = useRole();
  const [kubeconfigPath, setKubeconfigPath] = useState("");
  const [context, setContext] = useState("");
  const [clusterStatus, setClusterStatus] = useState<KubernetesClusterStatus | null>(
    null,
  );
  const [actionResult, setActionResult] = useState<KubernetesActionResult | null>(
    null,
  );
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usingDemoCluster, setUsingDemoCluster] = useState(false);
  const canRecoverCluster = can("recover_cluster");

  function loadDemoCluster(message = "Demo cluster loaded.") {
    const demoStatus = buildDemoClusterStatus();
    setClusterStatus({
      ...demoStatus,
      unhealthy_pods: demoStatus.pods.filter((pod) => pod.unhealthy),
    });
    setContext("devpilot-demo");
    setActionResult(null);
    setError(null);
    setNotice(message);
    setUsingDemoCluster(true);
  }

  useEffect(
    () =>
      subscribeToDemoRuns((payload) => {
        setKubeconfigPath("");
        setContext(payload.cluster_status.context ?? "devpilot-demo");
        setClusterStatus(payload.cluster_status);
        setActionResult(null);
        setError(null);
        setNotice("Demo run cluster status is loaded.");
        setUsingDemoCluster(true);
        setIsLoadingStatus(false);
        setPendingAction(null);
      }),
    [],
  );

  const sortedPods = useMemo(() => {
    if (!clusterStatus) {
      return [];
    }

    return [...clusterStatus.pods].sort((left, right) => {
      if (left.unhealthy !== right.unhealthy) {
        return left.unhealthy ? -1 : 1;
      }

      return `${left.namespace}/${left.name}`.localeCompare(
        `${right.namespace}/${right.name}`,
      );
    });
  }, [clusterStatus]);

  const connectionPayload = {
    kubeconfig_path: kubeconfigPath.trim() || undefined,
    context: context.trim() || undefined,
  };

  async function fetchClusterStatus(resetActionResult = true) {
    setIsLoadingStatus(true);
    setError(null);
    if (resetActionResult) {
      setActionResult(null);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/kubernetes/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(connectionPayload),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Cluster status failed."));
      }

      setClusterStatus(payload as KubernetesClusterStatus);
      setUsingDemoCluster(false);
      setNotice(null);
    } catch (statusError) {
      const message =
        statusError instanceof Error
          ? statusError.message
          : "Could not reach the Kubernetes API.";

      if (!connectionPayload.kubeconfig_path && /kubeconfig/i.test(message)) {
        loadDemoCluster(
          "No live kubeconfig is configured, so DevPilot is showing a safe demo cluster. Set KUBECONFIG_B64 or KUBECONFIG_CONTENT in Render for production, or add a kubeconfig path for local checks.",
        );
      } else {
        setError(message);
        setNotice(null);
      }
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function handleStatusSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await fetchClusterStatus();
  }

  async function runAction(
    endpoint: "restart-pod" | "rollback-deployment",
    pod: KubernetesPodStatus,
  ) {
    if (!canRecoverCluster) {
      setError("Manual Kubernetes recovery requires the Admin or DevOps Engineer role.");
      return;
    }

    const actionKey = `${endpoint}:${pod.namespace}:${pod.name}`;
    setPendingAction(actionKey);
    setError(null);
    setActionResult(null);

    if (usingDemoCluster) {
      window.setTimeout(() => {
        setClusterStatus((currentStatus) => {
          if (!currentStatus) {
            return currentStatus;
          }

          const pods = currentStatus.pods.map((currentPod) =>
            currentPod.namespace === pod.namespace && currentPod.name === pod.name
              ? {
                  ...currentPod,
                  phase: "Running",
                  ready: true,
                  restart_count:
                    endpoint === "restart-pod"
                      ? currentPod.restart_count + 1
                      : currentPod.restart_count,
                  unhealthy: false,
                  reasons: [],
                  containers: currentPod.containers.map((container) => ({
                    ...container,
                    ready: true,
                    state: "running",
                    reason: null,
                  })),
                }
              : currentPod,
          );

          return {
            ...currentStatus,
            pods,
            unhealthy_pods: pods.filter((currentPod) => currentPod.unhealthy),
            checked_at: new Date().toISOString(),
          };
        });
        setActionResult({
          message:
            endpoint === "restart-pod"
              ? `Demo restart completed for ${pod.namespace}/${pod.name}.`
              : `Demo rollback completed for ${pod.namespace}/${pod.deployment_name}.`,
          namespace: pod.namespace,
          pod_name: endpoint === "restart-pod" ? pod.name : null,
          deployment_name:
            endpoint === "rollback-deployment" ? pod.deployment_name : null,
          action:
            endpoint === "restart-pod"
              ? "restart_pod"
              : "rollback_deployment",
          completed_at: new Date().toISOString(),
        });
        setNotice("Demo recovery action completed locally. Live mode uses the Render kubeconfig secret or your supplied path.");
        setPendingAction(null);
      }, 550);
      return;
    }

    const actionPayload =
      endpoint === "restart-pod"
        ? {
            ...connectionPayload,
            namespace: pod.namespace,
            pod_name: pod.name,
          }
        : {
            ...connectionPayload,
            namespace: pod.namespace,
            deployment_name: pod.deployment_name,
          };

    try {
      const response = await fetch(`${API_BASE_URL}/kubernetes/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify(actionPayload),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Kubernetes action failed."));
      }

      setActionResult(payload as KubernetesActionResult);
      await fetchClusterStatus(false);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Could not apply the Kubernetes action.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section id="cluster" className="bg-[#07090b] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-sky-200">
            Live Cluster
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Inspect Kubernetes health and trigger recovery actions.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot reads namespaces and pods from kubeconfig, flags unhealthy
            workloads, and sends controlled restart or rollback requests.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="font-mono text-2xl font-semibold text-white">
                {clusterStatus?.namespaces.length ?? 0}
              </p>
              <p className="mt-1 text-sm text-zinc-400">Namespaces</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="font-mono text-2xl font-semibold text-white">
                {clusterStatus?.pods.length ?? 0}
              </p>
              <p className="mt-1 text-sm text-zinc-400">Pods</p>
            </div>
            <div className="rounded-lg border border-red-300/20 bg-red-300/10 p-4">
              <p className="font-mono text-2xl font-semibold text-red-100">
                {clusterStatus?.unhealthy_pods.length ?? 0}
              </p>
              <p className="mt-1 text-sm text-red-100/70">Unhealthy</p>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5">
          <form onSubmit={handleStatusSubmit}>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
              <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
                Kubeconfig
                <input
                  value={kubeconfigPath}
                  onChange={(event) => {
                    setKubeconfigPath(event.target.value);
                    setError(null);
                    setNotice(null);
                    setUsingDemoCluster(false);
                  }}
                  placeholder="Default kubeconfig"
                  className="h-12 w-full min-w-0 rounded-md border border-white/10 bg-[#07090b] px-4 font-mono text-sm font-normal text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
                />
              </label>
              <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
                Context
                <input
                  value={context}
                  onChange={(event) => {
                    setContext(event.target.value);
                    setError(null);
                    setNotice(null);
                    setUsingDemoCluster(false);
                  }}
                  placeholder="Current"
                  className="h-12 w-full min-w-0 rounded-md border border-white/10 bg-[#07090b] px-4 font-mono text-sm font-normal text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="submit"
                disabled={isLoadingStatus || Boolean(pendingAction)}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-sky-300/40 bg-sky-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(125,211,252,0.16)] transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingStatus ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Server className="size-4" aria-hidden="true" />
                )}
                Check Cluster
              </button>
              <button
                type="button"
                onClick={() => loadDemoCluster()}
                disabled={isLoadingStatus || Boolean(pendingAction)}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-5 text-sm font-semibold text-zinc-100 transition hover:border-sky-300/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Boxes className="size-4" aria-hidden="true" />
                Load Demo Cluster
              </button>
            </div>
          </form>

          {notice ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-sky-300/25 bg-sky-300/10 px-4 py-3 text-sm text-sky-50">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-sky-200"
                aria-hidden="true"
              />
              <p>{notice}</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          {actionResult ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-emerald-200"
                aria-hidden="true"
              />
              <p>{actionResult.message}</p>
            </div>
          ) : null}

          {!canRecoverCluster ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {roleLabel} can inspect cluster health, but restart and rollback
                actions require Admin or DevOps Engineer access.
              </p>
            </div>
          ) : null}

          {clusterStatus ? (
            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <Boxes className="size-4 text-sky-200" aria-hidden="true" />
                  Cluster Status
                </div>
                <span className="rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-zinc-300">
                  {clusterStatus.context ?? "current-context"}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {clusterStatus.namespaces.map((namespace) => (
                  <span
                    key={namespace}
                    className="rounded-md border border-sky-200/20 bg-sky-300/10 px-3 py-2 font-mono text-xs text-sky-100"
                  >
                    {namespace}
                  </span>
                ))}
              </div>

              <div className="mt-5 grid gap-3">
                {sortedPods.map((pod) => {
                  const restartKey = `restart-pod:${pod.namespace}:${pod.name}`;
                  const rollbackKey = `rollback-deployment:${pod.namespace}:${pod.name}`;
                  const canRollback = Boolean(pod.deployment_name);

                  return (
                    <article
                      key={`${pod.namespace}/${pod.name}`}
                      className={`rounded-lg border p-4 ${podStatusClasses(
                        pod.unhealthy,
                      )}`}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-current/25 px-2 py-1 font-mono text-xs">
                              {pod.namespace}
                            </span>
                            <p className="break-all font-semibold text-white">
                              {pod.name}
                            </p>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-300">
                            <span>{pod.phase}</span>
                            <span>{pod.ready ? "ready" : "not ready"}</span>
                            <span>{pod.restart_count} restarts</span>
                            {pod.deployment_name ? (
                              <span>deployment/{pod.deployment_name}</span>
                            ) : null}
                          </div>
                          {pod.reasons.length ? (
                            <div className="mt-3 grid gap-1 text-sm leading-6">
                              {pod.reasons.map((reason, index) => (
                                <p key={`${index}:${reason}`}>{reason}</p>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="grid shrink-0 grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => runAction("restart-pod", pod)}
                            disabled={
                              !canRecoverCluster ||
                              Boolean(pendingAction) ||
                              isLoadingStatus
                            }
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-sky-300/35 bg-sky-300 px-3 text-xs font-semibold text-zinc-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pendingAction === restartKey ? (
                              <Loader2
                                className="size-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <RotateCw className="size-4" aria-hidden="true" />
                            )}
                            Restart Pod
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction("rollback-deployment", pod)}
                            disabled={
                              !canRecoverCluster ||
                              !canRollback ||
                              Boolean(pendingAction) ||
                              isLoadingStatus
                            }
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-300/35 bg-amber-300 px-3 text-xs font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {pendingAction === rollbackKey ? (
                              <Loader2
                                className="size-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Undo2 className="size-4" aria-hidden="true" />
                            )}
                            Rollback
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
