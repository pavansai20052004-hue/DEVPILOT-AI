"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "@/lib/api-client";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cloud,
  Database,
  RotateCw,
  Server,
  ShieldCheck,
  Wifi,
  Zap,
} from "lucide-react";

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

type AutonomousActionLogRecord = {
  id: string;
  cycle_id: string;
  incident_id?: string | null;
  action_type: string;
  target: string;
  status: string;
  detail: string;
  created_at: string;
};

type AutonomousAgentStatusResponse = {
  recent_actions: AutonomousActionLogRecord[];
};

type TwinStatus = "healthy" | "warning" | "failing" | "healing";
type TwinPhase = "healthy" | "warning" | "failing" | "healing" | "recovered";

type TwinPod = {
  id: string;
  namespace: string;
  name: string;
  serviceId: string;
  node: string;
  status: TwinStatus;
  ready: boolean;
  restarts: number;
  reason: string;
};

type TwinService = {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  status: TwinStatus;
  podCount: number;
  icon: typeof Server;
};

type TwinRoute = {
  id: string;
  from: string;
  to: string;
  label: string;
  status: TwinStatus;
};

const LIVE_KUBERNETES_TWIN_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LIVE_K8S_TWIN === "true";

const twinPhases: TwinPhase[] = [
  "healthy",
  "warning",
  "failing",
  "healing",
  "recovered",
];

const serviceBlueprints = [
  {
    id: "edge",
    label: "Ingress",
    kind: "Gateway",
    x: 110,
    y: 260,
    icon: Cloud,
  },
  {
    id: "api",
    label: "API Service",
    kind: "Deployment",
    x: 365,
    y: 155,
    icon: Server,
  },
  {
    id: "worker",
    label: "Worker Queue",
    kind: "Deployment",
    x: 365,
    y: 365,
    icon: Boxes,
  },
  {
    id: "database",
    label: "Postgres",
    kind: "StatefulSet",
    x: 740,
    y: 155,
    icon: Database,
  },
  {
    id: "redis",
    label: "Redis",
    kind: "Cache",
    x: 740,
    y: 365,
    icon: Zap,
  },
  {
    id: "autoheal",
    label: "Auto Heal",
    kind: "Agent",
    x: 555,
    y: 260,
    icon: ShieldCheck,
  },
];

const routeBlueprints = [
  { id: "edge-api", from: "edge", to: "api", label: "HTTP" },
  { id: "api-db", from: "api", to: "database", label: "SQL" },
  { id: "api-cache", from: "api", to: "redis", label: "Cache" },
  { id: "worker-cache", from: "worker", to: "redis", label: "Jobs" },
  { id: "heal-api", from: "autoheal", to: "api", label: "Rollback" },
  { id: "heal-worker", from: "autoheal", to: "worker", label: "Restart" },
];

const serviceStatusRank: Record<TwinStatus, number> = {
  healthy: 0,
  warning: 1,
  healing: 2,
  failing: 3,
};

const statusLabels: Record<TwinStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  failing: "Failing",
  healing: "Healing",
};

function statusFromPod(pod: KubernetesPodStatus): TwinStatus {
  if (pod.unhealthy) {
    return pod.reasons.some((reason) =>
      /terminating|creating|starting|pending|progress/i.test(reason),
    )
      ? "healing"
      : "failing";
  }

  if (!pod.ready || pod.restart_count > 2) {
    return "warning";
  }

  return "healthy";
}

function serviceIdForPod(pod: KubernetesPodStatus) {
  const signal = [
    pod.name,
    pod.deployment_name,
    pod.owner_name,
    ...pod.containers.map((container) => container.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/redis|cache/.test(signal)) {
    return "redis";
  }

  if (/postgres|mysql|maria|mongo|database|db/.test(signal)) {
    return "database";
  }

  if (/worker|queue|job|consumer/.test(signal)) {
    return "worker";
  }

  return "api";
}

function mapLivePods(cluster: KubernetesClusterStatus): TwinPod[] {
  return cluster.pods.map((pod) => {
    const serviceId = serviceIdForPod(pod);
    const reason =
      pod.reasons[0] ??
      pod.containers.find((container) => container.reason)?.reason ??
      (pod.ready ? "Ready" : "Waiting for readiness");

    return {
      id: `${pod.namespace}/${pod.name}`,
      namespace: pod.namespace,
      name: pod.name,
      serviceId,
      node: pod.node_name ?? pod.deployment_name ?? "cluster-node",
      status: statusFromPod(pod),
      ready: pod.ready,
      restarts: pod.restart_count,
      reason,
    };
  });
}

function demoPodsForPhase(phase: TwinPhase): TwinPod[] {
  const phaseDetails: Record<
    TwinPhase,
    {
      api: TwinStatus;
      worker: TwinStatus;
      database: TwinStatus;
      redis: TwinStatus;
      apiReason: string;
      workerReason: string;
      dbReason: string;
      redisReason: string;
      apiRestarts: number;
      workerRestarts: number;
    }
  > = {
    healthy: {
      api: "healthy",
      worker: "healthy",
      database: "healthy",
      redis: "healthy",
      apiReason: "Readiness probes passing",
      workerReason: "Queue drain normal",
      dbReason: "Connections stable",
      redisReason: "Cache hit rate stable",
      apiRestarts: 0,
      workerRestarts: 0,
    },
    warning: {
      api: "warning",
      worker: "healthy",
      database: "warning",
      redis: "healthy",
      apiReason: "Latency p95 rising",
      workerReason: "Queue drain normal",
      dbReason: "Connection pool pressure",
      redisReason: "Cache hit rate stable",
      apiRestarts: 1,
      workerRestarts: 0,
    },
    failing: {
      api: "failing",
      worker: "failing",
      database: "warning",
      redis: "healthy",
      apiReason: "CrashLoopBackOff after missing DATABASE_URL",
      workerReason: "ErrImagePull on rollout image",
      dbReason: "Connection attempts rejected",
      redisReason: "Cache accepting traffic",
      apiRestarts: 7,
      workerRestarts: 4,
    },
    healing: {
      api: "healing",
      worker: "healing",
      database: "healthy",
      redis: "healthy",
      apiReason: "Rollback in progress",
      workerReason: "Pod restart warming cache",
      dbReason: "Connections stable",
      redisReason: "Cache accepting traffic",
      apiRestarts: 8,
      workerRestarts: 5,
    },
    recovered: {
      api: "healthy",
      worker: "healthy",
      database: "healthy",
      redis: "healthy",
      apiReason: "Stable ReplicaSet restored",
      workerReason: "Image pull recovered",
      dbReason: "Connections stable",
      redisReason: "Cache hit rate stable",
      apiRestarts: 8,
      workerRestarts: 5,
    },
  };

  const details = phaseDetails[phase];

  return [
    {
      id: "production/api-7f9d8c6b5d-a",
      namespace: "production",
      name: "api-7f9d8c6b5d-a",
      serviceId: "api",
      node: "ip-10-0-4-12",
      status: details.api,
      ready: details.api === "healthy",
      restarts: details.apiRestarts,
      reason: details.apiReason,
    },
    {
      id: "production/api-7f9d8c6b5d-b",
      namespace: "production",
      name: "api-7f9d8c6b5d-b",
      serviceId: "api",
      node: "ip-10-0-4-18",
      status: details.api === "failing" ? "warning" : details.api,
      ready: details.api === "healthy",
      restarts: Math.max(details.apiRestarts - 1, 0),
      reason: details.apiReason,
    },
    {
      id: "production/worker-54b8c9d7c8",
      namespace: "production",
      name: "worker-54b8c9d7c8",
      serviceId: "worker",
      node: "ip-10-0-6-22",
      status: details.worker,
      ready: details.worker === "healthy",
      restarts: details.workerRestarts,
      reason: details.workerReason,
    },
    {
      id: "data/postgres-0",
      namespace: "data",
      name: "postgres-0",
      serviceId: "database",
      node: "ip-10-0-7-09",
      status: details.database,
      ready: details.database !== "failing",
      restarts: 0,
      reason: details.dbReason,
    },
    {
      id: "data/redis-0",
      namespace: "data",
      name: "redis-0",
      serviceId: "redis",
      node: "ip-10-0-7-14",
      status: details.redis,
      ready: true,
      restarts: 0,
      reason: details.redisReason,
    },
  ];
}

function worstStatus(statuses: TwinStatus[]) {
  if (statuses.length === 0) {
    return "healthy";
  }

  return statuses.reduce((worst, status) =>
    serviceStatusRank[status] > serviceStatusRank[worst] ? status : worst,
  );
}

function buildTwinServices(pods: TwinPod[], phase: TwinPhase): TwinService[] {
  return serviceBlueprints.map((service) => {
    const servicePods = pods.filter((pod) => pod.serviceId === service.id);
    let status = worstStatus(servicePods.map((pod) => pod.status));

    if (service.id === "edge") {
      const apiStatus = worstStatus(
        pods.filter((pod) => pod.serviceId === "api").map((pod) => pod.status),
      );
      status = apiStatus === "failing" ? "warning" : apiStatus;
    }

    if (service.id === "autoheal") {
      status =
        phase === "healing"
          ? "healing"
          : pods.some((pod) => pod.status === "failing")
            ? "warning"
            : "healthy";
    }

    return {
      ...service,
      status,
      podCount: servicePods.length,
    };
  });
}

function buildTwinRoutes(services: TwinService[]): TwinRoute[] {
  const serviceById = new Map(services.map((service) => [service.id, service]));

  return routeBlueprints.map((route) => {
    const from = serviceById.get(route.from);
    const to = serviceById.get(route.to);
    const status = worstStatus([from?.status ?? "healthy", to?.status ?? "healthy"]);

    return {
      ...route,
      status,
    };
  });
}

function formatTime(value?: string | null) {
  if (!value) {
    return "pending";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusTone(status: TwinStatus) {
  switch (status) {
    case "failing":
      return "border-rose-300/40 bg-rose-300/12 text-rose-100 shadow-[0_0_28px_rgba(251,113,133,0.18)]";
    case "healing":
      return "border-sky-300/45 bg-sky-300/12 text-sky-100 shadow-[0_0_28px_rgba(125,211,252,0.18)]";
    case "warning":
      return "border-amber-300/45 bg-amber-300/12 text-amber-100 shadow-[0_0_28px_rgba(252,211,77,0.16)]";
    default:
      return "border-emerald-300/35 bg-emerald-300/10 text-emerald-100 shadow-[0_0_28px_rgba(110,231,183,0.12)]";
  }
}

function statusDot(status: TwinStatus) {
  switch (status) {
    case "failing":
      return "bg-rose-300";
    case "healing":
      return "bg-sky-300";
    case "warning":
      return "bg-amber-300";
    default:
      return "bg-emerald-300";
  }
}

function statusStroke(status: TwinStatus) {
  switch (status) {
    case "failing":
      return "#fb7185";
    case "healing":
      return "#7dd3fc";
    case "warning":
      return "#fcd34d";
    default:
      return "#6ee7b7";
  }
}

function serviceById(services: TwinService[], id: string) {
  return services.find((service) => service.id === id);
}

function phaseEvent(phase: TwinPhase) {
  switch (phase) {
    case "warning":
      return "API latency and database pool pressure crossed the warning band.";
    case "failing":
      return "CrashLoopBackOff and image pull failures are active in production.";
    case "healing":
      return "Auto Heal is restarting pods and rolling back the release.";
    case "recovered":
      return "Traffic is back on the stable ReplicaSet.";
    default:
      return "All services are accepting traffic.";
  }
}

function compactActionName(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function TwinMap({
  services,
  routes,
  phase,
}: {
  services: TwinService[];
  routes: TwinRoute[];
  phase: TwinPhase;
}) {
  return (
    <div className="relative min-h-[31rem] overflow-hidden rounded-lg border border-white/10 bg-[#081012]">
      <svg
        viewBox="0 0 860 520"
        role="img"
        aria-label="Infrastructure digital twin map"
        className="absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="route-glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {routes.map((route, index) => {
          const from = serviceById(services, route.from);
          const to = serviceById(services, route.to);

          if (!from || !to) {
            return null;
          }

          const color = statusStroke(route.status);
          const path = `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${
            (from.x + to.x) / 2
          } ${to.y}, ${to.x} ${to.y}`;

          return (
            <g key={route.id}>
              <path
                d={path}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeLinecap="round"
                strokeWidth="12"
              />
              <path
                d={path}
                fill="none"
                filter="url(#route-glow)"
                stroke={color}
                strokeDasharray="8 13"
                strokeLinecap="round"
                strokeOpacity={route.status === "healthy" ? 0.42 : 0.8}
                strokeWidth={route.status === "failing" ? 4.8 : 3.8}
              />
              <circle r={route.status === "failing" ? 6.5 : 5} fill={color}>
                <animateMotion
                  begin={`${index * 0.35}s`}
                  dur={route.status === "failing" ? "1.8s" : "3.6s"}
                  path={path}
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          );
        })}
      </svg>

      <div className="absolute left-5 top-5 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-300">
        prod-us-east-1 / {phase}
      </div>

      {services.map((service) => {
        const Icon = service.icon;
        const left = `${(service.x / 860) * 100}%`;
        const top = `${(service.y / 520) * 100}%`;

        return (
          <div
            key={service.id}
            className={`absolute w-36 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-3 backdrop-blur transition duration-500 ${statusTone(
              service.status,
            )} ${service.status === "failing" || service.status === "healing" ? "animate-pulse" : ""}`}
            style={{ left, top }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-md border border-current/25 bg-black/20">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <span
                className={`size-3 rounded-full ${statusDot(service.status)}`}
                aria-hidden="true"
              />
            </div>
            <p className="mt-3 truncate text-sm font-semibold text-white">
              {service.label}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] uppercase text-current/75">
              <span>{service.kind}</span>
              <span>{statusLabels[service.status]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PodStatusList({ pods }: { pods: TwinPod[] }) {
  return (
    <div className="grid gap-3">
      {pods.map((pod) => (
        <article
          key={pod.id}
          className={`rounded-lg border p-3 transition duration-500 ${statusTone(pod.status)}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all font-mono text-xs text-zinc-400">
                {pod.namespace}
              </p>
              <h3 className="mt-1 break-all text-sm font-semibold text-white">
                {pod.name}
              </h3>
            </div>
            <span className={`mt-1 size-2.5 shrink-0 rounded-full ${statusDot(pod.status)}`} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-zinc-500">Ready</p>
              <p className="mt-1 font-mono text-zinc-100">{pod.ready ? "yes" : "no"}</p>
            </div>
            <div>
              <p className="text-zinc-500">Restarts</p>
              <p className="mt-1 font-mono text-zinc-100">{pod.restarts}</p>
            </div>
            <div>
              <p className="text-zinc-500">Node</p>
              <p className="mt-1 truncate font-mono text-zinc-100">{pod.node}</p>
            </div>
          </div>
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-300">
            {pod.reason}
          </p>
        </article>
      ))}
    </div>
  );
}

export function InfrastructureDigitalTwinPanel() {
  const [tick, setTick] = useState(0);
  const [clusterStatus, setClusterStatus] = useState<KubernetesClusterStatus | null>(
    null,
  );
  const [agentActions, setAgentActions] = useState<AutonomousActionLogRecord[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [source, setSource] = useState<"live" | "simulation">("simulation");

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick((currentTick) => currentTick + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchClusterStatus() {
      try {
        const response = await fetch(`${API_BASE_URL}/kubernetes/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
          cache: "no-store",
        });
        const payload = (await response.json()) as KubernetesClusterStatus;

        if (!response.ok || !Array.isArray(payload.pods) || payload.pods.length === 0) {
          throw new Error("Cluster status is unavailable.");
        }

        if (!isMounted) {
          return;
        }

        setClusterStatus(payload);
        setLastCheckedAt(payload.checked_at);
        setSource("live");
      } catch {
        if (!isMounted) {
          return;
        }

        setSource("simulation");
        setLastCheckedAt(new Date().toISOString());
      }
    }

    async function fetchAgentStatus() {
      try {
        const response = await fetch(`${API_BASE_URL}/agent/status`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as AutonomousAgentStatusResponse;

        if (isMounted && Array.isArray(payload.recent_actions)) {
          setAgentActions(payload.recent_actions.slice(0, 4));
        }
      } catch {
        // The twin keeps running from simulation data when the agent API is absent.
      }
    }

    let clusterInterval: number | undefined;

    if (LIVE_KUBERNETES_TWIN_ENABLED) {
      void fetchClusterStatus();
      clusterInterval = window.setInterval(fetchClusterStatus, 18_000);
    }

    void fetchAgentStatus();
    const agentInterval = window.setInterval(fetchAgentStatus, 9_000);

    return () => {
      isMounted = false;
      if (clusterInterval) {
        window.clearInterval(clusterInterval);
      }
      window.clearInterval(agentInterval);
    };
  }, []);

  const phase = twinPhases[Math.floor(tick / 5) % twinPhases.length];
  const pods = useMemo(
    () =>
      source === "live" && clusterStatus?.pods.length
        ? mapLivePods(clusterStatus)
        : demoPodsForPhase(phase),
    [clusterStatus, phase, source],
  );
  const services = useMemo(() => buildTwinServices(pods, phase), [phase, pods]);
  const routes = useMemo(() => buildTwinRoutes(services), [services]);
  const failingPods = pods.filter((pod) => pod.status === "failing").length;
  const healingPods = pods.filter((pod) => pod.status === "healing").length;
  const healthyPods = pods.filter((pod) => pod.status === "healthy").length;
  const clusterLabel =
    source === "live"
      ? (clusterStatus?.context ?? "current-context")
      : "devpilot-demo";
  const events = [
    {
      id: `phase-${phase}-${tick}`,
      label: phase === "healing" ? "Auto Heal" : phase === "failing" ? "Incident" : "Twin",
      detail: phaseEvent(phase),
      created_at: lastCheckedAt,
    },
    ...agentActions.map((action) => ({
      id: action.id,
      label: compactActionName(action.action_type),
      detail: action.detail,
      created_at: action.created_at,
    })),
  ].slice(0, 5);

  return (
    <section className="mt-5 rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border border-sky-300/30 bg-sky-300/10 text-sky-100">
              <Activity className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase text-sky-200">
                Digital Twin
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">
                Infrastructure map
              </h2>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-300">
            {clusterLabel} is showing {pods.length} pods across {services.length} service
            nodes. Current twin phase: {phase}.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-300">
            <span
              className={`size-2 rounded-full ${source === "live" ? "bg-emerald-300" : "bg-sky-300"}`}
            />
            {source === "live" ? "Live cluster" : "Twin simulation"}
          </span>
          <span className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-zinc-400">
            <Wifi className="size-4 text-cyan-200" aria-hidden="true" />
            {formatTime(lastCheckedAt)}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-4">
          <p className="font-mono text-2xl font-semibold text-white">{healthyPods}</p>
          <p className="mt-1 text-sm text-emerald-100/75">Healthy pods</p>
        </div>
        <div className="rounded-lg border border-rose-300/20 bg-rose-300/8 p-4">
          <p className="font-mono text-2xl font-semibold text-white">{failingPods}</p>
          <p className="mt-1 text-sm text-rose-100/75">Failing pods</p>
        </div>
        <div className="rounded-lg border border-sky-300/20 bg-sky-300/8 p-4">
          <p className="font-mono text-2xl font-semibold text-white">{healingPods}</p>
          <p className="mt-1 text-sm text-sky-100/75">Healing pods</p>
        </div>
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/8 p-4">
          <p className="font-mono text-2xl font-semibold text-white">
            {routes.filter((route) => route.status !== "healthy").length}
          </p>
          <p className="mt-1 text-sm text-amber-100/75">Hot routes</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(21rem,0.65fr)]">
        <TwinMap services={services} routes={routes} phase={phase} />

        <div className="grid gap-5">
          <div className="rounded-lg border border-white/10 bg-[#081012] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-zinc-500">Pods</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Live status</h3>
              </div>
              {failingPods > 0 ? (
                <AlertTriangle className="size-5 text-rose-200" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-5 text-emerald-200" aria-hidden="true" />
              )}
            </div>
            <div className="mt-4 max-h-[31rem] overflow-auto pr-1">
              <PodStatusList pods={pods} />
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#081012] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase text-zinc-500">Events</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Real-time loop</h3>
              </div>
              <RotateCw className="size-5 animate-spin text-sky-200" aria-hidden="true" />
            </div>
            <div className="mt-4 grid gap-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-100">{event.label}</p>
                    <span className="font-mono text-xs text-zinc-500">
                      {formatTime(event.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">
                    {event.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
