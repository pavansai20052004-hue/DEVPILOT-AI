"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  Building2,
  CheckCircle2,
  CloudCog,
  DatabaseZap,
  GitBranch,
  Globe2,
  Lock,
  MapPinned,
  RadioTower,
  Scale3d,
  ServerCog,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useRole } from "@/components/role-provider";

type TeamStatus = "healthy" | "watch" | "critical";
type ClusterStatus = "healthy" | "degraded" | "maintenance";
type RegionStatus = "primary" | "standby" | "degraded";
type CommandType = "sync" | "scale" | "failover" | "lockdown";

type EnterpriseTeam = {
  id: string;
  name: string;
  owner: string;
  services: number;
  clusters: string[];
  regions: string[];
  incidents: number;
  budget: string;
  status: TeamStatus;
};

type EnterpriseCluster = {
  id: string;
  name: string;
  provider: "AWS" | "Azure" | "GCP";
  region: string;
  teamId: string;
  nodes: number;
  workloads: number;
  health: number;
  status: ClusterStatus;
};

type EnterpriseRegion = {
  id: string;
  label: string;
  geography: string;
  latency: string;
  capacity: number;
  clusters: number;
  status: RegionStatus;
};

type CommandLogEntry = {
  id: string;
  command: CommandType;
  teamName: string;
  clusterName: string;
  regionName: string;
  createdAt: string;
};

const teams: EnterpriseTeam[] = [
  {
    id: "platform",
    name: "Platform Reliability",
    owner: "Nina Patel",
    services: 42,
    clusters: ["prod-us-east", "prod-eu-west", "shared-tools"],
    regions: ["us-east-1", "eu-west-1"],
    incidents: 1,
    budget: "$186k",
    status: "watch",
  },
  {
    id: "payments",
    name: "Payments",
    owner: "Marcus Lee",
    services: 28,
    clusters: ["payments-primary", "payments-dr"],
    regions: ["us-east-1", "us-west-2"],
    incidents: 0,
    budget: "$141k",
    status: "healthy",
  },
  {
    id: "ai-ops",
    name: "AI Operations",
    owner: "Amara Singh",
    services: 19,
    clusters: ["gpu-control", "vector-search"],
    regions: ["us-west-2", "ap-south-1"],
    incidents: 2,
    budget: "$214k",
    status: "critical",
  },
  {
    id: "data",
    name: "Data Platform",
    owner: "Jon Bell",
    services: 34,
    clusters: ["warehouse-prod", "streaming-prod"],
    regions: ["eu-west-1", "ap-south-1"],
    incidents: 0,
    budget: "$163k",
    status: "healthy",
  },
];

const clusters: EnterpriseCluster[] = [
  {
    id: "prod-us-east",
    name: "prod-us-east",
    provider: "AWS",
    region: "us-east-1",
    teamId: "platform",
    nodes: 38,
    workloads: 214,
    health: 93,
    status: "healthy",
  },
  {
    id: "payments-primary",
    name: "payments-primary",
    provider: "AWS",
    region: "us-east-1",
    teamId: "payments",
    nodes: 24,
    workloads: 136,
    health: 98,
    status: "healthy",
  },
  {
    id: "prod-eu-west",
    name: "prod-eu-west",
    provider: "Azure",
    region: "eu-west-1",
    teamId: "platform",
    nodes: 29,
    workloads: 161,
    health: 88,
    status: "degraded",
  },
  {
    id: "gpu-control",
    name: "gpu-control",
    provider: "GCP",
    region: "us-west-2",
    teamId: "ai-ops",
    nodes: 18,
    workloads: 72,
    health: 76,
    status: "degraded",
  },
  {
    id: "warehouse-prod",
    name: "warehouse-prod",
    provider: "Azure",
    region: "eu-west-1",
    teamId: "data",
    nodes: 21,
    workloads: 96,
    health: 95,
    status: "healthy",
  },
  {
    id: "payments-dr",
    name: "payments-dr",
    provider: "AWS",
    region: "us-west-2",
    teamId: "payments",
    nodes: 12,
    workloads: 48,
    health: 91,
    status: "maintenance",
  },
  {
    id: "vector-search",
    name: "vector-search",
    provider: "GCP",
    region: "ap-south-1",
    teamId: "ai-ops",
    nodes: 16,
    workloads: 84,
    health: 82,
    status: "degraded",
  },
  {
    id: "streaming-prod",
    name: "streaming-prod",
    provider: "Azure",
    region: "ap-south-1",
    teamId: "data",
    nodes: 20,
    workloads: 112,
    health: 97,
    status: "healthy",
  },
];

const regions: EnterpriseRegion[] = [
  {
    id: "us-east-1",
    label: "US East",
    geography: "Virginia",
    latency: "24 ms",
    capacity: 81,
    clusters: 2,
    status: "primary",
  },
  {
    id: "us-west-2",
    label: "US West",
    geography: "Oregon",
    latency: "39 ms",
    capacity: 64,
    clusters: 2,
    status: "standby",
  },
  {
    id: "eu-west-1",
    label: "EU West",
    geography: "Ireland",
    latency: "58 ms",
    capacity: 73,
    clusters: 2,
    status: "degraded",
  },
  {
    id: "ap-south-1",
    label: "AP South",
    geography: "Mumbai",
    latency: "71 ms",
    capacity: 69,
    clusters: 2,
    status: "standby",
  },
];

const commandLabels: Record<CommandType, string> = {
  sync: "Sync Policy",
  scale: "Scale Fleet",
  failover: "Failover",
  lockdown: "Lockdown",
};

const statusStyles = {
  healthy: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  watch: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  critical: "border-rose-300/25 bg-rose-300/10 text-rose-100",
  degraded: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  maintenance: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  primary: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  standby: "border-lime-300/25 bg-lime-300/10 text-lime-100",
} satisfies Record<TeamStatus | ClusterStatus | RegionStatus, string>;

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function statusLabel(value: TeamStatus | ClusterStatus | RegionStatus) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function healthBarColor(health: number) {
  if (health >= 92) {
    return "bg-emerald-300";
  }

  if (health >= 84) {
    return "bg-amber-200";
  }

  return "bg-rose-300";
}

function commandTone(command: CommandType) {
  const tones: Record<CommandType, string> = {
    sync: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
    scale: "border-lime-300/30 bg-lime-300/10 text-lime-100",
    failover: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    lockdown: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  };

  return tones[command];
}

function EnterpriseMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Building2;
  tone: string;
}) {
  return (
    <article className="rounded-lg border border-white/10 bg-[#111719] p-5 shadow-2xl shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-400">{label}</p>
          <p className="mt-3 break-words font-mono text-3xl font-semibold tracking-normal text-white">
            {value}
          </p>
        </div>
        <div className={`grid size-11 shrink-0 place-items-center rounded-md border ${tone}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-4 min-h-10 text-sm leading-5 text-zinc-400">{detail}</p>
    </article>
  );
}

function StatusBadge({ status }: { status: TeamStatus | ClusterStatus | RegionStatus }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${statusStyles[status]}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function EnterpriseCommandCenter() {
  const { can, roleLabel } = useRole();
  const canOperate = can("recover_cluster") && can("patch_terraform");
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0].id);
  const [selectedClusterId, setSelectedClusterId] = useState(clusters[0].id);
  const [activeRegionId, setActiveRegionId] = useState(regions[0].id);
  const [selectedCommand, setSelectedCommand] = useState<CommandType>("sync");
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const selectedCluster =
    clusters.find((cluster) => cluster.id === selectedClusterId) ?? clusters[0];
  const activeRegion = regions.find((region) => region.id === activeRegionId) ?? regions[0];

  const enterpriseStats = useMemo(() => {
    const totalServices = teams.reduce((total, team) => total + team.services, 0);
    const totalNodes = clusters.reduce((total, cluster) => total + cluster.nodes, 0);
    const averageHealth =
      clusters.reduce((total, cluster) => total + cluster.health, 0) / clusters.length;
    const openIncidents = teams.reduce((total, team) => total + team.incidents, 0);

    return {
      totalServices,
      totalNodes,
      averageHealth,
      openIncidents,
    };
  }, []);

  const selectedTeamClusters = useMemo(
    () => clusters.filter((cluster) => cluster.teamId === selectedTeam.id),
    [selectedTeam.id],
  );

  function runCommand() {
    if (!canOperate) {
      return;
    }

    setCommandLog((currentLog) => [
      {
        id: `${Date.now()}-${selectedCommand}`,
        command: selectedCommand,
        teamName: selectedTeam.name,
        clusterName: selectedCluster.name,
        regionName: activeRegion.label,
        createdAt: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...currentLog,
    ].slice(0, 4));
  }

  return (
    <section id="enterprise-command-center" className="mt-8">
      <div className="mb-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            Enterprise Command Center
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            One dashboard for teams, clusters, and regions
          </h2>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#111719] px-4 py-3 text-sm text-zinc-300">
          <span className="mr-2 inline-block size-2 rounded-full bg-cyan-300" />
          Org control plane / {roleLabel}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EnterpriseMetric
          label="Teams managed"
          value={teams.length.toString()}
          detail="Service ownership, escalation, and budget are visible in one view."
          icon={Users}
          tone="border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
        />
        <EnterpriseMetric
          label="Clusters controlled"
          value={clusters.length.toString()}
          detail={`${enterpriseStats.totalNodes} nodes across production and recovery fleets.`}
          icon={Boxes}
          tone="border-lime-300/30 bg-lime-300/10 text-lime-200"
        />
        <EnterpriseMetric
          label="Regions online"
          value={regions.length.toString()}
          detail={`${activeRegion.label} is the active traffic target.`}
          icon={Globe2}
          tone="border-amber-300/30 bg-amber-300/10 text-amber-200"
        />
        <EnterpriseMetric
          label="Fleet health"
          value={formatPercent(enterpriseStats.averageHealth)}
          detail={`${enterpriseStats.totalServices} services / ${enterpriseStats.openIncidents} open incident(s).`}
          icon={ShieldCheck}
          tone="border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
        <section className="rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-lime-200">
                Teams
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Ownership map
              </h3>
            </div>
            <Building2 className="size-5 text-lime-200" aria-hidden="true" />
          </div>

          <div className="mt-5 grid gap-3">
            {teams.map((team) => {
              const isSelected = team.id === selectedTeamId;

              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => {
                    setSelectedTeamId(team.id);
                    const firstTeamCluster = clusters.find(
                      (cluster) => cluster.teamId === team.id,
                    );
                    if (firstTeamCluster) {
                      setSelectedClusterId(firstTeamCluster.id);
                      setActiveRegionId(firstTeamCluster.region);
                    }
                  }}
                  className={`rounded-lg border p-4 text-left transition ${
                    isSelected
                      ? "border-cyan-300/60 bg-cyan-300/10"
                      : "border-white/10 bg-[#07090b] hover:border-white/20"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-base font-semibold text-white">
                        {team.name}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">{team.owner}</p>
                    </div>
                    <StatusBadge status={team.status} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-zinc-400">
                    <span>
                      <span className="block font-mono text-lg text-zinc-100">
                        {team.services}
                      </span>
                      Services
                    </span>
                    <span>
                      <span className="block font-mono text-lg text-zinc-100">
                        {team.clusters.length}
                      </span>
                      Clusters
                    </span>
                    <span>
                      <span className="block font-mono text-lg text-zinc-100">
                        {team.budget}
                      </span>
                      Spend
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="text-sm font-semibold uppercase text-cyan-200">
                Control Plane
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                {selectedTeam.name}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {selectedTeam.services} services across{" "}
                {selectedTeam.regions.join(", ")}
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-[#07090b] px-3 py-2 text-sm text-zinc-300">
              Owner: {selectedTeam.owner}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.86fr]">
            <div className="grid gap-3">
              {selectedTeamClusters.map((cluster) => {
                const isSelected = cluster.id === selectedClusterId;

                return (
                  <button
                    key={cluster.id}
                    type="button"
                    onClick={() => {
                      setSelectedClusterId(cluster.id);
                      setActiveRegionId(cluster.region);
                    }}
                    className={`rounded-lg border p-4 text-left transition ${
                      isSelected
                        ? "border-lime-300/60 bg-lime-300/10"
                        : "border-white/10 bg-[#07090b] hover:border-white/20"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <ServerCog className="size-4 text-sky-200" aria-hidden="true" />
                          <p className="break-all font-semibold text-white">
                            {cluster.name}
                          </p>
                        </div>
                        <p className="mt-2 text-sm text-zinc-400">
                          {cluster.provider} / {cluster.region}
                        </p>
                      </div>
                      <StatusBadge status={cluster.status} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3 text-xs text-zinc-400">
                      <span>{cluster.nodes} nodes</span>
                      <span>{cluster.workloads} workloads</span>
                      <span>{formatPercent(cluster.health)} health</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${healthBarColor(cluster.health)}`}
                        style={{ width: `${cluster.health}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-lg border border-white/10 bg-[#07090b] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Command
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {selectedCluster.name}
                  </p>
                </div>
                <CloudCog className="size-5 text-cyan-200" aria-hidden="true" />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {(
                  [
                    ["sync", GitBranch],
                    ["scale", Scale3d],
                    ["failover", ArrowRightLeft],
                    ["lockdown", Lock],
                  ] as const
                ).map(([command, Icon]) => {
                  const isActive = command === selectedCommand;

                  return (
                    <button
                      key={command}
                      type="button"
                      onClick={() => setSelectedCommand(command)}
                      className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                        isActive
                          ? commandTone(command)
                          : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20"
                      }`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {commandLabels[command]}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={runCommand}
                disabled={!canOperate}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <DatabaseZap className="size-4" aria-hidden="true" />
                Execute Command
              </button>

              {!canOperate ? (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-3 text-sm text-amber-50">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>{roleLabel} can monitor the enterprise fleet. Admin or DevOps access can execute commands.</p>
                </div>
              ) : null}

              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Command log
                </p>
                <div className="mt-3 grid gap-2">
                  {commandLog.length > 0 ? (
                    commandLog.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs leading-5 text-zinc-300"
                      >
                        <span className="font-semibold text-white">
                          {commandLabels[entry.command]}
                        </span>{" "}
                        / {entry.teamName} / {entry.clusterName} / {entry.regionName}
                        <span className="ml-2 font-mono text-zinc-500">
                          {entry.createdAt}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-zinc-500">
                      No command has been executed in this session.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-lg border border-white/10 bg-[#101618] p-5 shadow-2xl shadow-black/20">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase text-amber-200">
              Multi-Region
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              Traffic and recovery posture
            </h3>
          </div>
          <div className="inline-flex flex-wrap gap-2 rounded-lg border border-white/10 bg-[#07090b] p-2">
            {regions.map((region) => {
              const isActive = region.id === activeRegionId;

              return (
                <button
                  key={region.id}
                  type="button"
                  onClick={() => setActiveRegionId(region.id)}
                  className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                    isActive
                      ? "border-amber-300/50 bg-amber-300/15 text-amber-100"
                      : "border-transparent text-zinc-400 hover:border-white/10 hover:text-zinc-200"
                  }`}
                >
                  <RadioTower className="size-4" aria-hidden="true" />
                  {region.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {regions.map((region) => {
            const isActive = region.id === activeRegionId;

            return (
              <article
                key={region.id}
                className={`rounded-lg border p-4 transition ${
                  isActive
                    ? "border-amber-300/50 bg-amber-300/10"
                    : "border-white/10 bg-[#07090b]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <MapPinned className="size-4 text-amber-200" aria-hidden="true" />
                      <p className="font-semibold text-white">{region.label}</p>
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">{region.geography}</p>
                  </div>
                  <StatusBadge status={region.status} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-zinc-400">
                  <span>
                    <span className="block font-mono text-lg text-white">
                      {region.latency}
                    </span>
                    Latency
                  </span>
                  <span>
                    <span className="block font-mono text-lg text-white">
                      {region.clusters}
                    </span>
                    Clusters
                  </span>
                  <span>
                    <span className="block font-mono text-lg text-white">
                      {formatPercent(region.capacity)}
                    </span>
                    Capacity
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-amber-200"
                    style={{ width: `${region.capacity}%` }}
                  />
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 md:grid-cols-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-200" aria-hidden="true" />
            <div>
              <p className="font-semibold text-white">Global policy synced</p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                RBAC, image policy, and drift rules are aligned across regions.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Activity className="mt-1 size-5 shrink-0 text-cyan-200" aria-hidden="true" />
            <div>
              <p className="font-semibold text-white">Live capacity routing</p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Traffic target: {activeRegion.label} with {activeRegion.capacity}% headroom.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 size-5 shrink-0 text-lime-200" aria-hidden="true" />
            <div>
              <p className="font-semibold text-white">Recovery path ready</p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Standby clusters can receive failover commands from the same console.
              </p>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
