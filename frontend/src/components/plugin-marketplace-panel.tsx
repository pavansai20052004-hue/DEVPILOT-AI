"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Boxes,
  CheckCircle2,
  CloudCog,
  FileCode2,
  GitBranch,
  Loader2,
  Lock,
  PlugZap,
  RadioTower,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRole } from "@/components/role-provider";
import { devPilotRoleHeaders } from "@/lib/rbac";
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api-client";

type PluginId =
  | "aws"
  | "kubernetes"
  | "terraform"
  | "jenkins"
  | "datadog"
  | "slack";

type PluginCategory =
  | "cloud"
  | "orchestration"
  | "infrastructure_as_code"
  | "ci_cd"
  | "observability"
  | "collaboration";

type PluginStatus = "available" | "installed";

type MarketplacePlugin = {
  id: PluginId;
  name: string;
  category: PluginCategory;
  description: string;
  capabilities: string[];
  required_secrets: string[];
  setup_steps: string[];
  status: PluginStatus;
  connection_name?: string | null;
  environment?: string | null;
  installed_at?: string | null;
  installed_by?: string | null;
  configured: boolean;
};

type PluginMarketplaceResponse = {
  plugins: MarketplacePlugin[];
  installed_count: number;
  available_count: number;
};

type PluginMutationResponse = {
  plugin: MarketplacePlugin;
  message: string;
  installed_at?: string;
  uninstalled_at?: string;
};


const pluginIcons: Record<PluginId, typeof Activity> = {
  aws: CloudCog,
  kubernetes: Boxes,
  terraform: FileCode2,
  jenkins: GitBranch,
  datadog: RadioTower,
  slack: Activity,
};

const categoryLabels: Record<PluginCategory, string> = {
  cloud: "Cloud",
  orchestration: "Orchestration",
  infrastructure_as_code: "IaC",
  ci_cd: "CI/CD",
  observability: "Observability",
  collaboration: "Collaboration",
};

const categoryTones: Record<PluginCategory, string> = {
  cloud: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  orchestration: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  infrastructure_as_code: "border-lime-300/25 bg-lime-300/10 text-lime-100",
  ci_cd: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  observability: "border-rose-300/25 bg-rose-300/10 text-rose-100",
  collaboration: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
};


function statusTone(status: PluginStatus) {
  return status === "installed"
    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
    : "border-zinc-500/25 bg-white/5 text-zinc-300";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Pending";
}

async function fetchMarketplace() {
  const response = await fetch(`${API_BASE_URL}/plugins/marketplace`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as PluginMarketplaceResponse;

  if (!response.ok) {
    throw new Error("Plugin marketplace is unavailable.");
  }

  return payload;
}

export function PluginMarketplacePanel() {
  const { role, can, roleLabel } = useRole();
  const canManageIntegrations = can("manage_integrations");
  const [marketplace, setMarketplace] = useState<PluginMarketplaceResponse | null>(
    null,
  );
  const [environment, setEnvironment] = useState("production");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshMarketplace() {
    try {
      setMarketplace(await fetchMarketplace());
      setError(null);
    } catch (marketplaceError) {
      setError(
        marketplaceError instanceof Error
          ? marketplaceError.message
          : "Could not load the plugin marketplace.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialMarketplace() {
      try {
        const payload = await fetchMarketplace();
        if (!isMounted) {
          return;
        }
        setMarketplace(payload);
        setError(null);
      } catch (marketplaceError) {
        if (!isMounted) {
          return;
        }
        setError(
          marketplaceError instanceof Error
            ? marketplaceError.message
            : "Could not load the plugin marketplace.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialMarketplace();

    return () => {
      isMounted = false;
    };
  }, []);

  const installedPlugins = useMemo(
    () =>
      marketplace?.plugins.filter((plugin) => plugin.status === "installed") ?? [],
    [marketplace],
  );

  async function mutatePlugin(plugin: MarketplacePlugin, mode: "install" | "uninstall") {
    if (!canManageIntegrations) {
      setError("Installing integrations requires Admin or DevOps Engineer access.");
      return;
    }

    setPendingPluginId(`${mode}:${plugin.id}`);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        mode === "install"
          ? `${API_BASE_URL}/plugins/install`
          : `${API_BASE_URL}/plugins/${plugin.id}/uninstall`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...devPilotRoleHeaders(role),
          },
          body:
            mode === "install"
              ? JSON.stringify({
                  plugin_id: plugin.id,
                  connection_name: `${plugin.name} ${environment}`,
                  environment,
                })
              : undefined,
        },
      );
      const payload = (await response.json()) as PluginMutationResponse | { detail?: string };

      if (!response.ok) {
        throw new Error(
          getApiErrorMessage(payload, `Could not ${mode} ${plugin.name}.`),
        );
      }

      setNotice((payload as PluginMutationResponse).message);
      await refreshMarketplace();
    } catch (pluginError) {
      setError(
        pluginError instanceof Error
          ? pluginError.message
          : `Could not ${mode} ${plugin.name}.`,
      );
    } finally {
      setPendingPluginId(null);
    }
  }

  return (
    <section id="plugin-marketplace" className="mt-8">
      <div className="mb-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase text-lime-200">
            Plugin Marketplace
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            Install integrations for the command center
          </h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-2 text-sm font-semibold text-zinc-100">
            Environment
            <input
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              className="h-11 w-48 rounded-md border border-white/10 bg-[#111719] px-3 font-mono text-sm font-normal text-zinc-100 outline-none transition focus:border-lime-300/70 focus:ring-2 focus:ring-lime-300/20"
            />
          </label>
          <div className="rounded-lg border border-white/10 bg-[#111719] px-4 py-3 text-sm text-zinc-300">
            <span className="mr-2 inline-block size-2 rounded-full bg-lime-300" />
            {marketplace?.installed_count ?? 0} installed / {roleLabel}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-rose-300/25 bg-rose-300/10 px-4 py-3 text-sm text-rose-50">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}

      {notice ? (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-200" aria-hidden="true" />
          <p>{notice}</p>
        </div>
      ) : null}

      {!canManageIntegrations ? (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{roleLabel} can view integrations. Admin or DevOps Engineer access can install them.</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(marketplace?.plugins ?? []).map((plugin) => {
          const Icon = pluginIcons[plugin.id];
          const isInstalled = plugin.status === "installed";
          const pendingInstall = pendingPluginId === `install:${plugin.id}`;
          const pendingUninstall = pendingPluginId === `uninstall:${plugin.id}`;

          return (
            <article
              key={plugin.id}
              className="rounded-lg border border-white/10 bg-[#111719] p-5 shadow-2xl shadow-black/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="grid size-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-zinc-100">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-white">{plugin.name}</h3>
                      <span className={`mt-2 inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${categoryTones[plugin.category]}`}>
                        {categoryLabels[plugin.category]}
                      </span>
                    </div>
                  </div>
                </div>
                <span className={`inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-xs font-semibold uppercase ${statusTone(plugin.status)}`}>
                  {plugin.status}
                </span>
              </div>

              <p className="mt-4 min-h-12 text-sm leading-6 text-zinc-400">
                {plugin.description}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {plugin.capabilities.slice(0, 4).map((capability) => (
                  <span
                    key={capability}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300"
                  >
                    {capability}
                  </span>
                ))}
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Required secrets
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {plugin.required_secrets.map((secret) => (
                    <span
                      key={secret}
                      className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 font-mono text-[11px] text-cyan-100"
                    >
                      {secret}
                    </span>
                  ))}
                </div>
              </div>

              {isInstalled ? (
                <div className="mt-4 rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-3 text-sm text-emerald-50">
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    {plugin.connection_name ?? plugin.name}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-emerald-100/75">
                    {plugin.environment ?? "production"} / installed {formatDate(plugin.installed_at)}
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-white/10 bg-[#07090b] px-3 py-3 text-sm text-zinc-400">
                  <div className="flex items-center gap-2 font-semibold text-zinc-200">
                    <Settings2 className="size-4 text-lime-200" aria-hidden="true" />
                    {plugin.setup_steps[0]}
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => mutatePlugin(plugin, "install")}
                  disabled={pendingInstall || pendingUninstall || !canManageIntegrations}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-lime-300/40 bg-lime-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingInstall ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <PlugZap className="size-4" aria-hidden="true" />
                  )}
                  {isInstalled ? "Update" : "Install"}
                </button>
                <button
                  type="button"
                  onClick={() => mutatePlugin(plugin, "uninstall")}
                  disabled={!isInstalled || pendingInstall || pendingUninstall || !canManageIntegrations}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-zinc-300 transition hover:border-rose-300/30 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingUninstall ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                  Remove
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {isLoading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin text-lime-200" aria-hidden="true" />
          Loading marketplace
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
          <p className="text-sm font-medium text-zinc-400">Installed</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-white">
            {marketplace?.installed_count ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
          <p className="text-sm font-medium text-zinc-400">Available</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-white">
            {marketplace?.available_count ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#111719] p-4">
          <p className="text-sm font-medium text-zinc-400">Active stack</p>
          <p className="mt-2 truncate text-sm font-semibold text-white">
            {installedPlugins.length
              ? installedPlugins.map((plugin) => plugin.name).join(", ")
              : "No integrations installed"}
          </p>
        </div>
      </div>
    </section>
  );
}
