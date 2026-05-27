"use client";

import { FormEvent, ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CloudCog, Loader2, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { apiUrl, getApiErrorMessage } from "@/lib/api-client";
import type { UserRole } from "@/lib/rbac";
import type { SaaSTeamAccount } from "@/components/team-provider";

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
};

export type AuthSession = {
  authenticated: boolean;
  bootstrap_required: boolean;
  user?: AuthUser | null;
  current_team?: SaaSTeamAccount | null;
  teams: SaaSTeamAccount[];
  role?: UserRole | null;
  csrf_token?: string | null;
};

type AuthBootstrapInput = {
  email: string;
  password: string;
  full_name?: string;
  team_name: string;
};

type AuthLoginInput = {
  email: string;
  password: string;
};

type AuthContextValue = {
  session: AuthSession | null;
  csrfToken: string | null;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  login: (payload: AuthLoginInput) => Promise<void>;
  bootstrap: (payload: AuthBootstrapInput) => Promise<void>;
  selectTeam: (teamId: string) => Promise<void>;
  logout: () => Promise<void>;
};

const CSRF_COOKIE_NAME = "devpilot_csrf";
const AUTH_SESSION_REFRESH_ATTEMPTS = 3;
const AuthContext = createContext<AuthContextValue | null>(null);

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

async function parseJsonResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Authentication request failed."));
  }

  return payload as AuthSession;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchAuthSessionWithRetry() {
  let lastError: unknown;

  for (let attempt = 0; attempt < AUTH_SESSION_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(apiUrl("/auth/session"), {
        cache: "no-store",
        credentials: "include",
      });
      return await parseJsonResponse(response);
    } catch (error) {
      lastError = error;
      if (attempt < AUTH_SESSION_REFRESH_ATTEMPTS - 1) {
        await wait(350 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

function isProtectedFrontendPath(pathname: string) {
  return pathname !== "/";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const csrfToken = session?.csrf_token ?? readCookie(CSRF_COOKIE_NAME);

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await fetchAuthSessionWithRetry();
      setSession(payload);
      setLoadError(null);
    } catch (error) {
      setSession({
        authenticated: false,
        bootstrap_required: false,
        teams: [],
      });
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not reach the authentication service.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshSession();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [refreshSession]);

  const postAuth = useCallback(
    async (path: string, payload?: unknown) => {
      const headers = new Headers();
      if (payload) {
        headers.set("Content-Type", "application/json");
      }
      if (csrfToken) {
        headers.set("X-CSRF-Token", csrfToken);
      }

      const response = await fetch(apiUrl(path), {
        method: "POST",
        credentials: "include",
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const nextSession = await parseJsonResponse(response);
      setSession(nextSession);
      setLoadError(null);
    },
    [csrfToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      csrfToken,
      isLoading,
      refreshSession,
      login(payload) {
        return postAuth("/auth/login", payload);
      },
      bootstrap(payload) {
        return postAuth("/auth/bootstrap", payload);
      },
      selectTeam(teamId) {
        return postAuth("/auth/select-team", { team_id: teamId });
      },
      async logout() {
        try {
          const headers = new Headers();
          if (csrfToken) {
            headers.set("X-CSRF-Token", csrfToken);
          }
          await fetch(apiUrl("/auth/logout"), {
            method: "POST",
            credentials: "include",
            headers,
          });
        } finally {
          setSession({
            authenticated: false,
            bootstrap_required: false,
            teams: [],
          });
        }
      },
    }),
    [csrfToken, isLoading, postAuth, refreshSession, session],
  );

  const protectedPath = isProtectedFrontendPath(pathname);
  const authenticated = Boolean(session?.authenticated);

  return (
    <AuthContext.Provider value={value}>
      {protectedPath && isLoading ? <AuthLoading /> : null}
      {protectedPath && !isLoading && !authenticated ? (
        <AuthForm
          bootstrapRequired={Boolean(session?.bootstrap_required)}
          loadError={loadError}
        />
      ) : null}
      {!protectedPath || (!isLoading && authenticated) ? children : null}
    </AuthContext.Provider>
  );
}

function AuthLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#050708] px-5 text-zinc-100">
      <div className="flex items-center gap-3 rounded-md border border-white/10 bg-[#0e1315] px-4 py-3 text-sm text-zinc-300">
        <Loader2 className="size-4 animate-spin text-emerald-200" aria-hidden="true" />
        Securing your DevPilot session
      </div>
    </div>
  );
}

function AuthForm({
  bootstrapRequired,
  loadError,
}: {
  bootstrapRequired: boolean;
  loadError: string | null;
}) {
  const { login, bootstrap } = useAuth();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [teamName, setTeamName] = useState("DevPilot Control Plane");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const error = submitError ?? loadError;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      if (bootstrapRequired) {
        await bootstrap({
          email,
          password,
          full_name: fullName || undefined,
          team_name: teamName,
        });
      } else {
        await login({ email, password });
      }
    } catch (submitError) {
      setSubmitError(
        submitError instanceof Error
          ? submitError.message
          : "Could not complete authentication.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#050708] px-5 py-10 text-zinc-100">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-white/10 bg-[#0e1315] p-5 shadow-2xl shadow-black/40"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md border border-emerald-300/35 bg-emerald-300/10">
            <CloudCog className="size-5 text-emerald-200" aria-hidden="true" />
          </span>
          <div>
            <p className="font-mono text-sm font-semibold uppercase text-white">
              DevPilot AI
            </p>
            <p className="text-sm text-zinc-500">
              {bootstrapRequired ? "Create the first owner account" : "Sign in to continue"}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {bootstrapRequired ? (
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/20"
              placeholder="Full name"
            />
          ) : null}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/20"
            placeholder="Email"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/20"
            placeholder="Password"
            minLength={12}
            required
          />
          {bootstrapRequired ? (
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              className="h-11 rounded-md border border-white/10 bg-[#07090b] px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-300/70 focus:ring-2 focus:ring-emerald-300/20"
              placeholder="Team name"
              required
            />
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : bootstrapRequired ? (
            <ShieldCheck className="size-4" aria-hidden="true" />
          ) : (
            <LogIn className="size-4" aria-hidden="true" />
          )}
          {bootstrapRequired ? "Create Secure Workspace" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

export function AuthStatusButton() {
  const { session, logout } = useAuth();

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-white/10 bg-[#0e1315] px-3 text-sm font-semibold text-zinc-300 shadow-2xl shadow-black/20 transition hover:border-red-300/35 hover:text-red-100"
    >
      <span className="hidden max-w-40 truncate sm:inline">
        {session?.user?.email ?? "Signed in"}
      </span>
      <LogOut className="size-4" aria-hidden="true" />
    </button>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
