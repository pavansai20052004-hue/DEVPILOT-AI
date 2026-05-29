import {
  Activity,
  BrainCircuit,
  Clipboard,
  Gauge,
  GitBranch,
  HeartPulse,
  Network,
  Radar,
  ShieldCheck,
  Zap,
} from "lucide-react";

export const bootLines = [
  "Initializing DevPilot AI...",
  "Connecting to Kubernetes clusters...",
  "Monitoring infrastructure health...",
  "Detecting deployment anomalies...",
  "AI Root Cause Engine Activated...",
  "Auto-Heal Engine Online...",
  "System Ready.",
];

export const incidentFeed = [
  {
    time: "00:01",
    title: "CrashLoopBackOff detected",
    detail: "production/devpilot-api restart count crossed threshold",
    tone: "danger",
  },
  {
    time: "00:03",
    title: "CI deployment failed",
    detail: "DATABASE_URL missing from release environment",
    tone: "danger",
  },
  {
    time: "00:05",
    title: "Terraform drift risk",
    detail: "config map mismatch detected against desired state",
    tone: "warning",
  },
  {
    time: "00:07",
    title: "Revenue exposure estimated",
    detail: "$12.5K protected by automated recovery loop",
    tone: "success",
  },
] as const;

export const analysisCards = [
  {
    label: "Root cause",
    value: "DATABASE_URL missing",
    icon: BrainCircuit,
    meter: "91%",
  },
  {
    label: "Blast radius",
    value: "API pods, checkout path",
    icon: Network,
    meter: "4 services",
  },
  {
    label: "Recovery plan",
    value: "Rollback + config patch",
    icon: ShieldCheck,
    meter: "safe",
  },
];

export const counters = [
  { label: "signals", value: "248", icon: Radar },
  { label: "fix confidence", value: "91%", icon: Gauge },
  { label: "downtime saved", value: "45m", icon: HeartPulse },
];

export const cockpitNavItems = [
  { label: "incidents", icon: Activity },
  { label: "analysis", icon: BrainCircuit },
  { label: "healing", icon: Zap },
  { label: "pull requests", icon: GitBranch },
];

export const recoveryProofs = [
  { label: "approval gate", value: "human review required", icon: Clipboard },
  { label: "health probe", value: "/ready returned 200 OK", icon: HeartPulse },
  {
    label: "incident memory",
    value: "recovery saved to timeline",
    icon: BrainCircuit,
  },
];

export const codeOutput = [
  "kubectl rollout undo deployment/devpilot-api -n production",
  "patch configmap devpilot-api-config --from approved-plan",
  "verify /ready -> 200 OK",
  "write incident memory -> recovered",
].join("\n");

export const timeline = [
  "boot",
  "brand",
  "alerts",
  "analysis",
  "heal",
  "cockpit",
] as const;

export type TimelineStage = (typeof timeline)[number];
export type Incident = (typeof incidentFeed)[number];

export const networkNodes = [
  { id: "api", x: 48, y: 18, label: "api" },
  { id: "k8s", x: 72, y: 42, label: "k8s" },
  { id: "db", x: 58, y: 72, label: "db" },
  { id: "git", x: 28, y: 62, label: "git" },
  { id: "logs", x: 22, y: 30, label: "logs" },
];

export function stageIndex(stage: TimelineStage) {
  return timeline.indexOf(stage);
}
