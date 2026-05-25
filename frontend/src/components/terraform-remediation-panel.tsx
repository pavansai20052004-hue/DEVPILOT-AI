"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  FileCode2,
  Loader2,
  Lock,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

type CloudProvider = "aws" | "azure" | "gcp";
type DriftSeverity = "low" | "medium" | "high" | "critical";

type TerraformDriftIssue = {
  id: string;
  title: string;
  severity: DriftSeverity;
  resource: string;
  detail: string;
  remediation: string;
};

type TerraformRemediationResult = {
  message: string;
  drift_detected: boolean;
  drift_count: number;
  cloud_provider: CloudProvider;
  corrected_terraform: string;
  unified_diff: string;
  drift_issues: TerraformDriftIssue[];
  apply_ready: boolean;
  generated_at: string;
};

type TerraformApplyResult = {
  message: string;
  applied: boolean;
  patched_terraform: string;
  unified_diff: string;
  applied_at: string;
};


const sampleTerraform = `provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "logs" {
  bucket = "devpilot-prod-logs"
  acl    = "public-read"
}

resource "aws_security_group" "api" {
  name = "devpilot-api"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "primary" {
  allocated_storage       = 20
  engine                  = "postgres"
  instance_class          = "db.t3.micro"
  publicly_accessible     = true
  backup_retention_period = 0
  skip_final_snapshot     = true
}`;

const sampleDriftContext =
  "terraform plan detected drift: S3 ACL changed to public-read, SSH ingress opened to 0.0.0.0/0, and RDS backups were disabled.";

const severityClassNames: Record<DriftSeverity, string> = {
  low: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  medium: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  high: "border-orange-300/25 bg-orange-300/10 text-orange-100",
  critical: "border-red-400/25 bg-red-400/10 text-red-100",
};


function diffLineClassName(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "border-l-2 border-emerald-300 bg-emerald-300/10 text-emerald-100";
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return "border-l-2 border-red-300 bg-red-300/10 text-red-100";
  }

  if (line.startsWith("@@")) {
    return "border-l-2 border-cyan-300 bg-cyan-300/10 text-cyan-100";
  }

  return "border-l-2 border-transparent text-zinc-400";
}

function countDiffChanges(diff: string) {
  return diff
    .split(/\r?\n/)
    .filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---")),
    ).length;
}

export function TerraformRemediationPanel() {
  const { role, can, roleLabel } = useRole();
  const [terraformCode, setTerraformCode] = useState(sampleTerraform);
  const [driftContext, setDriftContext] = useState(sampleDriftContext);
  const [result, setResult] = useState<TerraformRemediationResult | null>(null);
  const [applyResult, setApplyResult] = useState<TerraformApplyResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPatchTerraform = can("patch_terraform");

  const diffChanges = useMemo(
    () => (result ? countDiffChanges(result.unified_diff) : 0),
    [result],
  );

  async function generateTerraformPatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setApplyResult(null);

    if (!terraformCode.trim()) {
      setError("Paste Terraform code before detecting drift.");
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch(`${API_BASE_URL}/terraform/remediate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          terraform_code: terraformCode,
          drift_context: driftContext,
          cloud_provider: "aws",
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, "Terraform remediation failed."),
        );
      }

      setResult(payload as TerraformRemediationResult);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not reach the Terraform remediation API.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function autoPatchTerraform() {
    setError(null);
    setApplyResult(null);

    if (!result?.apply_ready) {
      setError("Generate and review a Terraform diff before auto-patching.");
      return;
    }

    if (!canPatchTerraform) {
      setError("Terraform auto-patch requires Admin or DevOps Engineer access.");
      return;
    }

    setIsApplying(true);

    try {
      const response = await fetch(`${API_BASE_URL}/terraform/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...devPilotRoleHeaders(role),
        },
        body: JSON.stringify({
          original_terraform: terraformCode,
          corrected_terraform: result.corrected_terraform,
          approved: true,
        }),
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Terraform auto-patch failed."));
      }

      const patchResult = payload as TerraformApplyResult;
      setApplyResult(patchResult);
      setTerraformCode(patchResult.patched_terraform);
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "Could not reach the Terraform auto-patch API.",
      );
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <section id="terraform-remediation" className="bg-[#08100f] px-5 py-14 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase text-sky-200">
            Terraform Remediation
          </p>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold text-white sm:text-4xl">
            Detect infrastructure drift and auto-patch Terraform.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
            DevPilot checks Terraform against known drift patterns, generates
            corrected HCL, and keeps the diff visible before the patch is applied.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <Cloud className="size-4 text-sky-200" aria-hidden="true" />
                Drift
              </div>
              <p className="font-mono text-2xl font-semibold text-white">
                {result?.drift_count ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <FileCode2 className="size-4 text-cyan-200" aria-hidden="true" />
                Diff
              </div>
              <p className="font-mono text-2xl font-semibold text-white">
                {diffChanges}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-zinc-400">
                <ShieldCheck className="size-4 text-lime-200" aria-hidden="true" />
                Patch
              </div>
              <p className="text-2xl font-semibold text-white">
                {applyResult?.applied ? "Applied" : "Ready"}
              </p>
            </div>
          </div>
        </div>

        <form
          onSubmit={generateTerraformPatch}
          className="min-w-0 rounded-lg border border-white/10 bg-[#101618] p-4 shadow-2xl shadow-black/25 sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-sky-200">
                Drift Patch
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Terraform diff before apply
              </h3>
            </div>
            <span
              className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase ${
                result?.drift_detected
                  ? "border-sky-300/25 bg-sky-300/10 text-sky-100"
                  : "border-white/10 bg-white/5 text-zinc-300"
              }`}
            >
              {result?.drift_detected ? "drift found" : "pending"}
            </span>
          </div>

          <label
            htmlFor="terraform-code"
            className="mb-3 mt-5 flex items-center gap-2 text-sm font-semibold text-zinc-100"
          >
            <FileCode2 className="size-4 text-sky-200" aria-hidden="true" />
            Terraform Code
          </label>
          <textarea
            id="terraform-code"
            value={terraformCode}
            onChange={(event) => {
              setTerraformCode(event.target.value);
              setResult(null);
              setApplyResult(null);
              setError(null);
            }}
            className="min-h-72 w-full resize-y rounded-md border border-white/10 bg-[#07090b] px-4 py-3 font-mono text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
            placeholder="Paste Terraform HCL..."
          />

          <label
            htmlFor="drift-context"
            className="mb-3 mt-4 block text-sm font-semibold text-zinc-100"
          >
            Drift Context
          </label>
          <textarea
            id="drift-context"
            value={driftContext}
            onChange={(event) => {
              setDriftContext(event.target.value);
              setResult(null);
              setApplyResult(null);
              setError(null);
            }}
            className="min-h-24 w-full resize-y rounded-md border border-white/10 bg-[#07090b] px-4 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-300/20"
            placeholder="Paste Terraform plan drift output or a short drift summary..."
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="submit"
              disabled={isGenerating || isApplying}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-sky-300/40 bg-sky-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(125,211,252,0.14)] transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Wrench className="size-4" aria-hidden="true" />
              )}
              Detect Drift
            </button>
            <button
              type="button"
              onClick={autoPatchTerraform}
              disabled={
                isGenerating ||
                isApplying ||
                !result?.apply_ready ||
                !canPatchTerraform
              }
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-5 text-sm font-semibold text-zinc-950 shadow-[0_0_24px_rgba(190,242,100,0.14)] transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApplying ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : !canPatchTerraform ? (
                <Lock className="size-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Auto-Patch Terraform
            </button>
          </div>

          {!canPatchTerraform ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {roleLabel} can review Terraform drift and diffs, but applying
                a Terraform auto-patch requires Admin or DevOps Engineer access.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          {applyResult ? (
            <div className="mt-4 rounded-md border border-lime-300/25 bg-lime-300/10 px-4 py-3 text-sm text-lime-50">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-lime-200" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{applyResult.message}</p>
                  <p className="mt-1 text-lime-100/75">
                    Applied at {new Date(applyResult.applied_at).toLocaleString()}.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="mt-5 border-t border-white/10 pt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <ShieldCheck className="size-4 text-sky-200" aria-hidden="true" />
                  Drift Findings
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {new Date(result.generated_at).toLocaleString()}
                </span>
              </div>

              {result.drift_issues.length ? (
                <div className="grid gap-3">
                  {result.drift_issues.slice(0, 5).map((issue) => (
                    <article
                      key={issue.id}
                      className="rounded-lg border border-white/10 bg-[#07090b] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-white">{issue.title}</p>
                        <span
                          className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase ${severityClassNames[issue.severity]}`}
                        >
                          {issue.severity}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-sky-100/80">
                        {issue.resource}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-zinc-400">
                        {issue.detail}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {issue.remediation}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-white/10 bg-[#07090b] p-4 text-sm text-zinc-400">
                  No Terraform drift was detected in this input.
                </div>
              )}

              {result.unified_diff ? (
                <div className="mt-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <FileCode2 className="size-4 text-cyan-200" aria-hidden="true" />
                    Pre-Apply Diff
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-lg border border-white/10 bg-[#050708] p-3 font-mono text-xs leading-5">
                    {result.unified_diff.split(/\r?\n/).map((line, index) => (
                      <span
                        key={`${index}:${line}`}
                        className={`block min-h-5 whitespace-pre-wrap break-words px-2 ${diffLineClassName(line)}`}
                      >
                        {line || " "}
                      </span>
                    ))}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
