"use client";

import {
  FormEvent,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  CloudCog,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
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

type AuthSignupInput = AuthBootstrapInput;

type AuthLoginInput = {
  email: string;
  password: string;
};

type AuthPasswordResetResponse = {
  message: string;
  reset_token?: string | null;
  reset_url?: string | null;
  expires_at?: string | null;
};

type AuthSsoConfig = {
  enabled: boolean;
  configured: boolean;
  provider_name: string;
  login_url?: string | null;
};

type AuthPasswordResetInput = {
  email: string;
};

type AuthPasswordResetConfirmInput = {
  token: string;
  password: string;
};

type AuthContextValue = {
  session: AuthSession | null;
  csrfToken: string | null;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  login: (payload: AuthLoginInput) => Promise<void>;
  signup: (payload: AuthSignupInput) => Promise<void>;
  bootstrap: (payload: AuthBootstrapInput) => Promise<void>;
  requestPasswordReset: (
    payload: AuthPasswordResetInput,
  ) => Promise<AuthPasswordResetResponse>;
  resetPassword: (payload: AuthPasswordResetConfirmInput) => Promise<AuthPasswordResetResponse>;
  selectTeam: (teamId: string) => Promise<void>;
  logout: () => Promise<void>;
};

type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset" | "bootstrap";

const CSRF_COOKIE_NAME = "devpilot_csrf";
const AUTH_SESSION_REFRESH_ATTEMPTS = 3;
const AUTH_MUTATION_ATTEMPTS = 3;
const AUTH_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const AuthContext = createContext<AuthContextValue | null>(null);

class AuthRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
  }
}

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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AuthRequestError(
      getApiErrorMessage(payload, "Authentication request failed."),
      response.status,
    );
  }

  return payload as T;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryAuthMutation(error: unknown) {
  if (error instanceof AuthRequestError) {
    return error.status ? AUTH_RETRYABLE_STATUSES.has(error.status) : true;
  }

  return true;
}

async function fetchAuthSessionWithRetry() {
  let lastError: unknown;

  for (let attempt = 0; attempt < AUTH_SESSION_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(apiUrl("/auth/session"), {
        cache: "no-store",
        credentials: "include",
      });
      return await parseJsonResponse<AuthSession>(response);
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

  const postJson = useCallback(
    async <T,>(path: string, payload?: unknown) => {
      let lastError: unknown;

      for (let attempt = 0; attempt < AUTH_MUTATION_ATTEMPTS; attempt += 1) {
        const headers = new Headers();
        if (payload) {
          headers.set("Content-Type", "application/json");
        }
        if (csrfToken) {
          headers.set("X-CSRF-Token", csrfToken);
        }

        try {
          const response = await fetch(apiUrl(path), {
            method: "POST",
            credentials: "include",
            headers,
            body: payload ? JSON.stringify(payload) : undefined,
          });
          return await parseJsonResponse<T>(response);
        } catch (authError) {
          lastError = authError;
          if (
            attempt < AUTH_MUTATION_ATTEMPTS - 1 &&
            shouldRetryAuthMutation(authError)
          ) {
            await wait(450 * (attempt + 1));
            continue;
          }

          throw authError;
        }
      }

      throw lastError;
    },
    [csrfToken],
  );

  const postAuth = useCallback(
    async (path: string, payload?: unknown) => {
      const nextSession = await postJson<AuthSession>(path, payload);
      setSession(nextSession);
      setLoadError(null);
    },
    [postJson],
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
      signup(payload) {
        return postAuth("/auth/signup", payload);
      },
      bootstrap(payload) {
        return postAuth("/auth/bootstrap", payload);
      },
      requestPasswordReset(payload) {
        return postJson<AuthPasswordResetResponse>(
          "/auth/password-reset/request",
          payload,
        );
      },
      resetPassword(payload) {
        return postJson<AuthPasswordResetResponse>(
          "/auth/password-reset/confirm",
          payload,
        );
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
    [csrfToken, isLoading, postAuth, postJson, refreshSession, session],
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
    <div className="grid min-h-screen place-items-center bg-[var(--background)] px-5 text-zinc-100">
      <div className="premium-panel flex items-center gap-3 px-4 py-3 text-sm text-zinc-300">
        <Loader2 className="size-4 animate-spin text-cyan-200" aria-hidden="true" />
        Checking session...
      </div>
    </div>
  );
}

function modeCopy(mode: AuthMode) {
  if (mode === "sign-up") {
    return {
      title: "Create your workspace",
      description: "Start with a secure owner account and invite your team later.",
      action: "Create account",
      pending: "Creating account...",
    };
  }
  if (mode === "bootstrap") {
    return {
      title: "Create owner workspace",
      description: "Set up the first secure owner account for this DevPilot install.",
      action: "Create owner workspace",
      pending: "Creating workspace...",
    };
  }
  if (mode === "forgot") {
    return {
      title: "Reset your password",
      description: "Enter your email and we will send reset instructions.",
      action: "Send reset link",
      pending: "Sending reset link...",
    };
  }
  if (mode === "reset") {
    return {
      title: "Choose a new password",
      description: "Use at least 12 characters. You will sign in again after reset.",
      action: "Update password",
      pending: "Updating password...",
    };
  }

  return {
    title: "Welcome back",
    description: "Sign in to your DevPilot workspace.",
    action: "Sign in",
    pending: "Signing in...",
  };
}

function AuthTextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  name,
  required = true,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
  name?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-zinc-200">
      <span>{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="premium-input h-11 rounded-md px-3 text-sm font-medium transition"
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
      />
    </label>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="grid gap-2 text-sm font-semibold text-zinc-200">
      <span>{label}</span>
      <span className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="premium-input h-11 w-full rounded-md px-3 pr-11 text-sm font-medium transition"
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={12}
          required={required}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </span>
    </label>
  );
}

function AuthForm({
  bootstrapRequired,
  loadError,
}: {
  bootstrapRequired: boolean;
  loadError: string | null;
}) {
  const {
    login,
    signup,
    bootstrap,
    requestPasswordReset,
    resetPassword,
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>(
    bootstrapRequired ? "bootstrap" : "sign-in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [teamName, setTeamName] = useState("DevPilot Control Plane");
  const [resetToken, setResetToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [ssoConfig, setSsoConfig] = useState<AuthSsoConfig | null>(null);
  const copy = modeCopy(mode);
  const error = submitError ?? loadError;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset_token");
    const ssoError = params.get("sso_error");
    let ssoErrorTimer: number | null = null;

    if (ssoError) {
      ssoErrorTimer = window.setTimeout(() => {
        setSubmitError(ssoError);
        window.history.replaceState({}, "", window.location.pathname);
      }, 0);
    }

    if (token) {
      const resetModeTimer = window.setTimeout(() => {
        setResetToken(token);
        setMode("reset");
      }, 0);

      return () => {
        window.clearTimeout(resetModeTimer);
        if (ssoErrorTimer) {
          window.clearTimeout(ssoErrorTimer);
        }
      };
    }

    return () => {
      if (ssoErrorTimer) {
        window.clearTimeout(ssoErrorTimer);
      }
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    fetch(apiUrl("/auth/sso/config"), {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return (await response.json()) as AuthSsoConfig;
      })
      .then((payload) => {
        if (isActive) {
          setSsoConfig(payload);
        }
      })
      .catch(() => {
        if (isActive) {
          setSsoConfig(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setSubmitError(null);
    setSuccessMessage(null);
    setResetLink(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);
    setResetLink(null);
    setIsSubmitting(true);

    try {
      if (mode === "forgot") {
        const result = await requestPasswordReset({ email });
        setSuccessMessage(result.message);
        setResetLink(result.reset_url ?? null);
        return;
      }

      if (mode === "reset") {
        if (password !== confirmPassword) {
          setSubmitError("Passwords do not match.");
          return;
        }
        const result = await resetPassword({ token: resetToken, password });
        setSuccessMessage(result.message);
        window.history.replaceState({}, "", window.location.pathname);
        switchMode("sign-in");
        setSuccessMessage(result.message);
        return;
      }

      if (mode === "sign-up" || mode === "bootstrap") {
        if (password !== confirmPassword) {
          setSubmitError("Passwords do not match.");
          return;
        }
        const payload = {
          email,
          password,
          full_name: fullName || undefined,
          team_name: teamName,
        };
        if (mode === "bootstrap") {
          await bootstrap(payload);
        } else {
          await signup(payload);
        }
        return;
      }

      await login({ email, password });
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

  function startSsoSignIn() {
    const loginUrl = ssoConfig?.login_url || "/auth/sso/start";
    window.location.href = apiUrl(loginUrl);
  }

  return (
    <div className="min-h-screen bg-[var(--background)] px-5 py-8 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <section className="insight-panel hidden p-6 lg:block">
          <div className="relative z-10 flex min-h-[34rem] flex-col justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-md border border-cyan-300/35 bg-cyan-300/10">
                  <CloudCog className="size-6 text-cyan-200" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-white">DevPilot AI</p>
                  <p className="text-sm text-zinc-400">Secure AI DevOps cockpit</p>
                </div>
              </div>

              <h1 className="font-display mt-10 max-w-xl text-4xl font-semibold leading-tight text-white">
                Give every teammate their own secure DevPilot workspace.
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-zinc-400">
                Separate accounts, team workspaces, CSRF-protected sessions, and
                reset-ready access for demos, judges, and real buyers.
              </p>
            </div>

            <div className="grid gap-3">
              {[
                "Separate owner accounts",
                "Enterprise OIDC SSO",
                "Team workspaces",
                "Audit-ready actions",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-zinc-200"
                >
                  <CheckCircle2 className="size-4 text-lime-200" aria-hidden="true" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <form
          onSubmit={submit}
          className="premium-panel relative mx-auto w-full max-w-[30rem] overflow-hidden p-5 sm:p-6"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(103,232,249,0.76),rgba(248,198,106,0.65),transparent)]" />

          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-md border border-cyan-300/35 bg-cyan-300/10">
                <CloudCog className="size-5 text-cyan-200" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">DevPilot AI</p>
                <p className="text-sm text-zinc-400">Secure account access</p>
              </div>
            </div>
            <Sparkles className="size-5 text-amber-200" aria-hidden="true" />
          </div>

          {!bootstrapRequired ? (
            <div className="mb-6 grid grid-cols-2 rounded-md border border-white/10 bg-black/20 p-1">
              <button
                type="button"
                onClick={() => switchMode("sign-in")}
                className={`h-10 rounded-md text-sm font-semibold transition ${
                  mode === "sign-in"
                    ? "bg-cyan-300 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode("sign-up")}
                className={`h-10 rounded-md text-sm font-semibold transition ${
                  mode === "sign-up"
                    ? "bg-cyan-300 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                Create account
              </button>
            </div>
          ) : null}

          <div className="mb-5">
            <h2 className="font-display text-2xl font-semibold text-white">
              {copy.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {copy.description}
            </p>
          </div>

          {mode === "sign-in" && ssoConfig?.enabled ? (
            <div className="mb-5">
              <button
                type="button"
                onClick={startSsoSignIn}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-cyan-300/35 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/15"
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                Continue with {ssoConfig.provider_name}
              </button>
              <div className="mt-4 flex items-center gap-3 text-xs font-semibold uppercase text-zinc-600">
                <span className="h-px flex-1 bg-white/10" />
                Password access
                <span className="h-px flex-1 bg-white/10" />
              </div>
            </div>
          ) : null}

          <div className="grid gap-4">
            {mode === "reset" ? (
              <AuthTextInput
                label="Reset token"
                value={resetToken}
                onChange={setResetToken}
                placeholder="Paste the reset token"
                autoComplete="one-time-code"
                name="reset-token"
              />
            ) : null}

            {mode !== "reset" ? (
              <AuthTextInput
                label="Work email"
                value={email}
                onChange={setEmail}
                placeholder="you@company.com"
                type="email"
                autoComplete="email"
                name="email"
              />
            ) : null}

            {mode === "sign-up" || mode === "bootstrap" ? (
              <>
                <AuthTextInput
                  label="Full name"
                  value={fullName}
                  onChange={setFullName}
                  placeholder="Pavan Sai"
                  autoComplete="name"
                  name="name"
                  required={false}
                />
                <AuthTextInput
                  label="Workspace name"
                  value={teamName}
                  onChange={setTeamName}
                  placeholder="Acme DevOps"
                  autoComplete="organization"
                  name="organization"
                />
              </>
            ) : null}

            {mode !== "forgot" ? (
              <>
                <PasswordInput
                  label={mode === "reset" ? "New password" : "Password"}
                  value={password}
                  onChange={setPassword}
                  placeholder="12+ characters"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                />
                {mode === "sign-up" || mode === "bootstrap" || mode === "reset" ? (
                  <PasswordInput
                    label="Confirm password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                ) : null}
                <p className="-mt-2 text-xs text-zinc-500">
                  12+ characters required. Password managers are welcome.
                </p>
              </>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="mt-4 rounded-md border border-lime-300/25 bg-lime-300/10 px-3 py-2 text-sm text-lime-100">
              {successMessage}
              {resetLink ? (
                <a
                  href={resetLink}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-lime-300/30 bg-lime-300/15 px-3 text-xs font-semibold text-lime-50 transition hover:bg-lime-300/20"
                >
                  Open demo reset link
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="premium-button mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : mode === "sign-up" || mode === "bootstrap" ? (
              <UserPlus className="size-4" aria-hidden="true" />
            ) : mode === "forgot" || mode === "reset" ? (
              <KeyRound className="size-4" aria-hidden="true" />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            {isSubmitting ? copy.pending : copy.action}
          </button>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            {mode === "sign-in" ? (
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Forgot password?
              </button>
            ) : null}
            {mode === "forgot" || mode === "reset" ? (
              <button
                type="button"
                onClick={() => switchMode("sign-in")}
                className="font-semibold text-cyan-100 transition hover:text-cyan-50"
              >
                Back to sign in
              </button>
            ) : null}
            {mode === "sign-in" && !bootstrapRequired ? (
              <button
                type="button"
                onClick={() => switchMode("sign-up")}
                className="ml-auto font-semibold text-zinc-300 transition hover:text-white"
              >
                New to DevPilot? Create an account
              </button>
            ) : null}
            {mode === "sign-up" ? (
              <button
                type="button"
                onClick={() => switchMode("sign-in")}
                className="font-semibold text-zinc-300 transition hover:text-white"
              >
                Already have an account? Sign in
              </button>
            ) : null}
          </div>

          <div className="mt-6 flex items-center gap-2 border-t border-white/10 pt-4 text-xs leading-5 text-zinc-500">
            <ShieldCheck className="size-4 shrink-0 text-cyan-200" aria-hidden="true" />
            Protected by secure session cookies and CSRF checks.
          </div>
        </form>

        <div className="mx-auto flex w-full max-w-[30rem] items-center justify-center gap-2 text-xs text-zinc-500 lg:hidden">
          <Mail className="size-4 text-cyan-200" aria-hidden="true" />
          Separate accounts, team workspaces, and password reset are enabled.
        </div>
      </div>
    </div>
  );
}

export function AuthStatusButton() {
  const { session, logout } = useAuth();

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.045] px-3 text-sm font-semibold text-zinc-300 shadow-2xl shadow-black/20 transition hover:border-red-300/35 hover:text-red-100"
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
