const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

if (!configuredApiBaseUrl && process.env.NODE_ENV === "production") {
  throw new Error("NEXT_PUBLIC_API_URL must be set for production builds.");
}

export const API_BASE_URL = configuredApiBaseUrl ?? "http://127.0.0.1:8000";

const defaultTimeoutMs = 15_000;
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);

type ApiRequestOptions = RequestInit & {
  errorMessage?: string;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
};

export class ApiRequestError extends Error {
  status?: number;
  payload?: unknown;

  constructor(message: string, status?: number, payload?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

export function apiUrl(path: string) {
  return path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getApiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || !("detail" in payload)) {
    return fallback;
  }

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const message = (item as { msg?: unknown }).msg;
          return typeof message === "string" ? message : null;
        }

        return null;
      })
      .filter(Boolean)
      .join(" ");
  }

  return fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function parseResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function shouldRetry(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.status ? retryableStatuses.has(error.status) : true;
  }

  return true;
}

async function runApiRequest<T>(
  path: string,
  options: ApiRequestOptions,
): Promise<T> {
  const {
    errorMessage = "DevPilot could not complete the request.",
    timeoutMs = defaultTimeoutMs,
    signal,
    ...init
  } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();

  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: init.credentials ?? "include",
      signal: controller.signal,
    });
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      throw new ApiRequestError(
        getApiErrorMessage(payload, errorMessage),
        response.status,
        payload,
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError(
        "The request timed out. Check the backend connection and try again.",
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { retries = 0, retryDelayMs = 450, ...requestOptions } = options;
  let attempt = 0;

  while (true) {
    try {
      return await runApiRequest<T>(path, requestOptions);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) {
        if (error instanceof Error) {
          throw error;
        }

        throw new ApiRequestError(
          requestOptions.errorMessage ?? "DevPilot could not complete the request.",
        );
      }

      attempt += 1;
      await wait(retryDelayMs * attempt);
    }
  }
}
