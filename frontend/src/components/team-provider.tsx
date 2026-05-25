"use client";

import Link from "next/link";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Building2, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { API_BASE_URL } from "@/lib/api-client";

export type BillingPlanId = "free" | "pro";

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  monthly_price_usd: number;
  included_members: number;
  monthly_api_requests: number;
  monthly_ai_actions: number;
  monthly_auto_heal_actions: number;
  support_tier: string;
  features: string[];
};

export type SaaSTeamAccount = {
  id: string;
  name: string;
  plan_id: BillingPlanId;
  owner_email: string;
  created_at: string;
  updated_at: string;
  member_count: number;
};

export type TeamMember = {
  id: string;
  team_id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: string;
};

export type TeamUsageMetric = {
  metric:
    | "api_requests"
    | "ai_actions"
    | "autonomous_actions"
    | "auto_heal_actions";
  used: number;
  limit: number;
  remaining: number;
  percent_used: number;
};

export type TeamUsageSummary = {
  team: SaaSTeamAccount;
  plan: BillingPlan;
  members: TeamMember[];
  usage: TeamUsageMetric[];
  billing_period_start: string;
  billing_period_end: string;
};

export type SaaSBootstrap = {
  current_team: SaaSTeamAccount;
  teams: SaaSTeamAccount[];
  plans: BillingPlan[];
  usage: TeamUsageSummary;
};

type TeamContextValue = {
  teamId: string;
  setTeamId: (teamId: string) => void;
};


export const defaultTeamId = "team_default";
const TeamContext = createContext<TeamContextValue | null>(null);

export function devPilotTeamHeaders(teamId?: string) {
  return {
    "X-DevPilot-Team-ID": teamId ?? defaultTeamId,
  };
}

function apiUrlFromFetchInput(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function isApiRequestUrl(requestUrl: string) {
  try {
    const request = new URL(requestUrl, window.location.href);
    const apiBase = new URL(API_BASE_URL, window.location.href);
    const apiPath = apiBase.pathname.replace(/\/$/, "");

    return (
      request.origin === apiBase.origin &&
      (apiPath ? request.pathname.startsWith(apiPath) : true)
    );
  } catch {
    return requestUrl.startsWith(API_BASE_URL);
  }
}

function fetchMethod(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function isMutatingMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const { session, csrfToken, selectTeam } = useAuth();
  const teamId = session?.current_team?.id ?? defaultTeamId;
  const teamIdRef = useRef(teamId);
  const csrfTokenRef = useRef(csrfToken);

  useEffect(() => {
    teamIdRef.current = teamId;
    csrfTokenRef.current = csrfToken;
  }, [csrfToken, teamId]);

  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
      const requestUrl = apiUrlFromFetchInput(input);
      if (!isApiRequestUrl(requestUrl)) {
        return originalFetch(input, init);
      }

      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (!headers.has("X-DevPilot-Team-ID")) {
        headers.set("X-DevPilot-Team-ID", teamIdRef.current);
      }

      const method = fetchMethod(input, init);
      if (isMutatingMethod(method) && csrfTokenRef.current && !headers.has("X-CSRF-Token")) {
        headers.set("X-CSRF-Token", csrfTokenRef.current);
      }

      return originalFetch(input, {
        ...init,
        credentials: init?.credentials ?? "include",
        headers,
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const value = useMemo<TeamContextValue>(
    () => ({
      teamId,
      setTeamId(nextTeamId) {
        if (nextTeamId !== teamId) {
          void selectTeam(nextTeamId);
        }
      },
    }),
    [selectTeam, teamId],
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error("useTeam must be used inside TeamProvider.");
  }

  return context;
}

export function TeamSwitcher() {
  const { teamId, setTeamId } = useTeam();
  const { session, isLoading } = useAuth();
  const teams = session?.teams ?? [];
  const selectedTeam =
    teams.find((team) => team.id === teamId) ?? session?.current_team;

  function switchTeam(nextTeamId: string) {
    setTeamId(nextTeamId);
  }

  return (
    <div className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-[#0e1315] px-3 text-sm shadow-2xl shadow-black/20">
      <Building2 className="size-4 text-cyan-200" aria-hidden="true" />
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-zinc-500" aria-hidden="true" />
      ) : (
        <select
          aria-label="Active team"
          value={selectedTeam?.id ?? teamId}
          onChange={(event) => switchTeam(event.target.value)}
          className="h-8 max-w-44 rounded-md border border-white/10 bg-[#050708] px-2 text-sm font-semibold text-zinc-100 outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/20"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      )}
      <Link
        href="/account"
        className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[11px] font-semibold uppercase text-zinc-400 transition hover:border-cyan-300/40 hover:text-cyan-100"
      >
        Account
      </Link>
    </div>
  );
}
