"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  FileCode2,
  GitPullRequestCreate,
  Lock,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { RetryNotice } from "@/components/retry-notice";
import { apiRequest } from "@/lib/api-client";
import { DemoCiFailure, subscribeToDemoRuns } from "@/lib/demo-mode";
import { devPilotRoleHeaders } from "@/lib/rbac";

type CloudProvider = "aws" | "azure" | "gcp";

type FixFiles = {
  dockerfile: string;
  kubernetes_yaml: string;
  github_actions_workflow: string;
  cloud_provider: CloudProvider;
  deployment_suggestions: string[];
};

type CommittedFixFile = {
  path: string;
  status: "created" | "updated";
  sha?: string | null;
  html_url?: string | null;
};

type PullRequestResult = {
  repository: string;
  pull_request_number: number;
  pull_request_url: string;
  branch_name: string;
  base_branch: string;
  files: CommittedFixFile[];
};

type CreatePullRequestRequest = {
  issue: string;
  cloud_provider: CloudProvider;
  repository?: string;
  base_branch: string;
  files?: FixFiles;
};

const cloudProviders: {
  id: CloudProvider;
  label: string;
  badge: string;
  description: string;
  className: string;
  selectedClassName: string;
}[] = [
  {
    id: "aws",
    label: "AWS",
    badge: "AWS",
    description: "EKS, ECR, IAM OIDC",
    className: "border-amber-200/25 bg-amber-300/8 text-amber-100",
    selectedClassName: "border-amber-200 bg-amber-200 text-zinc-950",
  },
  {
    id: "azure",
    label: "Azure",
    badge: "AZR",
    description: "AKS, ACR, Key Vault",
    className: "border-sky-200/25 bg-sky-300/8 text-sky-100",
    selectedClassName: "border-sky-200 bg-sky-200 text-zinc-950",
  },
  {
    id: "gcp",
    label: "Google Cloud",
    badge: "GCP",
    description: "GKE, Artifact Registry",
    className: "border-emerald-200/25 bg-emerald-300/8 text-emerald-100",
    selectedClassName: "border-emerald-200 bg-emerald-200 text-zinc-950",
  },
];

const generatedFilePreviews: {
  key: keyof Pick<
    FixFiles,
    "dockerfile" | "kubernetes_yaml" | "github_actions_workflow"
  >;
  label: string;
  path: string;
}[] = [
  {
    key: "dockerfile",
    label: "Container",
    path: "Dockerfile",
  },
  {
    key: "kubernetes_yaml",
    label: "Runtime",
    path: "k8s/devpilot-api.yaml",
  },
  {
    key: "github_actions_workflow",
    label: "Pipeline",
    path: ".github/workflows/devpilot-api-ci.yml",
  },
];

function previewContent(content: string) {
  const lines = content.split(/\r?\n/);
  return lines.slice(0, 14).join("\n");
}

function providerMeta(provider: CloudProvider) {
  return cloudProviders.find((cloudProvider) => cloudProvider.id === provider) ?? cloudProviders[0];
}

export function FixPullRequestPanel() {
  const { role, can, roleLabel } = useRole();
  const [issue, setIssue] = useState(
    "Backend deployment is missing production container, Kubernetes service, and CI verification files.",
  );
  const [selectedProvider, setSelectedProvider] = useState<CloudProvider>("aws");
  const [repository, setRepository] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [generatedFiles, setGeneratedFiles] = useState<FixFiles | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestResult | null>(null);
  const [demoCiFailures, setDemoCiFailures] = useState<DemoCiFailure[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<
    "generate" | "pull-request" | null
  >(null);

  const selectedProviderMeta = providerMeta(selectedProvider);
  const generatedProviderMeta = generatedFiles
    ? providerMeta(generatedFiles.cloud_provider)
    : selectedProviderMeta;

  const readyFileCount = useMemo(
    () => (generatedFiles ? generatedFilePreviews.length : 0),
    [generatedFiles],
  );
  const canGenerateFixes = can("generate_fixes");
  const canCreatePullRequests = can("create_pull_requests");

  useEffect(
    () =>
      subscribeToDemoRuns((payload) => {
        setIssue(payload.detected_issue);
        setSelectedProvider(payload.fix_files.cloud_provider);
        setRepository("demo/devpilot-ai");
        setBaseBranch("main");
        setGeneratedFiles(payload.fix_files);
        setDemoCiFailures(payload.cicd_failures);
        setPullRequest(null);
        setError(null);
        setLastFailedAction(null);
        setIsGenerating(false);
        setIsCreatingPr(false);
      }),
    [],
  );

  async function generateFixFiles() {
    const trimmedIssue = issue.trim();

    setError(null);
    setLastFailedAction(null);
    setPullRequest(null);

    if (!trimmedIssue) {
      setError("Enter a detected issue before generating fix files.");
      return;
    }

    if (!canGenerateFixes) {
      setError("Generating remediation files requires Admin or DevOps Engineer access.");
      return;
    }

    setIsGenerating(true);

    try {
      const payload = await apiRequest<FixFiles>("/generate-fix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({
          issue: trimmedIssue,
          cloud_provider: selectedProvider,
        }),
        errorMessage: "Fix generation failed.",
        retries: 1,
      });

      setGeneratedFiles(payload);
    } catch (generateError) {
      setLastFailedAction("generate");
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not reach the fix generation API.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function submitPullRequest() {
    const trimmedIssue = issue.trim();

    setError(null);
    setLastFailedAction(null);
    setPullRequest(null);

    if (!trimmedIssue) {
      setError("Enter a detected issue before creating a pull request.");
      return;
    }

    if (!canCreatePullRequests) {
      setError("Creating pull requests requires Admin or DevOps Engineer access.");
      return;
    }

    setIsCreatingPr(true);

    const requestBody: CreatePullRequestRequest = {
      issue: trimmedIssue,
      cloud_provider: selectedProvider,
      repository: repository.trim() || undefined,
      base_branch: baseBranch.trim() || "main",
      files: generatedFiles ?? undefined,
    };

    try {
      const payload = await apiRequest<PullRequestResult>(
        "/github/create-pull-request",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...devPilotRoleHeaders(role),
          },
          body: JSON.stringify(requestBody),
          errorMessage: "Pull request creation failed.",
          timeoutMs: 25_000,
        },
      );

      setPullRequest(payload);
    } catch (pullRequestError) {
      setLastFailedAction("pull-request");
      setError(
        pullRequestError instanceof Error
          ? pullRequestError.message
          : "Could not reach the GitHub pull request API.",
      );
    } finally {
      setIsCreatingPr(false);
    }
  }

  async function createPullRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPullRequest();
  }

  return (
    <section id="fix-pr" className="bg-[#08100f] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-cyan-200">
            Multi-Cloud Fix PR
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Generate cloud-specific remediation and review it in GitHub.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            Pick a target cloud and DevPilot adapts container registry, managed
            Kubernetes, secret handling, and deployment guidance to that provider.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {cloudProviders.map((provider) => (
              <span
                key={provider.id}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase ${provider.className}`}
              >
                <Cloud className="size-3" aria-hidden="true" />
                {provider.label}
              </span>
            ))}
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="font-mono text-2xl font-semibold text-white">
                {readyFileCount}
              </p>
              <p className="mt-1 text-sm text-zinc-400">Generated files</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <p className="font-mono text-2xl font-semibold text-white">
                {pullRequest ? `#${pullRequest.pull_request_number}` : "Pending"}
              </p>
              <p className="mt-1 text-sm text-zinc-400">Pull request</p>
            </div>
          </div>
        </div>

        <form
          onSubmit={createPullRequest}
          className="min-w-0 rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5"
        >
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Cloud className="size-4 text-cyan-200" aria-hidden="true" />
              Cloud Provider
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {cloudProviders.map((provider) => {
                const selected = selectedProvider === provider.id;

                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(provider.id);
                      setGeneratedFiles(null);
                      setDemoCiFailures([]);
                      setPullRequest(null);
                      setError(null);
                      setLastFailedAction(null);
                    }}
                    className={`min-h-24 rounded-md border px-3 py-3 text-left transition hover:border-cyan-200 ${
                      selected ? provider.selectedClassName : provider.className
                    }`}
                    aria-pressed={selected}
                  >
                    <span className="inline-flex items-center gap-2 text-xs font-bold uppercase">
                      <span className="rounded border border-current/30 px-2 py-1 font-mono">
                        {provider.badge}
                      </span>
                      {provider.label}
                    </span>
                    <span className="mt-3 block text-xs leading-5 opacity-80">
                      {provider.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <label
            htmlFor="detected-issue"
            className="mb-3 mt-5 flex items-center gap-2 text-sm font-semibold text-zinc-100"
          >
            <Sparkles className="size-4 text-cyan-200" aria-hidden="true" />
            Detected Issue
          </label>
          <textarea
            id="detected-issue"
            value={issue}
            onChange={(event) => {
              setIssue(event.target.value);
              setGeneratedFiles(null);
              setDemoCiFailures([]);
              setPullRequest(null);
              setError(null);
              setLastFailedAction(null);
            }}
            placeholder="Paste the root cause, failing check, or incident summary..."
            className="min-h-40 w-full resize-y rounded-md border border-white/10 bg-[#07090b] px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
          />

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
              Repository
              <input
                value={repository}
                onChange={(event) => {
                  setRepository(event.target.value);
                  setPullRequest(null);
                  setError(null);
                  setLastFailedAction(null);
                }}
                placeholder="owner/repo"
                className="h-12 w-full min-w-0 rounded-md border border-white/10 bg-[#07090b] px-4 font-mono text-sm font-normal text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-zinc-100">
              Base
              <input
                value={baseBranch}
                onChange={(event) => {
                  setBaseBranch(event.target.value);
                  setPullRequest(null);
                  setError(null);
                  setLastFailedAction(null);
                }}
                placeholder="main"
                className="h-12 w-full min-w-0 rounded-md border border-white/10 bg-[#07090b] px-4 font-mono text-sm font-normal text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={generateFixFiles}
              disabled={isGenerating || isCreatingPr || !canGenerateFixes}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(103,232,249,0.16)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : !canGenerateFixes ? (
                <Lock className="size-4" aria-hidden="true" />
              ) : (
                <FileCode2 className="size-4" aria-hidden="true" />
              )}
              {canGenerateFixes ? "Generate Files" : "Locked"}
            </button>
            <button
              type="submit"
              disabled={isGenerating || isCreatingPr || !canCreatePullRequests}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(110,231,183,0.16)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreatingPr ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : !canCreatePullRequests ? (
                <Lock className="size-4" aria-hidden="true" />
              ) : (
                <GitPullRequestCreate className="size-4" aria-hidden="true" />
              )}
              {canCreatePullRequests ? "Create PR" : "Locked"}
            </button>
          </div>

          {!canGenerateFixes || !canCreatePullRequests ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {roleLabel} can review this workflow, but remediation generation
                and pull request creation require Admin or DevOps Engineer access.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <RetryNotice
                message={error}
                onRetry={
                  lastFailedAction === "generate"
                    ? generateFixFiles
                    : lastFailedAction === "pull-request"
                      ? submitPullRequest
                      : undefined
                }
                retryLabel={
                  lastFailedAction === "pull-request" ? "Retry PR" : "Retry fix"
                }
              />
            </div>
          ) : null}

          {pullRequest ? (
            <div className="mt-4 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
              <div className="flex items-start gap-2">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-emerald-200"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="font-semibold">
                    Pull request opened in {pullRequest.repository}.
                  </p>
                  <a
                    href={pullRequest.pull_request_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex max-w-full items-center gap-2 truncate text-emerald-100 underline decoration-emerald-200/40 underline-offset-4 hover:text-white"
                  >
                    <span className="truncate">
                      {pullRequest.pull_request_url}
                    </span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                  </a>
                  <p className="mt-2 font-mono text-xs text-emerald-100/75">
                    {pullRequest.branch_name} to {pullRequest.base_branch}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {demoCiFailures.length ? (
            <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/10 p-4">
              <p className="text-sm font-semibold text-amber-50">
                Demo CI/CD Failures
              </p>
              <div className="mt-3 grid gap-3">
                {demoCiFailures.map((failure) => (
                  <div
                    key={`${failure.workflow}:${failure.job}`}
                    className="rounded-md border border-amber-200/20 bg-[#07090b] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">
                        {failure.workflow} / {failure.job}
                      </p>
                      <span className="rounded-md border border-amber-200/25 px-2 py-1 font-mono text-xs uppercase text-amber-100">
                        {failure.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-amber-50/75">
                      {failure.failure_summary}
                    </p>
                    <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 font-mono text-xs leading-5 text-zinc-300">
                      {previewContent(failure.logs)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {generatedFiles ? (
            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <FileCode2 className="size-4 text-cyan-200" aria-hidden="true" />
                  Generated Files
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold uppercase ${generatedProviderMeta.className}`}
                >
                  <Cloud className="size-3" aria-hidden="true" />
                  {generatedProviderMeta.label}
                </span>
              </div>

              <div className="mb-5 rounded-md border border-white/10 bg-[#07090b] p-4">
                <p className="text-sm font-semibold text-white">
                  Deployment Suggestions
                </p>
                <div className="mt-3 grid gap-2">
                  {generatedFiles.deployment_suggestions.map((suggestion) => (
                    <div
                      key={suggestion}
                      className="flex items-start gap-2 text-sm leading-6 text-zinc-300"
                    >
                      <CheckCircle2
                        className="mt-1 size-4 shrink-0 text-emerald-200"
                        aria-hidden="true"
                      />
                      <span>{suggestion}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5">
                {generatedFilePreviews.map((file) => (
                  <div
                    key={file.key}
                    className="border-b border-white/10 pb-5 last:border-b-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">{file.label}</p>
                      <p className="font-mono text-xs text-cyan-100/80">
                        {file.path}
                      </p>
                    </div>
                    <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#07090b] p-3 font-mono text-xs leading-5 text-zinc-300">
                      {previewContent(generatedFiles[file.key])}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
