export type CloudProvider = "aws" | "azure" | "gcp";

export type DemoCiFailure = {
  provider: string;
  workflow: string;
  job: string;
  step: string;
  branch: string;
  commit_sha: string;
  status: "failed";
  duration_seconds: number;
  failure_summary: string;
  logs: string;
};

export type DemoLogUpload = {
  upload_id: string;
  status: string;
  filename?: string | null;
  source: string;
  line_count: number;
  character_count: number;
  received_at: string;
};

export type DemoLogAnalysis = {
  root_cause: string;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
  recommended_fix: string;
};

export type DemoFixFiles = {
  dockerfile: string;
  kubernetes_yaml: string;
  github_actions_workflow: string;
  cloud_provider: CloudProvider;
  deployment_suggestions: string[];
};

export type DemoKubernetesContainerStatus = {
  name: string;
  ready: boolean;
  restart_count: number;
  state: string;
  reason?: string | null;
};

export type DemoKubernetesPodStatus = {
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
  containers: DemoKubernetesContainerStatus[];
};

export type DemoKubernetesClusterStatus = {
  context?: string | null;
  namespaces: string[];
  pods: DemoKubernetesPodStatus[];
  unhealthy_pods: DemoKubernetesPodStatus[];
  checked_at: string;
};

export type DemoHealAction = {
  action: string;
  target: string;
  status: "simulated";
  detail: string;
};

export type DemoHealResult = {
  message: string;
  actions: DemoHealAction[];
  healed_at: string;
};

export type DemoRunPayload = {
  mode: "demo";
  message: string;
  detected_issue: string;
  sample_logs: string;
  cicd_failures: DemoCiFailure[];
  log_upload: DemoLogUpload;
  analysis: DemoLogAnalysis;
  cluster_status: DemoKubernetesClusterStatus;
  fix_files: DemoFixFiles;
  auto_heal: DemoHealResult;
  incident_records_created: number;
  ran_at: string;
};

export type JudgeModeResult = {
  status: "completed";
  elapsed_ms: number;
  completed_at: string;
  incident: string;
  severity: DemoLogAnalysis["severity"];
  fix: string;
  recovery_actions: number;
  incident_records_created: number;
};

export const demoRunEventName = "devpilot-demo-run";
export const demoRunStorageKey = "devpilot-demo-run-payload";
export const judgeModeStorageKey = "devpilot-judge-mode-result";

function isDemoRunPayload(value: unknown): value is DemoRunPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    (value as { mode?: unknown }).mode === "demo"
  );
}

export function readDemoRunPayload(): DemoRunPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawPayload = window.localStorage.getItem(demoRunStorageKey);
  if (!rawPayload) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(rawPayload);
    return isDemoRunPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function publishDemoRun(payload: DemoRunPayload) {
  window.localStorage.setItem(demoRunStorageKey, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(demoRunEventName, { detail: payload }));
}

export function subscribeToDemoRuns(
  onDemoRun: (payload: DemoRunPayload) => void,
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  function handleCustomEvent(event: Event) {
    const payload = (event as CustomEvent<DemoRunPayload>).detail;
    if (isDemoRunPayload(payload)) {
      onDemoRun(payload);
    }
  }

  function handleStorageEvent(event: StorageEvent) {
    if (event.key !== demoRunStorageKey || !event.newValue) {
      return;
    }

    try {
      const payload: unknown = JSON.parse(event.newValue);
      if (isDemoRunPayload(payload)) {
        onDemoRun(payload);
      }
    } catch {
      return;
    }
  }

  window.addEventListener(demoRunEventName, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(demoRunEventName, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}

function isJudgeModeResult(value: unknown): value is JudgeModeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status?: unknown }).status === "completed" &&
    "elapsed_ms" in value
  );
}

export function readJudgeModeResult(): JudgeModeResult | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawResult = window.localStorage.getItem(judgeModeStorageKey);
  if (!rawResult) {
    return null;
  }

  try {
    const result: unknown = JSON.parse(rawResult);
    return isJudgeModeResult(result) ? result : null;
  } catch {
    return null;
  }
}

export function writeJudgeModeResult(result: JudgeModeResult) {
  window.localStorage.setItem(judgeModeStorageKey, JSON.stringify(result));
}
