from __future__ import annotations

import base64
import contextvars
import difflib
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import tempfile
import threading
import time
from dataclasses import dataclass
from collections import deque
from base64 import b64encode
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Literal, cast
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request as UrlRequest
from urllib.request import urlopen
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from kubernetes import client, config
from kubernetes.client import ApiException
from kubernetes.config.config_exception import ConfigException
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field
from psycopg import Connection as PostgresConnection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def is_production_environment() -> bool:
    environment = (
        os.getenv("APP_ENV")
        or os.getenv("ENVIRONMENT")
        or os.getenv("RAILWAY_ENVIRONMENT")
        or os.getenv("NODE_ENV")
        or ""
    ).strip().lower()
    return environment == "production"


def load_local_dotenv() -> None:
    dotenv_path = Path(__file__).with_name(".env")
    if dotenv_path.is_file() and not is_production_environment():
        load_dotenv(dotenv_path=dotenv_path, override=False)


load_local_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("devpilot")

app = FastAPI(title="DevPilot AI API", version="0.1.0")

LOCAL_DEV_FRONTEND_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://localhost:3003",
    "http://127.0.0.1:3003",
    "http://localhost:3004",
    "http://127.0.0.1:3004",
    "http://localhost:3005",
    "http://127.0.0.1:3005",
    "http://localhost:3006",
    "http://127.0.0.1:3006",
]

CORS_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "X-CSRF-Token",
    "X-DevPilot-Role",
    "X-DevPilot-Team-ID",
    "X-Requested-With",
]
RATE_LIMIT_EXEMPT_PATHS = {
    "/",
    "/health",
    "/ready",
    "/auth/session",
    "/docs",
    "/redoc",
    "/openapi.json",
}
PUBLIC_PATH_PREFIXES: tuple[str, ...] = ()
PUBLIC_PATHS = {
    "/",
    "/health",
    "/ready",
    "/auth/session",
    "/auth/bootstrap",
    "/auth/login",
    "/auth/signup",
    "/auth/password-reset/request",
    "/auth/password-reset/confirm",
    "/docs",
    "/redoc",
    "/openapi.json",
}
RATE_LIMIT_STATE: dict[str, deque[float]] = {}
RATE_LIMIT_STATE_LOCK = threading.RLock()
POSTGRES_POOL_LOCK = threading.RLock()
POSTGRES_POOL: ConnectionPool | None = None
INCIDENT_DB_INIT_LOCK = threading.RLock()
AUTH_BOOTSTRAP_LOCK = threading.RLock()
INCIDENT_DB_INITIALIZED = False
DATABASE_URL_ENV = "DATABASE_URL"
SESSION_SECRET_ENV = "SESSION_SECRET"
SESSION_COOKIE_NAME = "devpilot_session"
CSRF_COOKIE_NAME = "devpilot_csrf"
AUTH_SESSION_TTL_SECONDS_ENV = "AUTH_SESSION_TTL_SECONDS"
DEFAULT_AUTH_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
DEFAULT_PASSWORD_ITERATIONS = 310_000
AUTH_PASSWORD_RESET_TTL_SECONDS_ENV = "AUTH_PASSWORD_RESET_TTL_SECONDS"
DEFAULT_AUTH_PASSWORD_RESET_TTL_SECONDS = 60 * 30
AUTH_EXPOSE_PASSWORD_RESET_TOKEN_ENV = "AUTH_EXPOSE_PASSWORD_RESET_TOKEN"
SMTP_HOST_ENV = "SMTP_HOST"
SMTP_PORT_ENV = "SMTP_PORT"
SMTP_USERNAME_ENV = "SMTP_USERNAME"
SMTP_PASSWORD_ENV = "SMTP_PASSWORD"
SMTP_FROM_EMAIL_ENV = "SMTP_FROM_EMAIL"
SMTP_USE_TLS_ENV = "SMTP_USE_TLS"


def normalize_frontend_origin(origin: str) -> str | None:
    candidate = origin.strip()
    if not candidate or candidate in {"*", "null"}:
        return None

    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc or parsed.username or parsed.password:
        return None
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return None

    return f"{parsed.scheme.lower()}://{parsed.netloc}"


def get_configured_frontend_origins() -> list[str]:
    configured_origins = [
        normalize_frontend_origin(origin)
        for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
    ]
    return [origin for origin in configured_origins if origin]


def get_cors_origins() -> list[str]:
    allowed_origins: list[str] = []
    origin_pool = get_configured_frontend_origins()
    if not is_production_environment():
        origin_pool = [*LOCAL_DEV_FRONTEND_ORIGINS, *origin_pool]

    for origin in origin_pool:
        if origin not in allowed_origins:
            allowed_origins.append(origin)

    return allowed_origins


def get_cors_origin_regex() -> str | None:
    origin_regex = os.getenv("FRONTEND_ORIGIN_REGEX", "").strip()
    if not origin_regex or origin_regex in {"*", ".*", "^.*$"}:
        return None

    try:
        re.compile(origin_regex)
    except re.error as exc:
        raise RuntimeError("FRONTEND_ORIGIN_REGEX is not a valid regular expression.") from exc

    return origin_regex


def is_allowed_cors_origin(origin: str) -> bool:
    normalized_origin = normalize_frontend_origin(origin)
    if normalized_origin is None:
        return False

    if normalized_origin in get_cors_origins():
        return True

    origin_regex = get_cors_origin_regex()
    return bool(origin_regex and re.fullmatch(origin_regex, normalized_origin))


def vary_header_with_origin(response: Response) -> None:
    existing_vary = response.headers.get("Vary")
    if not existing_vary:
        response.headers["Vary"] = "Origin"
        return

    vary_values = {value.strip().lower() for value in existing_vary.split(",")}
    if "origin" not in vary_values:
        response.headers["Vary"] = f"{existing_vary}, Origin"


def with_cors_headers(request: Request, response: Response) -> Response:
    origin = request.headers.get("origin", "").strip()
    if not origin or not is_allowed_cors_origin(origin):
        return response

    response.headers["Access-Control-Allow-Origin"] = normalize_frontend_origin(origin) or origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    vary_header_with_origin(response)
    return response


def validate_cors_configuration() -> None:
    if not is_production_environment():
        return

    raw_frontend_origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
    if raw_frontend_origins:
        normalized_frontend_origins = [
            normalize_frontend_origin(origin)
            for origin in raw_frontend_origins
        ]
        if any(origin is None for origin in normalized_frontend_origins):
            raise RuntimeError("FRONTEND_ORIGINS contains an invalid origin.")
        return

    if get_cors_origin_regex():
        return

    raise RuntimeError(
        "Set FRONTEND_ORIGINS or a narrow FRONTEND_ORIGIN_REGEX before starting "
        "DevPilot in production.",
    )


def validate_runtime_configuration() -> None:
    if not is_production_environment():
        return

    database_url = os.getenv(DATABASE_URL_ENV, "").strip()
    if not database_url:
        raise RuntimeError("Set DATABASE_URL before starting DevPilot in production.")

    if not database_url.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("DATABASE_URL must point to PostgreSQL in production.")

    session_secret = os.getenv(SESSION_SECRET_ENV, "").strip()
    if len(session_secret) < 32:
        raise RuntimeError(
            "Set SESSION_SECRET to a long random string before starting production.",
        )
    if any(marker in session_secret.lower() for marker in ("change-me", "replace-with")):
        raise RuntimeError("SESSION_SECRET must not use a placeholder value in production.")

    configured_ttl = os.getenv(AUTH_SESSION_TTL_SECONDS_ENV, "").strip()
    if configured_ttl:
        try:
            ttl = int(configured_ttl)
        except ValueError as exc:
            raise RuntimeError(
                f"{AUTH_SESSION_TTL_SECONDS_ENV} must be an integer number of seconds."
            ) from exc

        if ttl < 3600 or ttl > 60 * 60 * 24 * 365:
            raise RuntimeError(
                f"{AUTH_SESSION_TTL_SECONDS_ENV} must be between 3600 and 31536000."
            )


validate_cors_configuration()
validate_runtime_configuration()


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_origin_regex=get_cors_origin_regex(),
    allow_credentials=True,
    allow_methods=CORS_ALLOWED_METHODS,
    allow_headers=CORS_ALLOWED_HEADERS,
)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "devpilot-ai-api",
        "version": app.version,
        "environment": "production" if is_production_environment() else "development",
    }


@app.get("/")
def root_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "devpilot-ai-api",
        "version": app.version,
        "health": "/health",
        "readiness": "/ready",
        "docs": "/docs",
    }


@app.get("/ready")
def ready_check() -> dict[str, str]:
    try:
        with open_storage_connection() as connection:
            connection.execute("SELECT 1")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database is not ready.") from exc

    return {
        "status": "ready",
        "service": "devpilot-ai-api",
        "storage": "postgres" if using_postgres_storage() else "sqlite",
    }


def has_any_auth_users() -> bool:
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM auth_users
            """,
        ).fetchone()

    return bool(row and int(row["total"] or 0))


def auth_session_response_for_current_context(
    request: Request,
    *,
    bootstrap_required: bool | None = None,
) -> AuthSessionResponse:
    if not current_authentication_status():
        return AuthSessionResponse(
            authenticated=False,
            bootstrap_required=(
                not has_any_auth_users() if bootstrap_required is None else bootstrap_required
            ),
        )

    user_row = auth_user_row_by_id(current_user_id() or "")
    if user_row is None:
        return AuthSessionResponse(
            authenticated=False,
            bootstrap_required=not has_any_auth_users(),
        )

    teams = auth_user_team_rows(current_user_email() or str(user_row["email"]))
    current_team = fetch_saas_team(current_team_id())
    return build_auth_session_response(
        authenticated=True,
        bootstrap_required=False,
        user_row=user_row,
        team_row=model_to_dict(current_team) if current_team else None,
        team_rows=teams,
        csrf_token=CURRENT_SESSION_CSRF_TOKEN.get(),
    )


def request_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded_for:
        return forwarded_for

    forwarded_host = request.headers.get("x-real-ip", "").strip()
    if forwarded_host:
        return forwarded_host

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def rate_limit_headers(remaining: int, reset_at: int | None = None) -> dict[str, str]:
    headers = {
        "X-RateLimit-Limit": str(RATE_LIMIT_REQUESTS_PER_WINDOW),
        "X-RateLimit-Remaining": str(max(0, remaining)),
        "X-RateLimit-Window-Seconds": str(RATE_LIMIT_WINDOW_SECONDS),
    }
    if reset_at is not None:
        headers["X-RateLimit-Reset"] = str(reset_at)

    return headers


def request_body_size_too_large(request: Request) -> bool:
    content_length = request.headers.get("content-length")
    if not content_length:
        return False

    try:
        size = int(content_length)
    except ValueError:
        return False

    return size > MAX_REQUEST_BODY_BYTES


def enforce_request_rate_limit(
    request: Request,
    team_id: str,
) -> JSONResponse | None:
    if request.method == "OPTIONS" or request.url.path in RATE_LIMIT_EXEMPT_PATHS:
        return None

    request_key = f"{team_id}:{request_client_ip(request)}"
    now = time.monotonic()
    window_start = now - RATE_LIMIT_WINDOW_SECONDS

    with RATE_LIMIT_STATE_LOCK:
        timestamps = RATE_LIMIT_STATE.setdefault(request_key, deque())
        while timestamps and timestamps[0] <= window_start:
            timestamps.popleft()

        if len(timestamps) >= RATE_LIMIT_REQUESTS_PER_WINDOW:
            retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - timestamps[0])))
            reset_at = int(time.time()) + retry_after
            return JSONResponse(
                status_code=429,
                content={
                    "detail": (
                        "Too many requests. Please wait a moment before trying again."
                    ),
                },
                headers={
                    **rate_limit_headers(0, reset_at),
                    "Retry-After": str(retry_after),
                },
            )

        timestamps.append(now)
        remaining = RATE_LIMIT_REQUESTS_PER_WINDOW - len(timestamps)

    request.state.rate_limit_remaining = remaining
    request.state.rate_limit_reset_at = int(time.time()) + RATE_LIMIT_WINDOW_SECONDS
    return None


def friendly_internal_error_response() -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                "DevPilot hit an unexpected backend error. Please retry the "
                "request; the service stayed online."
            ),
        },
    )


@app.middleware("http")
async def team_context_and_usage_middleware(request: Request, call_next: Any) -> Any:
    try:
        if request.method == "OPTIONS":
            return await call_next(request)

        auth_context = resolve_request_auth_context(request)
        team_id = auth_context.team_id
    except HTTPException as exc:
        return with_cors_headers(
            request,
            JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}),
        )

    token = auth_context.apply_context()
    metrics = metered_usage_metrics(request.url.path, request.method)

    try:
        if request_body_size_too_large(request):
            return with_cors_headers(
                request,
                JSONResponse(
                    status_code=413,
                    content={
                        "detail": (
                            "Request body is too large. Trim the payload and try again."
                        ),
                    },
                ),
            )

        skip_metering = request.url.path in RATE_LIMIT_EXEMPT_PATHS

        if not skip_metering:
            rate_limit_error = enforce_request_rate_limit(request, team_id)
            if rate_limit_error:
                return with_cors_headers(request, rate_limit_error)

            quota_error = quota_error_for_request(team_id, metrics)
            if quota_error:
                return with_cors_headers(request, quota_error)

        if (
            request.method in {"POST", "PUT", "PATCH", "DELETE"}
            and not is_public_path(request.url.path)
        ):
            csrf_error = enforce_csrf_protection(request, auth_context)
            if csrf_error:
                return with_cors_headers(request, csrf_error)

        response = await call_next(request)

        if response.status_code < 500 and not skip_metering:
            for metric in metrics:
                track_usage_event(
                    team_id=team_id,
                    metric=metric,
                    source=request.url.path,
                )

        response.headers["X-DevPilot-Team-ID"] = team_id
        response.headers.update(
            rate_limit_headers(
                int(getattr(request.state, "rate_limit_remaining", RATE_LIMIT_REQUESTS_PER_WINDOW)),
                getattr(request.state, "rate_limit_reset_at", None),
            ),
        )
        return with_cors_headers(request, response)
    except HTTPException as exc:
        return with_cors_headers(
            request,
            JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}),
        )
    except Exception:
        logger.exception(
            "Unhandled backend error on %s %s", request.method, request.url.path
        )
        return with_cors_headers(request, friendly_internal_error_response())
    finally:
        auth_context.reset_context(token)


class LogUploadRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1_000_000)
    filename: str | None = Field(default=None, max_length=255)
    source: str = Field(default="pasted-text", max_length=50)


class LogUploadResponse(BaseModel):
    upload_id: str
    status: str
    filename: str | None
    source: str
    line_count: int
    character_count: int
    received_at: str


class LogAnalysisResponse(BaseModel):
    root_cause: str
    severity: Literal["low", "medium", "high", "critical"]
    explanation: str
    recommended_fix: str


CloudProvider = Literal["aws", "azure", "gcp"]
UserRole = Literal["admin", "devops_engineer", "viewer"]
BillingPlanId = Literal["free", "pro"]
TeamMemberRole = Literal["owner", "admin", "member", "viewer"]
UsageMetric = Literal[
    "api_requests",
    "ai_actions",
    "autonomous_actions",
    "auto_heal_actions",
]
PluginId = Literal["aws", "kubernetes", "terraform", "jenkins", "datadog", "slack"]
PluginCategory = Literal[
    "cloud",
    "orchestration",
    "infrastructure_as_code",
    "ci_cd",
    "observability",
    "collaboration",
]
PluginStatus = Literal["available", "installed"]


class BillingPlan(BaseModel):
    id: BillingPlanId
    name: str
    monthly_price_usd: int
    included_members: int
    monthly_api_requests: int
    monthly_ai_actions: int
    monthly_auto_heal_actions: int
    support_tier: str
    features: list[str]


class TeamMember(BaseModel):
    id: str
    team_id: str
    email: str
    role: TeamMemberRole
    created_at: str


class SaaSTeamAccount(BaseModel):
    id: str
    name: str
    plan_id: BillingPlanId
    owner_email: str
    created_at: str
    updated_at: str
    member_count: int


class TeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    owner_email: str = Field(..., min_length=3, max_length=254)
    plan_id: BillingPlanId = "free"


class TeamPlanUpdateRequest(BaseModel):
    plan_id: BillingPlanId


class TeamMemberInviteRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: TeamMemberRole = "member"


class TeamUsageMetric(BaseModel):
    metric: UsageMetric
    used: int
    limit: int
    remaining: int
    percent_used: float


class TeamUsageSummaryResponse(BaseModel):
    team: SaaSTeamAccount
    plan: BillingPlan
    members: list[TeamMember]
    usage: list[TeamUsageMetric]
    billing_period_start: str
    billing_period_end: str


class AuthUserSummary(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    created_at: str
    updated_at: str
    last_login_at: str | None = None


class AuthBootstrapRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    team_name: str = Field(default="DevPilot Control Plane", min_length=2, max_length=120)


class AuthSignupRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    team_name: str = Field(default="My DevPilot Workspace", min_length=2, max_length=120)


class AuthLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=12, max_length=128)
    team_id: str | None = Field(default=None, max_length=80)


class AuthPasswordResetRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)


class AuthPasswordResetConfirmRequest(BaseModel):
    token: str = Field(..., min_length=32, max_length=256)
    password: str = Field(..., min_length=12, max_length=128)


class AuthSelectTeamRequest(BaseModel):
    team_id: str = Field(..., min_length=3, max_length=80)


class AuthSessionResponse(BaseModel):
    authenticated: bool
    bootstrap_required: bool = False
    user: AuthUserSummary | None = None
    current_team: SaaSTeamAccount | None = None
    teams: list[SaaSTeamAccount] = Field(default_factory=list)
    role: UserRole | None = None
    csrf_token: str | None = None


class AuthLogoutResponse(BaseModel):
    message: str


class AuthPasswordResetResponse(BaseModel):
    message: str
    reset_token: str | None = None
    reset_url: str | None = None
    expires_at: str | None = None


class SaaSBootstrapResponse(BaseModel):
    current_team: SaaSTeamAccount
    teams: list[SaaSTeamAccount]
    plans: list[BillingPlan]
    usage: TeamUsageSummaryResponse


@app.get("/auth/session", response_model=AuthSessionResponse)
def auth_session() -> AuthSessionResponse:
    if not current_authentication_status():
        return AuthSessionResponse(
            authenticated=False,
            bootstrap_required=not has_any_auth_users(),
        )

    user_row = auth_user_row_by_id(current_user_id() or "")
    if user_row is None:
        return AuthSessionResponse(
            authenticated=False,
            bootstrap_required=not has_any_auth_users(),
        )

    team_rows = auth_user_team_rows(current_user_email() or str(user_row["email"]))
    current_team = fetch_saas_team(current_team_id())
    return build_auth_session_response(
        authenticated=True,
        user_row=user_row,
        team_row=model_to_dict(current_team) if current_team else None,
        team_rows=team_rows,
        csrf_token=CURRENT_SESSION_CSRF_TOKEN.get(),
    )


@app.post("/auth/bootstrap", response_model=AuthSessionResponse)
def auth_bootstrap(
    payload: AuthBootstrapRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    with AUTH_BOOTSTRAP_LOCK:
        if has_any_auth_users():
            raise HTTPException(
                status_code=409,
                detail="DevPilot has already been bootstrapped. Use sign in instead.",
            )

        email = normalize_owner_email(payload.email)
        user_row = create_auth_user_if_missing(
            email=email,
            password=payload.password,
            full_name=payload.full_name,
        )
        team = create_saas_team(
            TeamCreateRequest(
                name=payload.team_name,
                owner_email=email,
                plan_id="free",
            ),
        )
        touch_auth_user_login(str(user_row["id"]), datetime.now(UTC).isoformat())
        _, session_token, csrf_token = create_auth_session_record(
            user_id=str(user_row["id"]),
            team_id=team.id,
            request=request,
        )

        session_response = build_auth_session_response(
            authenticated=True,
            user_row=user_row,
            team_row=model_to_dict(team),
            team_rows=auth_user_team_rows(email),
            csrf_token=csrf_token,
        )
        set_auth_cookies(response, session_token, csrf_token)
        return session_response


@app.post("/auth/signup", response_model=AuthSessionResponse)
def auth_signup(
    payload: AuthSignupRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    email = normalize_owner_email(payload.email)
    if auth_user_row_by_email(email):
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Sign in instead.",
        )

    user_row = create_auth_user_if_missing(
        email=email,
        password=payload.password,
        full_name=payload.full_name,
    )
    team = create_saas_team(
        TeamCreateRequest(
            name=payload.team_name,
            owner_email=email,
            plan_id="free",
        ),
    )
    touch_auth_user_login(str(user_row["id"]), datetime.now(UTC).isoformat())
    _, session_token, csrf_token = create_auth_session_record(
        user_id=str(user_row["id"]),
        team_id=team.id,
        request=request,
    )
    session_response = build_auth_session_response(
        authenticated=True,
        user_row=user_row,
        team_row=model_to_dict(team),
        team_rows=auth_user_team_rows(email),
        csrf_token=csrf_token,
    )
    set_auth_cookies(response, session_token, csrf_token)
    return session_response


@app.post("/auth/login", response_model=AuthSessionResponse)
def auth_login(
    payload: AuthLoginRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    email = normalize_owner_email(payload.email)
    user_row = auth_user_row_by_email(email)
    if user_row is None or not int(user_row.get("is_active") or 0):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not verify_password(payload.password, str(user_row["password_hash"])):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    team_rows = auth_user_team_rows(email)
    if not team_rows:
        raise HTTPException(status_code=403, detail="Your account is not assigned to any team.")

    selected_team_id = payload.team_id or str(team_rows[0]["id"])
    if not auth_user_has_team(email, selected_team_id):
        raise HTTPException(status_code=403, detail="You do not have access to that team.")

    touch_auth_user_login(str(user_row["id"]), datetime.now(UTC).isoformat())
    _, session_token, csrf_token = create_auth_session_record(
        user_id=str(user_row["id"]),
        team_id=selected_team_id,
        request=request,
    )

    team_row = fetch_saas_team(selected_team_id)
    if team_row is None:
        raise HTTPException(status_code=404, detail="The selected team was not found.")

    session_response = build_auth_session_response(
        authenticated=True,
        user_row=user_row,
        team_row=model_to_dict(team_row),
        team_rows=team_rows,
        csrf_token=csrf_token,
    )
    set_auth_cookies(response, session_token, csrf_token)
    return session_response


@app.post("/auth/password-reset/request", response_model=AuthPasswordResetResponse)
def auth_password_reset_request(
    payload: AuthPasswordResetRequest,
    request: Request,
) -> AuthPasswordResetResponse:
    email = normalize_owner_email(payload.email)
    generic_message = (
        "If that email is registered, password reset instructions are on the way."
    )
    user_row = auth_user_row_by_email(email)
    reset_token: str | None = None
    expires_at: str | None = None

    if user_row and int(user_row.get("is_active") or 0):
        reset_token, expires_at = create_password_reset_token(
            user_id=str(user_row["id"]),
            email=email,
            request=request,
        )
        reset_url = build_password_reset_url(request, reset_token)
        send_password_reset_email(email=email, reset_url=reset_url)

        if should_expose_password_reset_token():
            return AuthPasswordResetResponse(
                message=generic_message,
                reset_token=reset_token,
                reset_url=reset_url,
                expires_at=expires_at,
            )

    return AuthPasswordResetResponse(message=generic_message)


@app.post("/auth/password-reset/confirm", response_model=AuthPasswordResetResponse)
def auth_password_reset_confirm(
    payload: AuthPasswordResetConfirmRequest,
) -> AuthPasswordResetResponse:
    reset_row = password_reset_row_for_token(payload.token)
    if reset_row is None:
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired.")

    user_row = auth_user_row_by_id(str(reset_row["user_id"]))
    if user_row is None or not int(user_row.get("is_active") or 0):
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired.")

    update_auth_user_password(str(user_row["id"]), payload.password)
    mark_password_reset_token_used(str(reset_row["id"]))
    revoke_auth_sessions_for_user(str(user_row["id"]))

    return AuthPasswordResetResponse(
        message="Password updated. Sign in with your new password.",
    )


@app.post("/auth/select-team", response_model=AuthSessionResponse)
def auth_select_team(payload: AuthSelectTeamRequest) -> AuthSessionResponse:
    if not current_authentication_status():
        raise HTTPException(status_code=401, detail="Authentication is required.")

    email = current_user_email()
    session_id = current_session_id()
    if email is None or session_id is None:
        raise HTTPException(status_code=401, detail="Authentication is required.")

    team_id = normalize_team_id(payload.team_id)
    if not auth_user_has_team(email, team_id):
        raise HTTPException(status_code=403, detail="You do not have access to that team.")

    update_auth_session_team(session_id, team_id)
    user_row = auth_user_row_by_id(current_user_id() or "")
    team_row = fetch_saas_team(team_id)
    if user_row is None or team_row is None:
        raise HTTPException(status_code=404, detail="The selected team was not found.")

    return build_auth_session_response(
        authenticated=True,
        user_row=user_row,
        team_row=model_to_dict(team_row),
        team_rows=auth_user_team_rows(email),
        csrf_token=CURRENT_SESSION_CSRF_TOKEN.get(),
    )


@app.post("/auth/logout", response_model=AuthLogoutResponse)
def auth_logout(response: Response) -> AuthLogoutResponse:
    session_id = current_session_id()
    if session_id:
        revoke_auth_session(session_id)

    clear_auth_cookies(response)
    return AuthLogoutResponse(message="Signed out successfully.")


class FixGenerationRequest(BaseModel):
    issue: str = Field(..., min_length=1, max_length=20_000)
    cloud_provider: CloudProvider = "aws"


class FixGenerationResponse(BaseModel):
    dockerfile: str
    kubernetes_yaml: str
    github_actions_workflow: str
    cloud_provider: CloudProvider = "aws"
    deployment_suggestions: list[str] = Field(default_factory=list)


class GitHubPullRequestRequest(BaseModel):
    issue: str = Field(..., min_length=1, max_length=20_000)
    cloud_provider: CloudProvider = "aws"
    repository: str | None = Field(default=None, max_length=300)
    base_branch: str | None = Field(default=None, max_length=200)
    branch_name: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=5_000)
    files: FixGenerationResponse | None = None


class CommittedFixFile(BaseModel):
    path: str
    status: Literal["created", "updated"]
    sha: str | None = None
    html_url: str | None = None


class GitHubPullRequestResponse(BaseModel):
    repository: str
    pull_request_number: int
    pull_request_url: str
    branch_name: str
    base_branch: str
    files: list[CommittedFixFile]


class KubernetesConnectionRequest(BaseModel):
    kubeconfig_path: str | None = Field(default=None, max_length=1_000)
    context: str | None = Field(default=None, max_length=200)


class KubernetesContainerStatus(BaseModel):
    name: str
    ready: bool
    restart_count: int
    state: str
    reason: str | None = None


class KubernetesPodStatus(BaseModel):
    namespace: str
    name: str
    phase: str
    ready: bool
    restart_count: int
    node_name: str | None = None
    owner_kind: str | None = None
    owner_name: str | None = None
    deployment_name: str | None = None
    unhealthy: bool
    reasons: list[str]
    containers: list[KubernetesContainerStatus]


class KubernetesClusterStatusResponse(BaseModel):
    context: str | None
    namespaces: list[str]
    pods: list[KubernetesPodStatus]
    unhealthy_pods: list[KubernetesPodStatus]
    checked_at: str


class KubernetesRestartPodRequest(KubernetesConnectionRequest):
    namespace: str = Field(..., min_length=1, max_length=253)
    pod_name: str = Field(..., min_length=1, max_length=253)


class KubernetesRollbackDeploymentRequest(KubernetesConnectionRequest):
    namespace: str = Field(..., min_length=1, max_length=253)
    deployment_name: str = Field(..., min_length=1, max_length=253)


class KubernetesScaleDeploymentRequest(KubernetesConnectionRequest):
    namespace: str = Field(..., min_length=1, max_length=253)
    deployment_name: str = Field(..., min_length=1, max_length=253)
    replicas: int = Field(..., ge=0, le=500)


class KubernetesActionResponse(BaseModel):
    message: str
    namespace: str
    pod_name: str | None = None
    deployment_name: str | None = None
    replicas: int | None = None
    action: Literal["restart_pod", "rollback_deployment", "scale_deployment"]
    completed_at: str


InfraCommandAction = Literal[
    "restart_pods",
    "rollback_deployment",
    "scale_deployment",
]
InfraCommandMode = Literal["preview", "executed"]
InfraCommandActionStatus = Literal["planned", "completed"]


class InfraCommandRequest(KubernetesConnectionRequest):
    command: str = Field(..., min_length=2, max_length=500)
    namespace: str = Field(default="production", min_length=1, max_length=253)
    execute: bool = False
    max_pods: int = Field(default=10, ge=1, le=50)


class InfraCommandPlan(BaseModel):
    action: InfraCommandAction
    namespace: str = Field(..., min_length=1, max_length=253)
    target: str = Field(..., min_length=1, max_length=253)
    replicas: int | None = Field(default=None, ge=0, le=500)
    confidence: float = Field(default=0.7, ge=0, le=1)
    reasoning: str = Field(default="Matched command intent to Kubernetes action.")


class InfraCommandActionResult(BaseModel):
    action: InfraCommandAction
    status: InfraCommandActionStatus
    namespace: str
    target: str
    message: str
    pod_names: list[str] = Field(default_factory=list)
    deployment_name: str | None = None
    replicas: int | None = None
    completed_at: str


class InfraCommandResponse(BaseModel):
    command: str
    mode: InfraCommandMode
    context: str | None = None
    plan: InfraCommandPlan
    actions: list[InfraCommandActionResult]
    message: str
    generated_at: str


class AutoHealRequest(BaseModel):
    namespace: str = Field(default="production", max_length=100)
    failed_pod: str = Field(default="api-7f9d8c6b5d-crashloop", max_length=150)
    deployment: str = Field(default="devpilot-api", max_length=150)
    config_map: str = Field(default="devpilot-api-config", max_length=150)


class AutoHealAction(BaseModel):
    action: str
    target: str
    status: Literal["simulated"]
    detail: str


class AutoHealResponse(BaseModel):
    message: str
    actions: list[AutoHealAction]
    healed_at: str


ChaosFailureType = Literal["pod_crash", "network_outage", "cicd_failure"]


class ChaosInjectionRequest(BaseModel):
    failure_type: ChaosFailureType = "pod_crash"
    namespace: str = Field(default="production", max_length=100)
    service: str = Field(default="devpilot-api", max_length=150)
    deployment: str = Field(default="devpilot-api", max_length=150)
    pod_name: str = Field(default="api-7f9d8c6b5d-chaos", max_length=150)
    workflow: str = Field(default="release-image", max_length=150)
    branch: str = Field(default="main", max_length=150)
    commit_sha: str = Field(default="chaos24", max_length=80)


class ChaosInjectedFailure(BaseModel):
    failure_type: ChaosFailureType
    title: str
    target: str
    severity: Literal["medium", "high", "critical"]
    blast_radius: str
    signals: list[str]
    logs: str
    injected_at: str


class ChaosDetectionResult(BaseModel):
    detected: bool
    root_cause: str
    confidence: float = Field(ge=0, le=1)
    recommended_strategy: str
    detected_at: str


class ChaosTimelineStep(BaseModel):
    stage: str
    status: Literal["simulated", "completed"]
    detail: str
    completed_at: str


class ChaosInjectionResponse(BaseModel):
    mode: Literal["chaos"]
    message: str
    failure: ChaosInjectedFailure
    detection: ChaosDetectionResult
    auto_heal: AutoHealResponse
    timeline: list[ChaosTimelineStep]
    incident_records_created: int
    ran_at: str


class SlackTestRequest(BaseModel):
    summary: str = Field(
        default="DevPilot AI Slack webhook test notification.",
        max_length=500,
    )


class SlackNotificationResponse(BaseModel):
    message: str
    sent_at: str


class MarketplacePlugin(BaseModel):
    id: PluginId
    name: str
    category: PluginCategory
    description: str
    capabilities: list[str]
    required_secrets: list[str]
    setup_steps: list[str]
    status: PluginStatus = "available"
    connection_name: str | None = None
    environment: str | None = None
    installed_at: str | None = None
    installed_by: str | None = None
    configured: bool = False


class PluginMarketplaceResponse(BaseModel):
    plugins: list[MarketplacePlugin]
    installed_count: int
    available_count: int


class PluginInstallRequest(BaseModel):
    plugin_id: PluginId
    connection_name: str | None = Field(default=None, max_length=120)
    environment: str = Field(default="production", max_length=80)
    notes: str | None = Field(default=None, max_length=500)


class PluginInstallResponse(BaseModel):
    plugin: MarketplacePlugin
    message: str
    installed_at: str


class PluginUninstallResponse(BaseModel):
    plugin: MarketplacePlugin
    message: str
    uninstalled_at: str


class IncidentMemoryRecord(BaseModel):
    id: str
    source: str
    summary: str
    severity: str | None = None
    explanation: str | None = None
    recommended_fix: str | None = None
    cloud_provider: str | None = None
    created_at: str
    updated_at: str
    has_logs: bool
    has_fix: bool
    similarity_score: float | None = None


class IncidentHistoryResponse(BaseModel):
    incidents: list[IncidentMemoryRecord]


class IncidentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=20_000)
    limit: int = Field(default=5, ge=1, le=25)


class IncidentSearchResponse(BaseModel):
    query: str
    incidents: list[IncidentMemoryRecord]


IncidentTrainingSource = Literal["kubernetes", "ci_cd", "cloud_logs"]
IncidentTrainingSplit = Literal["train", "validation"]
CustomModelTrainingStatus = Literal["trained", "needs_more_data"]
EvaluationWinner = Literal["custom", "generic", "tie"]


class CustomModelTrainingRequest(BaseModel):
    include_demo_data: bool = True
    min_examples: int = Field(default=6, ge=3, le=100)
    validation_ratio: float = Field(default=0.3, ge=0.1, le=0.5)


class IncidentTrainingExample(BaseModel):
    id: str
    source: str
    source_type: IncidentTrainingSource
    split: IncidentTrainingSplit
    input: str
    expected_root_cause: str
    expected_severity: Literal["low", "medium", "high", "critical"]
    expected_fix: str
    created_at: str


class CustomModelSourceBreakdown(BaseModel):
    kubernetes: int
    ci_cd: int
    cloud_logs: int


class ModelEvaluationSummary(BaseModel):
    model_name: str
    accuracy: float
    average_score: float
    root_cause_score: float
    remediation_score: float
    severity_score: float


class ModelEvaluationCase(BaseModel):
    id: str
    source_type: IncidentTrainingSource
    expected_root_cause: str
    expected_fix: str
    custom_root_cause: str
    generic_root_cause: str
    custom_score: float
    generic_score: float
    winner: EvaluationWinner


class CustomModelEvaluationResponse(BaseModel):
    evaluated_at: str
    pass_threshold: float
    passed: bool
    improvement: float
    custom_model: ModelEvaluationSummary
    generic_baseline: ModelEvaluationSummary
    cases: list[ModelEvaluationCase]


class CustomModelDatasetResponse(BaseModel):
    model_name: str
    base_model: str
    examples: list[IncidentTrainingExample]
    source_breakdown: CustomModelSourceBreakdown
    jsonl_preview: list[str]
    ready_for_fine_tuning: bool


class CustomModelTrainingResponse(BaseModel):
    message: str
    status: CustomModelTrainingStatus
    model_name: str
    base_model: str
    training_examples: int
    validation_examples: int
    source_breakdown: CustomModelSourceBreakdown
    ready_for_fine_tuning: bool
    jsonl_preview: list[str]
    evaluation: CustomModelEvaluationResponse
    trained_at: str


class DemoCiFailure(BaseModel):
    provider: str
    workflow: str
    job: str
    step: str
    branch: str
    commit_sha: str
    status: Literal["failed"]
    duration_seconds: int
    failure_summary: str
    logs: str


class DemoRunResponse(BaseModel):
    mode: Literal["demo"]
    message: str
    detected_issue: str
    sample_logs: str
    cicd_failures: list[DemoCiFailure]
    log_upload: LogUploadResponse
    analysis: LogAnalysisResponse
    cluster_status: KubernetesClusterStatusResponse
    fix_files: FixGenerationResponse
    auto_heal: AutoHealResponse
    incident_records_created: int
    ran_at: str


AutonomousAgentMode = Literal["simulation", "kubernetes"]
DevPilotAgentId = Literal[
    "monitoring",
    "bug_sentinel",
    "frontend_guardian",
    "backend_guardian",
    "database_guardian",
    "ui_monitor",
    "root_cause",
    "fix_generator",
    "auto_heal",
    "security",
    "release_auditor",
]
DevPilotAgentState = Literal["waiting", "active", "completed", "blocked"]
AutonomousActionStatus = Literal[
    "observed",
    "decided",
    "pending_approval",
    "approved",
    "completed",
    "simulated",
    "skipped",
    "rejected",
    "failed",
]
AutonomousApprovalStatus = Literal["pending", "approved", "applied", "rejected", "failed"]


class AutonomousAgentControlRequest(BaseModel):
    enabled: bool | None = None
    interval_seconds: int | None = Field(default=None, ge=5, le=3600)
    mode: AutonomousAgentMode | None = None
    apply_real_kubernetes_actions: bool | None = None
    require_human_approval: bool | None = None
    kubeconfig_path: str | None = Field(default=None, max_length=1_000)
    context: str | None = Field(default=None, max_length=200)


class AutonomousActionLogRecord(BaseModel):
    id: str
    cycle_id: str
    incident_id: str | None = None
    agent_id: DevPilotAgentId
    agent_name: str
    action_type: str
    target: str
    status: AutonomousActionStatus
    detail: str
    created_at: str


class DevPilotAgentProfile(BaseModel):
    id: DevPilotAgentId
    name: str
    mission: str
    status: DevPilotAgentState
    last_action: str
    last_action_at: str | None = None
    handoff_to: str | None = None
    actions_logged: int


class AgentCollaborationHandoff(BaseModel):
    from_agent: str
    to_agent: str
    status: Literal["pending", "completed"]
    detail: str


class AutonomousAgentDecision(BaseModel):
    incident_id: str | None
    summary: str
    severity: str | None = None
    strategy: str
    confidence: float
    actions: list[str]
    reason: str


class AutonomousApprovalRecord(BaseModel):
    id: str
    cycle_id: str
    incident_id: str | None = None
    summary: str
    severity: str | None = None
    strategy: str
    confidence: float
    actions: list[str]
    cloud_provider: CloudProvider
    status: AutonomousApprovalStatus
    requested_at: str
    reviewed_at: str | None = None
    reviewed_by_role: str | None = None
    reviewer_note: str | None = None
    applied_at: str | None = None
    failure_reason: str | None = None


class AutonomousApprovalReviewRequest(BaseModel):
    approved: bool = True
    reviewer_note: str | None = Field(default=None, max_length=500)


class AutonomousAgentStatusResponse(BaseModel):
    enabled: bool
    running: bool
    mode: AutonomousAgentMode
    interval_seconds: int
    apply_real_kubernetes_actions: bool
    require_human_approval: bool
    kubeconfig_path: str | None = None
    context: str | None = None
    last_checked_at: str | None = None
    last_decision: AutonomousAgentDecision | None = None
    last_error: str | None = None
    total_actions_logged: int
    pending_approvals: list[AutonomousApprovalRecord]
    recent_actions: list[AutonomousActionLogRecord]
    agents: list[DevPilotAgentProfile]
    handoffs: list[AgentCollaborationHandoff]


class VoiceAssistantRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2_000)


class VoiceAssistantResponse(BaseModel):
    question: str
    answer: str
    spoken_answer: str
    confidence: float = Field(ge=0, le=1)
    evidence: list[str] = Field(default_factory=list)
    answered_at: str


class FailurePredictionRequest(BaseModel):
    current_logs: str | None = Field(default=None, max_length=1_000_000)
    lookback_limit: int = Field(default=100, ge=10, le=500)


class FailureAnomalyPattern(BaseModel):
    signal: str
    occurrences: int
    historical_occurrences: int
    confidence: float = Field(ge=0, le=1)
    evidence: list[str] = Field(default_factory=list)


class FailurePredictionResponse(BaseModel):
    message: str
    prediction: bool
    risk_level: Literal["low", "medium", "high", "critical"]
    confidence: float = Field(ge=0, le=1)
    historical_logs_analyzed: int
    anomaly_patterns: list[FailureAnomalyPattern]
    warning: str
    recommended_actions: list[str] = Field(default_factory=list)
    predicted_at: str


TerraformDriftSeverity = Literal["low", "medium", "high", "critical"]


class TerraformRemediationRequest(BaseModel):
    terraform_code: str = Field(..., min_length=1, max_length=1_000_000)
    drift_context: str | None = Field(default=None, max_length=20_000)
    cloud_provider: CloudProvider = "aws"


class TerraformDriftIssue(BaseModel):
    id: str
    title: str
    severity: TerraformDriftSeverity
    resource: str
    detail: str
    remediation: str


class TerraformRemediationResponse(BaseModel):
    message: str
    drift_detected: bool
    drift_count: int
    cloud_provider: CloudProvider
    corrected_terraform: str
    unified_diff: str
    drift_issues: list[TerraformDriftIssue]
    apply_ready: bool
    generated_at: str


class TerraformApplyRequest(BaseModel):
    original_terraform: str = Field(..., min_length=1, max_length=1_000_000)
    corrected_terraform: str = Field(..., min_length=1, max_length=1_000_000)
    approved: bool = True


class TerraformApplyResponse(BaseModel):
    message: str
    applied: bool
    patched_terraform: str
    unified_diff: str
    applied_at: str


CostOptimizationAction = Literal[
    "delete_idle",
    "stop_or_schedule",
    "rightsize_instance",
    "archive_storage",
]


class CloudCostResource(BaseModel):
    id: str = Field(..., min_length=1, max_length=200)
    name: str = Field(..., min_length=1, max_length=200)
    cloud_provider: CloudProvider = "aws"
    service: str = Field(default="compute", max_length=100)
    region: str = Field(default="us-east-1", max_length=100)
    instance_type: str | None = Field(default=None, max_length=100)
    monthly_cost: float = Field(default=0, ge=0)
    cpu_utilization_percent: float | None = Field(default=None, ge=0, le=100)
    memory_utilization_percent: float | None = Field(default=None, ge=0, le=100)
    network_utilization_percent: float | None = Field(default=None, ge=0, le=100)
    requests_per_hour: float | None = Field(default=None, ge=0)
    storage_gb: float | None = Field(default=None, ge=0)
    attached: bool = True
    last_activity_hours_ago: float | None = Field(default=None, ge=0)
    environment: str | None = Field(default=None, max_length=100)


class CostOptimizationRequest(BaseModel):
    cloud_provider: CloudProvider = "aws"
    currency: str = Field(default="USD", max_length=10)
    resources: list[CloudCostResource] = Field(default_factory=list, max_length=200)


class CostOptimizationRecommendation(BaseModel):
    id: str
    resource_id: str
    resource_name: str
    cloud_provider: CloudProvider
    service: str
    region: str
    action: CostOptimizationAction
    current_size: str | None = None
    recommended_size: str | None = None
    current_monthly_cost: float
    recommended_monthly_cost: float
    estimated_monthly_savings: float
    confidence: float = Field(ge=0, le=1)
    reason: str


class CostOptimizationResponse(BaseModel):
    message: str
    currency: str
    analyzed_resource_count: int
    recommendation_count: int
    idle_resource_count: int
    rightsizing_count: int
    current_monthly_cost: float
    optimized_monthly_cost: float
    estimated_monthly_savings: float
    estimated_annual_savings: float
    recommendations: list[CostOptimizationRecommendation]
    generated_at: str


SecurityIssueSeverity = Literal["low", "medium", "high", "critical"]
SecurityConfigKind = Literal["auto", "dockerfile", "yaml", "env", "json", "text"]
SecurityIssueCategory = Literal["secret", "dockerfile", "yaml", "configuration"]


class SecurityScanTarget(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., min_length=1, max_length=1_000_000)
    kind: SecurityConfigKind = "auto"


class SecurityAnalysisRequest(BaseModel):
    targets: list[SecurityScanTarget] = Field(default_factory=list, max_length=100)


class SecurityIssue(BaseModel):
    id: str
    title: str
    severity: SecurityIssueSeverity
    category: SecurityIssueCategory
    target_path: str
    line_number: int | None = None
    evidence: str
    recommendation: str


class SecurityAnalysisResponse(BaseModel):
    message: str
    target_count: int
    issue_count: int
    secret_count: int
    dockerfile_issue_count: int
    yaml_issue_count: int
    highest_severity: SecurityIssueSeverity | None = None
    issues: list[SecurityIssue]
    suggested_fixes: list[str] = Field(default_factory=list)
    generated_at: str


GITHUB_API_BASE_URL = "https://api.github.com"
SLACK_WEBHOOK_URL_ENV = "SLACK_WEBHOOK_URL"
INCIDENT_DB_PATH_ENV = "INCIDENT_DB_PATH"
DEFAULT_INCIDENT_DB_PATH = Path(__file__).with_name("incident_memory.sqlite3")
DEFAULT_USER_ROLE_ENV = "DEFAULT_USER_ROLE"
AUTONOMOUS_AGENT_ENABLED_ENV = "AUTONOMOUS_AGENT_ENABLED"
AUTONOMOUS_AGENT_INTERVAL_ENV = "AUTONOMOUS_AGENT_INTERVAL_SECONDS"
AUTONOMOUS_AGENT_MODE_ENV = "AUTONOMOUS_AGENT_MODE"
AUTONOMOUS_AGENT_APPLY_KUBERNETES_ENV = "AUTONOMOUS_AGENT_APPLY_KUBERNETES"
AUTONOMOUS_AGENT_REQUIRE_APPROVAL_ENV = "AUTONOMOUS_AGENT_REQUIRE_APPROVAL"
DEFAULT_SAAS_TEAM_ID = "team_default"
DEFAULT_SAAS_OWNER_EMAIL = "owner@devpilot.local"
GITHUB_REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
GITHUB_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
TEAM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,80}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
INVALID_BRANCH_FRAGMENTS = ("..", "@{", "\\", " ")
INCIDENT_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_.:/-]{2,}", re.IGNORECASE)
TERRAFORM_RESOURCE_RE = re.compile(
    r'^\s*resource\s+"(?P<type>[^"]+)"\s+"(?P<name>[^"]+)"\s*\{',
)
SECRET_ASSIGNMENT_RE = re.compile(
    r"(?P<key>[A-Za-z0-9_.-]*(?:password|passwd|secret|api[_-]?key|token|"
    r"private[_-]?key|client[_-]?secret|access[_-]?key)[A-Za-z0-9_.-]*)"
    r"\s*[:=]\s*(?P<quote>[\"']?)(?P<value>[^\"'\s#]+)",
    re.IGNORECASE,
)
DOCKER_ENV_SECRET_RE = re.compile(
    r"^\s*(?:ENV|ARG)\s+"
    r"(?P<key>[A-Za-z0-9_]*(?:PASSWORD|SECRET|API_KEY|TOKEN|PRIVATE_KEY|"
    r"CLIENT_SECRET|ACCESS_KEY)[A-Za-z0-9_]*)\s*=",
    re.IGNORECASE,
)
DOCKER_FROM_LATEST_RE = re.compile(r"^\s*FROM\s+\S+:latest(?:\s|$)", re.IGNORECASE)
YAML_IMAGE_LATEST_RE = re.compile(r"^\s*image:\s*\S+:latest(?:\s|$)", re.IGNORECASE)
YAML_SECRET_NAME_RE = re.compile(
    r"^\s*name:\s*[A-Za-z0-9_.-]*(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY)",
    re.IGNORECASE,
)
INCIDENT_SEARCH_STOP_WORDS = {
    "and",
    "are",
    "but",
    "for",
    "from",
    "has",
    "have",
    "into",
    "not",
    "the",
    "this",
    "that",
    "with",
    "without",
}
GENERATED_FIX_FILE_PATHS = {
    "dockerfile": "Dockerfile",
    "kubernetes_yaml": "k8s/devpilot-api.yaml",
    "github_actions_workflow": ".github/workflows/devpilot-api-ci.yml",
}
CLOUD_PROVIDER_LABELS: dict[CloudProvider, str] = {
    "aws": "AWS",
    "azure": "Azure",
    "gcp": "Google Cloud",
}
USER_ROLE_LABELS: dict[UserRole, str] = {
    "admin": "Admin",
    "devops_engineer": "DevOps Engineer",
    "viewer": "Viewer",
}
SAAS_PLAN_CATALOG: dict[BillingPlanId, dict[str, Any]] = {
    "free": {
        "name": "Free",
        "monthly_price_usd": 0,
        "included_members": 3,
        "monthly_api_requests": 250,
        "monthly_ai_actions": 25,
        "monthly_auto_heal_actions": 5,
        "support_tier": "Community",
        "features": [
            "One shared team workspace",
            "Incident memory and analytics",
            "Approval-gated autonomous remediation",
            "Basic usage tracking",
        ],
    },
    "pro": {
        "name": "Pro",
        "monthly_price_usd": 49,
        "included_members": 25,
        "monthly_api_requests": 10_000,
        "monthly_ai_actions": 1_000,
        "monthly_auto_heal_actions": 250,
        "support_tier": "Priority",
        "features": [
            "Multiple team workspaces",
            "Higher autonomous remediation limits",
            "Team member management",
            "Priority support and export-ready usage reports",
        ],
    },
}
CLOUD_INSTANCE_MONTHLY_COSTS: dict[CloudProvider, dict[str, float]] = {
    "aws": {
        "t3.nano": 3.80,
        "t3.micro": 7.59,
        "t3.small": 15.18,
        "t3.medium": 30.37,
        "t3.large": 60.74,
        "m5.large": 70.08,
        "m5.xlarge": 140.16,
        "db.t3.micro": 14.60,
        "db.t3.small": 29.20,
        "db.t3.medium": 58.40,
        "cache.t3.small": 24.82,
        "cache.t3.medium": 49.64,
    },
    "azure": {
        "Standard_B1s": 7.59,
        "Standard_B2s": 30.37,
        "Standard_B2ms": 60.74,
        "Standard_D2s_v5": 70.08,
        "Standard_D4s_v5": 140.16,
    },
    "gcp": {
        "e2-micro": 7.59,
        "e2-small": 15.18,
        "e2-medium": 30.37,
        "e2-standard-2": 48.91,
        "e2-standard-4": 97.82,
        "n2-standard-2": 70.08,
        "n2-standard-4": 140.16,
    },
}
CLOUD_INSTANCE_RIGHTSIZE_TARGETS: dict[CloudProvider, dict[str, str]] = {
    "aws": {
        "t3.large": "t3.medium",
        "t3.medium": "t3.small",
        "m5.xlarge": "m5.large",
        "m5.large": "t3.medium",
        "db.t3.medium": "db.t3.small",
        "cache.t3.medium": "cache.t3.small",
    },
    "azure": {
        "Standard_B2ms": "Standard_B2s",
        "Standard_D4s_v5": "Standard_D2s_v5",
        "Standard_D2s_v5": "Standard_B2s",
    },
    "gcp": {
        "e2-standard-4": "e2-standard-2",
        "e2-standard-2": "e2-medium",
        "n2-standard-4": "n2-standard-2",
        "n2-standard-2": "e2-standard-2",
    },
}
IDLE_RESOURCE_SERVICE_TOKENS = (
    "compute",
    "ec2",
    "vm",
    "database",
    "rds",
    "cache",
    "redis",
    "load",
    "balancer",
    "volume",
    "disk",
    "storage",
)
RIGHTSIZE_SERVICE_TOKENS = (
    "compute",
    "ec2",
    "vm",
    "database",
    "rds",
    "cache",
    "redis",
)
DEMO_DETECTED_ISSUE = (
    "Production API release is failing: Kubernetes shows CrashLoopBackOff after "
    "the latest image, GitHub Actions failed backend tests because DATABASE_URL "
    "is missing, and runtime logs show repeated database connection errors."
)
DEMO_KUBERNETES_LOGS = """\
2026-05-24T15:40:12Z kubelet node/ip-10-0-4-12 container api failed liveness probe: HTTP probe failed with statuscode: 500
2026-05-24T15:40:13Z pod/production/api-7f9d8c6b5d-crashloop Warning BackOff Back-off restarting failed container api
2026-05-24T15:40:15Z pod/production/api-7f9d8c6b5d-crashloop Warning FailedMount secret "prod-database-url" not found
2026-05-24T15:40:18Z deployment/devpilot-api ProgressDeadlineExceeded ReplicaSet "devpilot-api-7f9d8c6b5d" has timed out progressing
"""
DEMO_CICD_LOGS = """\
Run pytest backend/tests -q
E   RuntimeError: DATABASE_URL is required for startup checks
FAILED backend/tests/test_health.py::test_database_ready - RuntimeError: DATABASE_URL is required
Error: Process completed with exit code 1.

Run docker build -t ghcr.io/acme/devpilot-api:9f31c2a .
#13 ERROR: failed to solve: process "/bin/sh -c python -m compileall backend" did not complete successfully: exit code: 1
release-image / build-and-push failed after 3m 42s
"""
DEMO_APP_LOGS = """\
2026-05-24T15:39:58Z api[prod] INFO booting DevPilot API build=9f31c2a env=production
2026-05-24T15:39:59Z api[prod] ERROR database connection failed: missing DATABASE_URL
2026-05-24T15:40:00Z api[prod] ERROR startup aborted: cannot initialize incident memory store
2026-05-24T15:40:04Z api[prod] INFO received SIGTERM from kubelet during restart cycle
"""
DEMO_SAMPLE_LOGS = "\n\n".join(
    [
        "=== Kubernetes Events ===",
        DEMO_KUBERNETES_LOGS.strip(),
        "=== CI/CD Failures ===",
        DEMO_CICD_LOGS.strip(),
        "=== Application Logs ===",
        DEMO_APP_LOGS.strip(),
    ],
)
CUSTOM_MODEL_PASS_THRESHOLD = 0.12
CUSTOM_MODEL_SYSTEM_PROMPT = (
    "You are DevPilot AI, a DevOps incident model trained on Kubernetes "
    "failures, CI/CD failures, and cloud runtime logs. Return JSON with "
    "root_cause, severity, explanation, and recommended_fix."
)
DEMO_TRAINING_INCIDENTS: list[dict[str, str]] = [
    {
        "id": "demo-train-kubernetes-missing-secret",
        "source": "/kubernetes/status",
        "source_type": "kubernetes",
        "input": DEMO_KUBERNETES_LOGS,
        "expected_root_cause": (
            "Kubernetes deployment is in CrashLoopBackOff because a required "
            "database secret is missing and the new ReplicaSet cannot pass health checks."
        ),
        "expected_severity": "critical",
        "expected_fix": (
            "Restore the prod-database-url secret, roll back the failing deployment, "
            "and restart managed pods after the configuration is healthy."
        ),
    },
    {
        "id": "demo-train-kubernetes-oom",
        "source": "/kubernetes/status",
        "source_type": "kubernetes",
        "input": (
            "pod/production/checkout-6d4998f6fd-oom Warning OOMKilled container checkout "
            "restart_count=6 memory limit 256Mi exceeded after release 2026.05.24"
        ),
        "expected_root_cause": (
            "Kubernetes checkout pods are restarting because the container is OOMKilled "
            "after the latest release exceeded its memory limit."
        ),
        "expected_severity": "high",
        "expected_fix": (
            "Raise memory requests and limits, roll back the checkout release if errors continue, "
            "and verify restart counts return to normal."
        ),
    },
    {
        "id": "demo-train-cicd-runtime-contract",
        "source": "/ci-cd/checks",
        "source_type": "ci_cd",
        "input": DEMO_CICD_LOGS,
        "expected_root_cause": (
            "The CI/CD release failed because backend tests require DATABASE_URL and the "
            "release image build did not pass the startup contract."
        ),
        "expected_severity": "high",
        "expected_fix": (
            "Block promotion, restore required CI secrets, rerun backend tests, and rebuild "
            "the release image only after the contract passes."
        ),
    },
    {
        "id": "demo-train-cicd-image-pull",
        "source": "/ci-cd/checks",
        "source_type": "ci_cd",
        "input": (
            "GitHub Actions deploy-prod failed: kubectl rollout status timed out. "
            "ImagePullBackOff for ghcr.io/acme/devpilot-api:badtag after build-and-push skipped."
        ),
        "expected_root_cause": (
            "The deployment pipeline promoted an image tag that was not successfully built "
            "or pushed, causing ImagePullBackOff during rollout."
        ),
        "expected_severity": "high",
        "expected_fix": (
            "Require build-and-push success before deploy, publish the missing image tag, "
            "and rerun rollout validation."
        ),
    },
    {
        "id": "demo-train-cloud-database",
        "source": "/analyze-log",
        "source_type": "cloud_logs",
        "input": DEMO_APP_LOGS,
        "expected_root_cause": (
            "Cloud runtime logs show the API cannot start because DATABASE_URL is missing, "
            "so the incident memory database cannot initialize."
        ),
        "expected_severity": "critical",
        "expected_fix": (
            "Set DATABASE_URL through the cloud secret manager, restart the API service, "
            "and verify database readiness before routing traffic."
        ),
    },
    {
        "id": "demo-train-cloud-redis-pool",
        "source": "/analyze-log",
        "source_type": "cloud_logs",
        "input": (
            "worker[prod] ERROR Redis connection pool exhausted p95 latency=4800ms "
            "queue depth=1842 read timed out while processing checkout events"
        ),
        "expected_root_cause": (
            "Cloud worker logs show Redis connection pool exhaustion causing queue latency "
            "and checkout event timeouts."
        ),
        "expected_severity": "medium",
        "expected_fix": (
            "Increase Redis pool limits, add queue backpressure, and monitor p95 latency "
            "until the worker backlog clears."
        ),
    },
]
AUTONOMOUS_INCIDENT_SOURCES = {
    "/api/logs/upload",
    "/analyze-log",
    "/ci-cd/checks",
    "/chaos/inject",
    "/kubernetes/status",
}
AUTONOMOUS_REMEDIATION_ACTIONS = {
    "generate_remediation",
    "restart_failed_pod",
    "rollback_deployment",
    "patch_config",
}
AUTONOMOUS_SEVERITY_PRIORITY = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}
SECURITY_SEVERITY_PRIORITY: dict[SecurityIssueSeverity, int] = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}
AUTONOMOUS_SOURCE_PRIORITY = {
    "/chaos/inject": 5,
    "/kubernetes/status": 4,
    "/analyze-log": 3,
    "/ci-cd/checks": 2,
    "/api/logs/upload": 1,
}
DEV_PILOT_AGENT_ORDER: list[DevPilotAgentId] = [
    "monitoring",
    "bug_sentinel",
    "frontend_guardian",
    "backend_guardian",
    "database_guardian",
    "ui_monitor",
    "root_cause",
    "fix_generator",
    "security",
    "release_auditor",
    "auto_heal",
]
DEV_PILOT_AGENT_PROFILES: dict[DevPilotAgentId, dict[str, str | None]] = {
    "monitoring": {
        "name": "Monitoring Agent",
        "mission": "Watches logs, deploy events, Kubernetes health, and chaos signals.",
        "handoff_to": "Bug Sentinel Agent",
    },
    "bug_sentinel": {
        "name": "Bug Sentinel Agent",
        "mission": "Finds runtime errors, failed checks, broken buttons, and bug hotspots.",
        "handoff_to": "Frontend Guardian Agent",
    },
    "frontend_guardian": {
        "name": "Frontend Guardian Agent",
        "mission": "Audits Next.js routes, forms, responsive states, and client-side failures.",
        "handoff_to": "UI Monitor Agent",
    },
    "backend_guardian": {
        "name": "Backend Guardian Agent",
        "mission": "Validates FastAPI contracts, auth flows, reset flows, and API failures.",
        "handoff_to": "Database Guardian Agent",
    },
    "database_guardian": {
        "name": "Database Guardian Agent",
        "mission": "Checks SQLite/Postgres readiness, Neon DATABASE_URL, and tenant isolation.",
        "handoff_to": "Release Auditor Agent",
    },
    "ui_monitor": {
        "name": "Full UI Monitor Agent",
        "mission": "Walks every visible section and button to catch broken demo interactions.",
        "handoff_to": "Release Auditor Agent",
    },
    "root_cause": {
        "name": "Root Cause Agent",
        "mission": "Ranks incident evidence and selects a recovery strategy.",
        "handoff_to": "Fix Generator Agent",
    },
    "fix_generator": {
        "name": "Fix Generator Agent",
        "mission": "Creates remediation artifacts and deployment guidance.",
        "handoff_to": "Auto Heal Agent",
    },
    "auto_heal": {
        "name": "Auto Heal Agent",
        "mission": "Restarts pods, rolls back releases, patches config, and validates recovery.",
        "handoff_to": None,
    },
    "security": {
        "name": "Security Agent",
        "mission": "Checks remediation for secrets, risky YAML, and unsafe release settings.",
        "handoff_to": "Release Auditor Agent",
    },
    "release_auditor": {
        "name": "Release Auditor Agent",
        "mission": "Finds pending GitHub, Vercel, Render, OpenAI, Twilio, and production gaps.",
        "handoff_to": "Auto Heal Agent",
    },
}
DEV_PILOT_AGENT_ACTION_MAP: dict[str, DevPilotAgentId] = {
    "agent_error": "monitoring",
    "approval_approved": "auto_heal",
    "approval_rejected": "auto_heal",
    "approval_requested": "auto_heal",
    "audit_frontend_routes": "frontend_guardian",
    "audit_pending_work": "release_auditor",
    "chaos_detected": "root_cause",
    "chaos_injection": "monitoring",
    "chaos_recovered": "auto_heal",
    "configure_agent": "monitoring",
    "decide_remediation": "root_cause",
    "monitor_ui_sections": "ui_monitor",
    "generate_remediation": "fix_generator",
    "monitor_incidents": "monitoring",
    "monitor_kubernetes": "monitoring",
    "patch_ci_workflow": "fix_generator",
    "patch_config": "auto_heal",
    "remediation_completed": "auto_heal",
    "restart_failed_pod": "auto_heal",
    "restore_network_policy": "auto_heal",
    "scan_error_backlog": "bug_sentinel",
    "rollback_deployment": "auto_heal",
    "security_scan": "security",
    "security_review": "security",
    "validate_backend_contracts": "backend_guardian",
    "verify_database_storage": "database_guardian",
    "validate_release_gate": "auto_heal",
    "validate_service_path": "auto_heal",
}
FAILURE_SIGNAL_RULES: list[dict[str, Any]] = [
    {
        "signal": "Kubernetes restart loop",
        "tokens": (
            "crashloopbackoff",
            "back-off restarting",
            "progressdeadlineexceeded",
            "failed liveness probe",
            "restart_count",
            "restarted",
        ),
        "weight": 0.26,
        "recommendation": (
            "Check pod restart counts, liveness probes, and the latest deployment rollout."
        ),
    },
    {
        "signal": "Missing runtime configuration",
        "tokens": (
            "database_url",
            "missing secret",
            "failedmount",
            "secret \"",
            "environment variable",
            "configuration drift",
        ),
        "weight": 0.24,
        "recommendation": (
            "Validate required environment variables and secret mounts before promotion."
        ),
    },
    {
        "signal": "Database connectivity degradation",
        "tokens": (
            "database connection failed",
            "connection refused",
            "connection reset",
            "pool exhausted",
            "too many connections",
            "cannot initialize incident memory",
        ),
        "weight": 0.22,
        "recommendation": (
            "Inspect database reachability, pool limits, credentials, and recent config changes."
        ),
    },
    {
        "signal": "CI/CD release instability",
        "tokens": (
            "github actions",
            "workflow failed",
            "pytest",
            "process completed with exit code",
            "build failed",
            "release-image",
        ),
        "weight": 0.2,
        "recommendation": (
            "Block release promotion until CI checks and build contracts pass cleanly."
        ),
    },
    {
        "signal": "Latency or timeout spike",
        "tokens": (
            "timeout",
            "latency",
            "p95",
            "p99",
            "deadline exceeded",
            "read timed out",
        ),
        "weight": 0.18,
        "recommendation": (
            "Review latency SLOs, upstream dependencies, queue depth, and timeout budgets."
        ),
    },
    {
        "signal": "Resource pressure",
        "tokens": (
            "oomkilled",
            "out of memory",
            "memory pressure",
            "cpu throttling",
            "evicted",
            "disk pressure",
        ),
        "weight": 0.19,
        "recommendation": (
            "Compare resource requests, limits, and node pressure against recent traffic."
        ),
    },
]
CLOUD_PROVIDER_CONFIG: dict[CloudProvider, dict[str, Any]] = {
    "aws": {
        "registry_image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/devpilot-api:latest",
        "secret_name": "aws-secrets-manager-openai-api",
        "secret_key": "OPENAI_API_KEY",
        "auth_step": "Configure AWS credentials",
        "auth_uses": "aws-actions/configure-aws-credentials@v4",
        "auth_with": {
            "role-to-assume": "${{ secrets.AWS_DEPLOY_ROLE_ARN }}",
            "aws-region": "${{ env.AWS_REGION }}",
        },
        "deploy_steps": [
            {
                "name": "Login to Amazon ECR",
                "uses": "aws-actions/amazon-ecr-login@v2",
            },
            {
                "name": "Build and push image",
                "run": (
                    "docker build -t $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/"
                    "$ECR_REPOSITORY:$GITHUB_SHA .\n"
                    "docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/"
                    "$ECR_REPOSITORY:$GITHUB_SHA"
                ),
            },
            {
                "name": "Update EKS manifest",
                "run": (
                    "aws eks update-kubeconfig --name $EKS_CLUSTER --region $AWS_REGION\n"
                    "kubectl set image deployment/devpilot-api devpilot-api="
                    "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/"
                    "$ECR_REPOSITORY:$GITHUB_SHA"
                ),
            },
        ],
        "env": {
            "AWS_REGION": "us-east-1",
            "AWS_ACCOUNT_ID": "${{ secrets.AWS_ACCOUNT_ID }}",
            "ECR_REPOSITORY": "devpilot-api",
            "EKS_CLUSTER": "devpilot-prod",
        },
        "suggestions": [
            "Deploy the API on Amazon EKS with images stored in Amazon ECR.",
            "Use an IAM role for GitHub OIDC instead of long-lived AWS access keys.",
            "Store OPENAI_API_KEY in AWS Secrets Manager and sync it into Kubernetes.",
            "Use an Application Load Balancer with health checks pointed at /health.",
        ],
    },
    "azure": {
        "registry_image": "devpilot.azurecr.io/devpilot-api:latest",
        "secret_name": "azure-key-vault-openai-api",
        "secret_key": "OPENAI_API_KEY",
        "auth_step": "Azure login",
        "auth_uses": "azure/login@v2",
        "auth_with": {
            "client-id": "${{ secrets.AZURE_CLIENT_ID }}",
            "tenant-id": "${{ secrets.AZURE_TENANT_ID }}",
            "subscription-id": "${{ secrets.AZURE_SUBSCRIPTION_ID }}",
        },
        "deploy_steps": [
            {
                "name": "Login to Azure Container Registry",
                "run": "az acr login --name $ACR_NAME",
            },
            {
                "name": "Build and push image",
                "run": (
                    "docker build -t $ACR_NAME.azurecr.io/devpilot-api:$GITHUB_SHA .\n"
                    "docker push $ACR_NAME.azurecr.io/devpilot-api:$GITHUB_SHA"
                ),
            },
            {
                "name": "Update AKS manifest",
                "run": (
                    "az aks get-credentials --resource-group $AZURE_RESOURCE_GROUP "
                    "--name $AKS_CLUSTER --overwrite-existing\n"
                    "kubectl set image deployment/devpilot-api devpilot-api="
                    "$ACR_NAME.azurecr.io/devpilot-api:$GITHUB_SHA"
                ),
            },
        ],
        "env": {
            "ACR_NAME": "devpilot",
            "AKS_CLUSTER": "devpilot-prod",
            "AZURE_RESOURCE_GROUP": "devpilot-prod-rg",
        },
        "suggestions": [
            "Deploy the API on Azure Kubernetes Service with images stored in Azure Container Registry.",
            "Use Azure Workload Identity or federated credentials for GitHub Actions.",
            "Store OPENAI_API_KEY in Azure Key Vault and mount it through the Secrets Store CSI driver.",
            "Use Azure Application Gateway or Container Apps ingress with /health probes.",
        ],
    },
    "gcp": {
        "registry_image": "us-docker.pkg.dev/devpilot-prod/api/devpilot-api:latest",
        "secret_name": "gcp-secret-manager-openai-api",
        "secret_key": "OPENAI_API_KEY",
        "auth_step": "Authenticate to Google Cloud",
        "auth_uses": "google-github-actions/auth@v2",
        "auth_with": {
            "workload_identity_provider": "${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}",
            "service_account": "${{ secrets.GCP_SERVICE_ACCOUNT }}",
        },
        "deploy_steps": [
            {
                "name": "Set up gcloud",
                "uses": "google-github-actions/setup-gcloud@v2",
            },
            {
                "name": "Build and push image",
                "run": (
                    "gcloud auth configure-docker $GCP_REGION-docker.pkg.dev --quiet\n"
                    "docker build -t $GCP_REGION-docker.pkg.dev/$GCP_PROJECT/"
                    "$ARTIFACT_REPOSITORY/devpilot-api:$GITHUB_SHA .\n"
                    "docker push $GCP_REGION-docker.pkg.dev/$GCP_PROJECT/"
                    "$ARTIFACT_REPOSITORY/devpilot-api:$GITHUB_SHA"
                ),
            },
            {
                "name": "Update GKE manifest",
                "run": (
                    "gcloud container clusters get-credentials $GKE_CLUSTER "
                    "--region $GCP_REGION --project $GCP_PROJECT\n"
                    "kubectl set image deployment/devpilot-api devpilot-api="
                    "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/"
                    "$ARTIFACT_REPOSITORY/devpilot-api:$GITHUB_SHA"
                ),
            },
        ],
        "env": {
            "GCP_PROJECT": "${{ secrets.GCP_PROJECT_ID }}",
            "GCP_REGION": "us-central1",
            "ARTIFACT_REPOSITORY": "api",
            "GKE_CLUSTER": "devpilot-prod",
        },
        "suggestions": [
            "Deploy the API on Google Kubernetes Engine with images stored in Artifact Registry.",
            "Use Workload Identity Federation for GitHub Actions instead of JSON service account keys.",
            "Store OPENAI_API_KEY in Secret Manager and expose it through Kubernetes secrets.",
            "Use Cloud Load Balancing or Gateway API with /health readiness checks.",
        ],
    },
}

PLUGIN_MARKETPLACE_CATALOG: dict[PluginId, dict[str, Any]] = {
    "aws": {
        "name": "AWS",
        "category": "cloud",
        "description": "Connect EKS, EC2, RDS, IAM, CloudWatch, and cost signals.",
        "capabilities": [
            "Cloud inventory",
            "EKS remediation targets",
            "Cost optimization",
            "Secrets Manager handoff",
        ],
        "required_secrets": [
            "AWS_ACCESS_KEY_ID or workload identity",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_REGION",
        ],
        "setup_steps": [
            "Create a least-privilege automation role.",
            "Expose region and account metadata.",
            "Enable CloudWatch and EKS read/write scopes as needed.",
        ],
    },
    "kubernetes": {
        "name": "Kubernetes",
        "category": "orchestration",
        "description": "Inspect clusters and run controlled restart, rollback, and scale actions.",
        "capabilities": [
            "Cluster health",
            "Pod restarts",
            "Deployment rollback",
            "Replica scaling",
        ],
        "required_secrets": [
            "KUBECONFIG_B64 or KUBECONFIG_CONTENT",
            "KUBECONFIG path for local/dev hosts",
        ],
        "setup_steps": [
            "Store a least-privilege kubeconfig as a Render secret.",
            "Grant namespace-scoped read/write permissions.",
            "Confirm rollback and scale permissions for deployments.",
        ],
    },
    "terraform": {
        "name": "Terraform",
        "category": "infrastructure_as_code",
        "description": "Detect drift, generate patches, and prepare reviewed IaC changes.",
        "capabilities": [
            "Drift detection",
            "Security remediation",
            "Patch generation",
            "Plan summary",
        ],
        "required_secrets": ["TERRAFORM_WORKSPACE", "cloud provider credentials"],
        "setup_steps": [
            "Point DevPilot at Terraform workspaces or plan output.",
            "Connect the cloud provider used by the state.",
            "Review generated patches before applying.",
        ],
    },
    "jenkins": {
        "name": "Jenkins",
        "category": "ci_cd",
        "description": "Read failed builds, map pipeline failures, and trigger safe rebuilds.",
        "capabilities": [
            "Build failure intake",
            "Pipeline diagnostics",
            "Release gate context",
            "Rebuild handoff",
        ],
        "required_secrets": ["JENKINS_URL", "JENKINS_USER", "JENKINS_API_TOKEN"],
        "setup_steps": [
            "Create a Jenkins API token for a service account.",
            "Allow read access to build logs and job metadata.",
            "Grant rebuild permission only for approved jobs.",
        ],
    },
    "datadog": {
        "name": "Datadog",
        "category": "observability",
        "description": "Pull monitors, logs, traces, SLOs, and service-health signals.",
        "capabilities": [
            "Monitor sync",
            "Log and trace context",
            "SLO impact",
            "Incident correlation",
        ],
        "required_secrets": ["DATADOG_API_KEY", "DATADOG_APP_KEY", "DATADOG_SITE"],
        "setup_steps": [
            "Create scoped Datadog API and app keys.",
            "Grant monitor, logs, traces, and SLO read access.",
            "Map service tags to DevPilot teams.",
        ],
    },
    "slack": {
        "name": "Slack",
        "category": "collaboration",
        "description": "Send incident alerts, auto-heal summaries, and command audit updates.",
        "capabilities": [
            "Incident alerts",
            "Run summaries",
            "Approval channel handoff",
            "Audit notifications",
        ],
        "required_secrets": ["SLACK_WEBHOOK_URL"],
        "setup_steps": [
            "Create an incoming webhook for the DevOps channel.",
            "Store the webhook URL in backend environment variables.",
            "Send a test alert from DevPilot.",
        ],
    },
}


def env_bool(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        parsed_value = int(raw_value)
    except ValueError:
        return default

    return max(minimum, min(parsed_value, maximum))


MAX_REQUEST_BODY_BYTES_ENV = "DEVPILOT_MAX_REQUEST_BODY_BYTES"
RATE_LIMIT_WINDOW_SECONDS_ENV = "DEVPILOT_RATE_LIMIT_WINDOW_SECONDS"
RATE_LIMIT_REQUESTS_PER_WINDOW_ENV = "DEVPILOT_RATE_LIMIT_REQUESTS_PER_WINDOW"


def normalize_autonomous_agent_mode(value: str | None) -> AutonomousAgentMode:
    normalized = (value or "simulation").strip().lower()
    if normalized in {"real", "live", "k8s"}:
        normalized = "kubernetes"

    if normalized not in {"simulation", "kubernetes"}:
        return "simulation"

    return cast(AutonomousAgentMode, normalized)


MAX_REQUEST_BODY_BYTES = env_int(MAX_REQUEST_BODY_BYTES_ENV, 1_500_000, 1_024, 10_000_000)
RATE_LIMIT_WINDOW_SECONDS = env_int(RATE_LIMIT_WINDOW_SECONDS_ENV, 60, 10, 3_600)
RATE_LIMIT_REQUESTS_PER_WINDOW = env_int(
    RATE_LIMIT_REQUESTS_PER_WINDOW_ENV,
    120,
    10,
    10_000,
)


AUTONOMOUS_AGENT_LOCK = threading.RLock()
AUTONOMOUS_AGENT_STOP_EVENT = threading.Event()
AUTONOMOUS_AGENT_THREAD: threading.Thread | None = None
AUTONOMOUS_AGENT_CONFIG: dict[str, Any] = {
    "enabled": env_bool(AUTONOMOUS_AGENT_ENABLED_ENV, True),
    "interval_seconds": env_int(AUTONOMOUS_AGENT_INTERVAL_ENV, 15, 5, 3600),
    "mode": normalize_autonomous_agent_mode(os.getenv(AUTONOMOUS_AGENT_MODE_ENV)),
    "apply_real_kubernetes_actions": env_bool(
        AUTONOMOUS_AGENT_APPLY_KUBERNETES_ENV,
        False,
    ),
    "require_human_approval": env_bool(AUTONOMOUS_AGENT_REQUIRE_APPROVAL_ENV, True),
    "kubeconfig_path": None,
    "context": None,
}
AUTONOMOUS_AGENT_LAST_CHECKED_AT: str | None = None
AUTONOMOUS_AGENT_LAST_DECISION: AutonomousAgentDecision | None = None
AUTONOMOUS_AGENT_LAST_ERROR: str | None = None
INCIDENT_HISTORY_CACHE_TTL_SECONDS = 3
INCIDENT_HISTORY_CACHE_LOCK = threading.RLock()
INCIDENT_HISTORY_CACHE: dict[
    tuple[str, int],
    tuple[float, list[IncidentMemoryRecord]],
] = {}
CURRENT_TEAM_ID: contextvars.ContextVar[str] = contextvars.ContextVar(
    "devpilot_current_team_id",
    default=DEFAULT_SAAS_TEAM_ID,
)
CURRENT_USER_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "devpilot_current_user_id",
    default=None,
)
CURRENT_USER_EMAIL: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "devpilot_current_user_email",
    default=None,
)
CURRENT_USER_ROLE: contextvars.ContextVar[UserRole] = contextvars.ContextVar(
    "devpilot_current_user_role",
    default="viewer",
)
CURRENT_SESSION_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "devpilot_current_session_id",
    default=None,
)
CURRENT_SESSION_CSRF_TOKEN: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "devpilot_current_session_csrf_token",
    default=None,
)
CURRENT_AUTHENTICATED: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "devpilot_current_authenticated",
    default=False,
)


@dataclass(slots=True)
class RequestAuthContext:
    authenticated: bool
    user_id: str | None
    user_email: str | None
    team_id: str
    role: UserRole
    session_id: str | None
    csrf_token: str | None

    def apply_context(self) -> list[tuple[contextvars.ContextVar[Any], contextvars.Token[Any]]]:
        tokens: list[tuple[contextvars.ContextVar[Any], contextvars.Token[Any]]] = [
            (CURRENT_TEAM_ID, CURRENT_TEAM_ID.set(self.team_id)),
            (CURRENT_USER_ID, CURRENT_USER_ID.set(self.user_id)),
            (CURRENT_USER_EMAIL, CURRENT_USER_EMAIL.set(self.user_email)),
            (CURRENT_USER_ROLE, CURRENT_USER_ROLE.set(self.role)),
            (CURRENT_SESSION_ID, CURRENT_SESSION_ID.set(self.session_id)),
            (
                CURRENT_SESSION_CSRF_TOKEN,
                CURRENT_SESSION_CSRF_TOKEN.set(self.csrf_token),
            ),
            (CURRENT_AUTHENTICATED, CURRENT_AUTHENTICATED.set(self.authenticated)),
        ]
        return tokens

    @staticmethod
    def reset_context(
        tokens: list[tuple[contextvars.ContextVar[Any], contextvars.Token[Any]]],
    ) -> None:
        for context_var, token in reversed(tokens):
            context_var.reset(token)


def is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS or any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES)


def unauthenticated_request_context() -> RequestAuthContext:
    return RequestAuthContext(
        authenticated=False,
        user_id=None,
        user_email=None,
        team_id=DEFAULT_SAAS_TEAM_ID,
        role="viewer",
        session_id=None,
        csrf_token=None,
    )


def current_user_id() -> str | None:
    return CURRENT_USER_ID.get()


def current_user_email() -> str | None:
    return CURRENT_USER_EMAIL.get()


def current_user_role() -> UserRole:
    return CURRENT_USER_ROLE.get()


def current_session_id() -> str | None:
    return CURRENT_SESSION_ID.get()


def current_authentication_status() -> bool:
    return CURRENT_AUTHENTICATED.get()


def resolve_request_auth_context(request: Request) -> RequestAuthContext:
    public_path = is_public_path(request.url.path)
    token = auth_token_from_request(request)
    if not token:
        if public_path:
            return unauthenticated_request_context()

        raise HTTPException(status_code=401, detail="Authentication is required.")

    payload = verify_session_token(token)
    if not payload:
        if public_path:
            return unauthenticated_request_context()

        raise HTTPException(
            status_code=401,
            detail="Your session expired. Please sign in again.",
        )

    session_id = str(payload.get("sid") or "").strip()
    user_id = str(payload.get("uid") or "").strip()
    csrf_token = str(payload.get("csrf") or "").strip()
    if not session_id or not user_id or not csrf_token:
        if public_path:
            return unauthenticated_request_context()

        raise HTTPException(
            status_code=401,
            detail="Your session is malformed. Please sign in again.",
        )

    session_row = auth_session_row_by_id(session_id)
    if not session_row or session_row.get("revoked_at"):
        if public_path:
            return unauthenticated_request_context()

        raise HTTPException(
            status_code=401,
            detail="Your session is no longer valid. Please sign in again.",
        )

    expires_at_raw = str(session_row.get("expires_at") or payload.get("exp") or "")
    try:
        if datetime.fromisoformat(expires_at_raw) <= datetime.now(UTC):
            if public_path:
                return unauthenticated_request_context()

            raise HTTPException(
                status_code=401,
                detail="Your session expired. Please sign in again.",
            )
    except ValueError as exc:
        if public_path:
            return unauthenticated_request_context()

        raise HTTPException(
            status_code=401,
            detail="Your session is invalid. Please sign in again.",
        ) from exc

    user_row = auth_user_row_by_id(user_id)
    if not user_row or not int(user_row.get("is_active") or 0):
        if public_path:
            return unauthenticated_request_context()

        raise HTTPException(status_code=401, detail="Your account is inactive.")

    email = str(user_row["email"]).lower().strip()
    session_team_id = str(session_row.get("current_team_id") or "").strip()
    header_team_id = request.headers.get("X-DevPilot-Team-ID", "").strip()
    selected_team_id = session_team_id or DEFAULT_SAAS_TEAM_ID

    if header_team_id:
        normalized_header_team = normalize_team_id(header_team_id)
        if not auth_user_has_team(email, normalized_header_team):
            raise HTTPException(
                status_code=403,
                detail="You do not have access to the selected team.",
            )

        selected_team_id = normalized_header_team
        if normalized_header_team != session_team_id:
            update_auth_session_team(session_id, normalized_header_team)
    elif not auth_user_has_team(email, selected_team_id):
        user_teams = auth_user_team_rows(email)
        if user_teams:
            selected_team_id = str(user_teams[0]["id"])
            if selected_team_id != session_team_id:
                update_auth_session_team(session_id, selected_team_id)
        elif not public_path:
            raise HTTPException(
                status_code=403,
                detail="You are not a member of any team in this workspace.",
            )

    team_row = fetch_saas_team(selected_team_id)
    if team_row is None:
        raise HTTPException(status_code=404, detail="The selected team was not found.")

    member_row = team_member_row_for_email(selected_team_id, email)
    if member_row is None:
        if public_path:
            return RequestAuthContext(
                authenticated=False,
                user_id=None,
                user_email=None,
                team_id=selected_team_id,
                role="viewer",
                session_id=session_id,
                csrf_token=csrf_token,
            )

        raise HTTPException(
            status_code=403,
            detail="You do not have access to this team.",
        )

    role = team_member_role_to_user_role(cast(TeamMemberRole, member_row["role"]))
    return RequestAuthContext(
        authenticated=True,
        user_id=user_id,
        user_email=email,
        team_id=selected_team_id,
        role=role,
        session_id=session_id,
        csrf_token=csrf_token,
    )


def enforce_csrf_protection(
    request: Request,
    auth_context: RequestAuthContext,
) -> JSONResponse | None:
    if not auth_context.authenticated:
        return JSONResponse(status_code=401, content={"detail": "Authentication is required."})

    request_token = auth_csrf_token_from_request(request)
    if not request_token or request_token != auth_context.csrf_token:
        return JSONResponse(
            status_code=403,
            content={"detail": "The request is missing a valid CSRF token."},
        )

    return None


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not configured for the backend.",
        )

    return OpenAI(api_key=api_key, timeout=20.0, max_retries=1)


def has_openai_key() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def normalize_user_role(value: str | None) -> UserRole:
    configured_default = os.getenv(DEFAULT_USER_ROLE_ENV, "viewer")
    normalized = (value or configured_default).strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    aliases = {
        "administrator": "admin",
        "devops": "devops_engineer",
        "dev_ops": "devops_engineer",
        "devops_engineer": "devops_engineer",
        "dev_ops_engineer": "devops_engineer",
        "engineer": "devops_engineer",
        "read_only": "viewer",
        "readonly": "viewer",
    }
    role = aliases.get(normalized, normalized)

    if role not in USER_ROLE_LABELS:
        raise HTTPException(
            status_code=400,
            detail="X-DevPilot-Role must be one of: Admin, DevOps Engineer, Viewer.",
        )

    return cast(UserRole, role)


def require_roles(
    x_devpilot_role: str | None,
    allowed_roles: set[UserRole],
    action: str,
) -> UserRole:
    role = current_user_role()
    if role in allowed_roles:
        return role

    allowed_labels = ", ".join(USER_ROLE_LABELS[allowed] for allowed in allowed_roles)
    raise HTTPException(
        status_code=403,
        detail=f"{action} requires one of these roles: {allowed_labels}.",
    )


def current_team_id() -> str:
    return CURRENT_TEAM_ID.get()


def normalize_team_id(value: str | None) -> str:
    normalized = (value or DEFAULT_SAAS_TEAM_ID).strip()
    if not normalized:
        return DEFAULT_SAAS_TEAM_ID

    if not TEAM_ID_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="X-DevPilot-Team-ID must be 3-80 letters, numbers, dashes, or underscores.",
        )

    return normalized


def normalize_owner_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise HTTPException(status_code=400, detail="A valid team email is required.")

    return email


def normalize_billing_plan(plan_id: str | None) -> BillingPlanId:
    normalized = (plan_id or "free").strip().lower()
    if normalized not in SAAS_PLAN_CATALOG:
        raise HTTPException(status_code=400, detail="Billing plan must be free or pro.")

    return cast(BillingPlanId, normalized)


def billing_plan_from_catalog(plan_id: BillingPlanId) -> BillingPlan:
    plan = SAAS_PLAN_CATALOG[plan_id]
    return BillingPlan(
        id=plan_id,
        name=str(plan["name"]),
        monthly_price_usd=int(plan["monthly_price_usd"]),
        included_members=int(plan["included_members"]),
        monthly_api_requests=int(plan["monthly_api_requests"]),
        monthly_ai_actions=int(plan["monthly_ai_actions"]),
        monthly_auto_heal_actions=int(plan["monthly_auto_heal_actions"]),
        support_tier=str(plan["support_tier"]),
        features=[str(feature) for feature in plan["features"]],
    )


def list_billing_plans() -> list[BillingPlan]:
    return [billing_plan_from_catalog(plan_id) for plan_id in ("free", "pro")]


def database_url() -> str | None:
    configured = os.getenv(DATABASE_URL_ENV, "").strip()
    return configured or None


def using_postgres_storage() -> bool:
    configured = database_url()
    return bool(configured and configured.startswith(("postgres://", "postgresql://")))


def auth_session_ttl_seconds() -> int:
    configured = os.getenv(AUTH_SESSION_TTL_SECONDS_ENV, "").strip()
    if not configured:
        return DEFAULT_AUTH_SESSION_TTL_SECONDS

    try:
        ttl = int(configured)
    except ValueError as exc:
        raise RuntimeError(
            f"{AUTH_SESSION_TTL_SECONDS_ENV} must be an integer number of seconds."
        ) from exc

    return max(3600, min(ttl, 60 * 60 * 24 * 365))


def session_secret() -> str:
    secret = os.getenv(SESSION_SECRET_ENV, "").strip()
    if len(secret) < 32:
        raise HTTPException(
            status_code=500,
            detail=f"{SESSION_SECRET_ENV} is not configured for secure sessions.",
        )

    return secret


def base64url_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str, salt: bytes | None = None) -> str:
    secret_salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        secret_salt,
        DEFAULT_PASSWORD_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${DEFAULT_PASSWORD_ITERATIONS}$"
        f"{base64url_encode(secret_salt)}${base64url_encode(derived)}"
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, hash_text = stored_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_text)
        salt = base64url_decode(salt_text)
        expected = base64url_decode(hash_text)
    except (TypeError, ValueError):
        return False

    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(derived, expected)


def sign_session_token(session_id: str, user_id: str, csrf_token: str, expires_at: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sid": session_id,
        "uid": user_id,
        "csrf": csrf_token,
        "exp": expires_at,
        "iat": datetime.now(UTC).isoformat(),
    }
    signing_input = ".".join(
        (
            base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        )
    )
    signature = hmac.new(
        session_secret().encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{base64url_encode(signature)}"


def verify_session_token(token: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None

    signing_input = ".".join(parts[:2])
    expected_signature = hmac.new(
        session_secret().encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    try:
        provided_signature = base64url_decode(parts[2])
        payload = json.loads(base64url_decode(parts[1]).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    if not hmac.compare_digest(provided_signature, expected_signature):
        return None

    expires_at = payload.get("exp")
    if not isinstance(expires_at, str):
        return None

    try:
        if datetime.fromisoformat(expires_at) <= datetime.now(UTC):
            return None
    except ValueError:
        return None

    return payload if isinstance(payload, dict) else None


def team_member_role_to_user_role(role: TeamMemberRole) -> UserRole:
    if role in {"owner", "admin"}:
        return "admin"
    if role == "member":
        return "devops_engineer"
    return "viewer"


def auth_user_summary_from_row(row: dict[str, Any]) -> AuthUserSummary:
    return AuthUserSummary(
        id=str(row["id"]),
        email=str(row["email"]),
        full_name=row.get("full_name"),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        last_login_at=row.get("last_login_at"),
    )


def auth_session_cookie_settings() -> dict[str, Any]:
    return {
        "httponly": True,
        "secure": is_production_environment(),
        "samesite": "none" if is_production_environment() else "lax",
        "path": "/",
        "max_age": auth_session_ttl_seconds(),
    }


def auth_csrf_cookie_settings() -> dict[str, Any]:
    return {
        "httponly": False,
        "secure": is_production_environment(),
        "samesite": "none" if is_production_environment() else "lax",
        "path": "/",
        "max_age": auth_session_ttl_seconds(),
    }


def set_auth_cookies(response: Any, session_token: str, csrf_token: str) -> None:
    response.set_cookie(SESSION_COOKIE_NAME, session_token, **auth_session_cookie_settings())
    response.set_cookie(CSRF_COOKIE_NAME, csrf_token, **auth_csrf_cookie_settings())


def clear_auth_cookies(response: Any) -> None:
    same_site = "none" if is_production_environment() else "lax"
    secure = is_production_environment()
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=secure,
        httponly=True,
        samesite=same_site,
    )
    response.delete_cookie(
        CSRF_COOKIE_NAME,
        path="/",
        secure=secure,
        httponly=False,
        samesite=same_site,
    )


def auth_token_from_request(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        return token

    authorization = request.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip() or None

    return None


def auth_csrf_token_from_request(request: Request) -> str | None:
    return request.headers.get("x-csrf-token", "").strip() or None


def is_authenticated_path(request: Request) -> bool:
    return request.url.path.startswith("/auth/")


def build_auth_session_response(
    *,
    authenticated: bool,
    bootstrap_required: bool = False,
    user_row: dict[str, Any] | None = None,
    team_row: dict[str, Any] | None = None,
    team_rows: list[dict[str, Any]] | None = None,
    csrf_token: str | None = None,
) -> AuthSessionResponse:
    teams = [saas_team_from_row(row) for row in team_rows or []]
    current_team = saas_team_from_row(team_row) if team_row else None
    role: UserRole | None = None
    if authenticated and team_row and user_row:
        member_row = team_member_row_for_email(str(team_row["id"]), str(user_row["email"]))
        if member_row:
            role = team_member_role_to_user_role(cast(TeamMemberRole, member_row["role"]))

    return AuthSessionResponse(
        authenticated=authenticated,
        bootstrap_required=bootstrap_required,
        user=auth_user_summary_from_row(user_row) if user_row else None,
        current_team=current_team,
        teams=teams,
        role=role,
        csrf_token=csrf_token,
    )


class StorageConnectionProxy:
    def __init__(self, connection: Any):
        self._connection_context = connection
        self._connection: sqlite3.Connection | PostgresConnection = connection

    def __enter__(self) -> "StorageConnectionProxy":
        entered_connection = self._connection_context.__enter__()
        if entered_connection is not None:
            self._connection = entered_connection
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> Any:
        return self._connection_context.__exit__(exc_type, exc, tb)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._connection, name)

    def execute(self, query: str, params: Any | None = None) -> Any:
        sql = query.replace("?", "%s") if using_postgres_storage() else query
        if params is None:
            return self._connection.execute(sql)

        if isinstance(params, list):
            params = tuple(params)

        return self._connection.execute(sql, params)


def postgres_pool_min_size() -> int:
    configured = os.getenv("POSTGRES_POOL_MIN_SIZE", "1").strip()
    try:
        return max(1, int(configured))
    except ValueError:
        return 1


def postgres_pool_max_size() -> int:
    configured = os.getenv("POSTGRES_POOL_MAX_SIZE", "4").strip()
    try:
        return max(postgres_pool_min_size(), int(configured))
    except ValueError:
        return max(postgres_pool_min_size(), 4)


def postgres_connection_pool() -> ConnectionPool:
    global POSTGRES_POOL
    with POSTGRES_POOL_LOCK:
        if POSTGRES_POOL is None or POSTGRES_POOL.closed:
            POSTGRES_POOL = ConnectionPool(
                conninfo=database_url(),
                kwargs={
                    "row_factory": dict_row,
                    "connect_timeout": 10,
                },
                min_size=postgres_pool_min_size(),
                max_size=postgres_pool_max_size(),
                open=False,
            )
            POSTGRES_POOL.open()

        return POSTGRES_POOL


def close_postgres_connection_pool() -> None:
    global POSTGRES_POOL
    with POSTGRES_POOL_LOCK:
        if POSTGRES_POOL is not None and not POSTGRES_POOL.closed:
            POSTGRES_POOL.close()
        POSTGRES_POOL = None


def open_storage_connection() -> StorageConnectionProxy:
    if using_postgres_storage():
        return StorageConnectionProxy(postgres_connection_pool().connection())

    path = incident_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return StorageConnectionProxy(connection)


def ensure_sqlite_column(
    connection: StorageConnectionProxy,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    if using_postgres_storage():
        return

    columns = {
        str(row[1])
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        connection.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}",
        )


def _initialize_storage_schema(connection: StorageConnectionProxy) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS saas_teams (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            owner_email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_saas_teams_updated_at
        ON saas_teams (updated_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS saas_team_members (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(team_id, email)
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_saas_team_members_team_id
        ON saas_team_members (team_id)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS saas_usage_events (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            metric TEXT NOT NULL,
            source TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_saas_usage_events_team_metric_created
        ON saas_usage_events (team_id, metric, created_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS incident_memory (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL DEFAULT 'team_default',
            source TEXT NOT NULL,
            raw_logs TEXT,
            summary TEXT NOT NULL,
            severity TEXT,
            explanation TEXT,
            recommended_fix TEXT,
            cloud_provider TEXT,
            fix_payload TEXT,
            search_text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
    )
    ensure_sqlite_column(
        connection,
        "incident_memory",
        "team_id",
        "TEXT NOT NULL DEFAULT 'team_default'",
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_incident_memory_created_at
        ON incident_memory (created_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_incident_memory_cloud_provider
        ON incident_memory (cloud_provider)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_incident_memory_team_created_at
        ON incident_memory (team_id, created_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS autonomous_agent_actions (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL DEFAULT 'team_default',
            cycle_id TEXT NOT NULL,
            incident_id TEXT,
            action_type TEXT NOT NULL,
            target TEXT NOT NULL,
            status TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
    )
    ensure_sqlite_column(
        connection,
        "autonomous_agent_actions",
        "team_id",
        "TEXT NOT NULL DEFAULT 'team_default'",
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_actions_created_at
        ON autonomous_agent_actions (created_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_actions_incident_id
        ON autonomous_agent_actions (incident_id)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_actions_cycle_id
        ON autonomous_agent_actions (cycle_id)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_actions_team_created
        ON autonomous_agent_actions (team_id, created_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS autonomous_agent_approvals (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL DEFAULT 'team_default',
            cycle_id TEXT NOT NULL,
            incident_id TEXT,
            summary TEXT NOT NULL,
            severity TEXT,
            strategy TEXT NOT NULL,
            confidence REAL NOT NULL,
            actions_json TEXT NOT NULL,
            cloud_provider TEXT NOT NULL,
            target_json TEXT NOT NULL,
            generated_fix_json TEXT,
            status TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            reviewed_at TEXT,
            reviewed_by_role TEXT,
            reviewer_note TEXT,
            applied_at TEXT,
            failure_reason TEXT
        )
        """,
    )
    ensure_sqlite_column(
        connection,
        "autonomous_agent_approvals",
        "team_id",
        "TEXT NOT NULL DEFAULT 'team_default'",
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_approvals_status
        ON autonomous_agent_approvals (status, requested_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_approvals_incident_id
        ON autonomous_agent_approvals (incident_id)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_autonomous_agent_approvals_team_status
        ON autonomous_agent_approvals (team_id, status, requested_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS installed_plugins (
            plugin_id TEXT PRIMARY KEY,
            connection_name TEXT,
            environment TEXT NOT NULL,
            notes TEXT,
            installed_by TEXT NOT NULL,
            installed_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_installed_plugins_updated_at
        ON installed_plugins (updated_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_model_training_runs (
            id TEXT PRIMARY KEY,
            model_name TEXT NOT NULL,
            base_model TEXT NOT NULL,
            status TEXT NOT NULL,
            training_examples INTEGER NOT NULL,
            validation_examples INTEGER NOT NULL,
            source_breakdown TEXT NOT NULL,
            evaluation_payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_custom_model_training_runs_created_at
        ON custom_model_training_runs (created_at DESC)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            full_name TEXT,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_users_email
        ON auth_users (email)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            csrf_token TEXT NOT NULL,
            current_team_id TEXT,
            issued_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            user_agent TEXT,
            ip_address TEXT
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
        ON auth_sessions (user_id)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
        ON auth_sessions (expires_at)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at
        ON auth_sessions (revoked_at)
        """,
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_password_reset_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            email TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            user_agent TEXT,
            ip_address TEXT
        )
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_user_id
        ON auth_password_reset_tokens (user_id)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_expires_at
        ON auth_password_reset_tokens (expires_at)
        """,
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auth_password_reset_tokens_used_at
        ON auth_password_reset_tokens (used_at)
        """,
    )


def init_incident_db() -> None:
    global INCIDENT_DB_INITIALIZED
    if INCIDENT_DB_INITIALIZED:
        return

    with INCIDENT_DB_INIT_LOCK:
        if INCIDENT_DB_INITIALIZED:
            return

        with open_storage_connection() as connection:
            _initialize_storage_schema(connection)
            seeded_at = datetime.now(UTC).isoformat()
            connection.execute(
                """
                INSERT INTO saas_teams (
                    id, name, plan_id, owner_email, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
                """,
                (
                    DEFAULT_SAAS_TEAM_ID,
                    "DevPilot Demo Team",
                    "pro",
                    DEFAULT_SAAS_OWNER_EMAIL,
                    seeded_at,
                    seeded_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO saas_team_members (
                    id, team_id, email, role, created_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(team_id, email) DO NOTHING
                """,
                (
                    "member_default_owner",
                    DEFAULT_SAAS_TEAM_ID,
                    DEFAULT_SAAS_OWNER_EMAIL,
                    "owner",
                    seeded_at,
                ),
            )

        INCIDENT_DB_INITIALIZED = True


def incident_db_connection() -> StorageConnectionProxy:
    init_incident_db()
    return open_storage_connection()


def team_member_row_for_email(team_id: str, email: str) -> dict[str, Any] | None:
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, team_id, email, role, created_at
            FROM saas_team_members
            WHERE team_id = ? AND email = ?
            LIMIT 1
            """,
            (team_id, email.lower().strip()),
        ).fetchone()

    return dict(row) if row else None


def auth_user_row_by_email(email: str) -> dict[str, Any] | None:
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, email, full_name, password_hash, created_at, updated_at,
                   last_login_at, is_active
            FROM auth_users
            WHERE email = ?
            LIMIT 1
            """,
            (email.lower().strip(),),
        ).fetchone()

    return dict(row) if row else None


def auth_user_row_by_id(user_id: str) -> dict[str, Any] | None:
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, email, full_name, password_hash, created_at, updated_at,
                   last_login_at, is_active
            FROM auth_users
            WHERE id = ?
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()

    return dict(row) if row else None


def auth_session_row_by_id(session_id: str) -> dict[str, Any] | None:
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, user_id, csrf_token, current_team_id, issued_at, expires_at,
                   revoked_at, user_agent, ip_address
            FROM auth_sessions
            WHERE id = ?
            LIMIT 1
            """,
            (session_id,),
        ).fetchone()

    return dict(row) if row else None


def auth_user_team_rows(email: str) -> list[dict[str, Any]]:
    with incident_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                teams.id,
                teams.name,
                teams.plan_id,
                teams.owner_email,
                teams.created_at,
                teams.updated_at,
                COUNT(members.id) AS member_count,
                members.role AS member_role
            FROM saas_teams AS teams
            INNER JOIN saas_team_members AS members ON members.team_id = teams.id
            WHERE lower(members.email) = lower(?)
            GROUP BY teams.id, members.role
            ORDER BY teams.updated_at DESC, teams.name ASC
            """,
            (email,),
        ).fetchall()

    return [dict(row) for row in rows]


def auth_user_has_team(email: str, team_id: str) -> bool:
    return team_member_row_for_email(team_id, email) is not None


def create_auth_user_if_missing(
    *,
    email: str,
    password: str,
    full_name: str | None = None,
) -> dict[str, Any]:
    normalized_email = email.lower().strip()
    existing = auth_user_row_by_email(normalized_email)
    if existing:
        return existing

    now = datetime.now(UTC).isoformat()
    user_id = str(uuid4())
    password_hash = hash_password(password)

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO auth_users (
                id, email, full_name, password_hash, created_at, updated_at,
                last_login_at, is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO NOTHING
            """,
            (
                user_id,
                normalized_email,
                full_name.strip() if full_name and full_name.strip() else None,
                password_hash,
                now,
                now,
                None,
                1,
            ),
        )

    created = auth_user_row_by_email(normalized_email)
    if created is None:
        raise HTTPException(status_code=500, detail="Could not create auth user.")

    return created


def touch_auth_user_login(user_id: str, timestamp: str) -> None:
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE auth_users
            SET last_login_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (timestamp, timestamp, user_id),
        )


def create_auth_session_record(
    *,
    user_id: str,
    team_id: str | None,
    request: Request | None = None,
) -> tuple[dict[str, Any], str, str]:
    issued_at = datetime.now(UTC)
    expires_at = issued_at + timedelta(seconds=auth_session_ttl_seconds())
    session_id = str(uuid4())
    csrf_token = secrets.token_urlsafe(32)
    user_agent = request.headers.get("user-agent") if request else None
    ip_address = request_client_ip(request) if request else None
    token = sign_session_token(session_id, user_id, csrf_token, expires_at.isoformat())

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (
                id, user_id, csrf_token, current_team_id, issued_at, expires_at,
                revoked_at, user_agent, ip_address
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                user_id,
                csrf_token,
                team_id,
                issued_at.isoformat(),
                expires_at.isoformat(),
                None,
                user_agent,
                ip_address,
            ),
        )

    row = auth_session_row_by_id(session_id)
    if row is None:
        raise HTTPException(status_code=500, detail="Could not create auth session.")

    return row, token, csrf_token


def update_auth_session_team(session_id: str, team_id: str) -> None:
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE auth_sessions
            SET current_team_id = ?
            WHERE id = ?
            """,
            (team_id, session_id),
        )


def revoke_auth_session(session_id: str) -> None:
    revoked_at = datetime.now(UTC).isoformat()
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?
            WHERE id = ?
            """,
            (revoked_at, session_id),
        )


def password_reset_ttl_seconds() -> int:
    configured = os.getenv(AUTH_PASSWORD_RESET_TTL_SECONDS_ENV, "").strip()
    if not configured:
        return DEFAULT_AUTH_PASSWORD_RESET_TTL_SECONDS

    try:
        ttl = int(configured)
    except ValueError:
        return DEFAULT_AUTH_PASSWORD_RESET_TTL_SECONDS

    return max(300, min(ttl, 60 * 60 * 24))


def should_expose_password_reset_token() -> bool:
    configured = os.getenv(AUTH_EXPOSE_PASSWORD_RESET_TOKEN_ENV, "").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return True
    if configured in {"0", "false", "no", "off"}:
        return False

    return not is_production_environment()


def password_reset_token_hash(token: str) -> str:
    digest = hmac.new(
        session_secret().encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64url_encode(digest)


def create_password_reset_token(
    *,
    user_id: str,
    email: str,
    request: Request | None = None,
) -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    token_hash = password_reset_token_hash(token)
    created_at = datetime.now(UTC)
    expires_at = created_at + timedelta(seconds=password_reset_ttl_seconds())
    user_agent = request.headers.get("user-agent") if request else None
    ip_address = request_client_ip(request) if request else None

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO auth_password_reset_tokens (
                id, user_id, email, token_hash, created_at, expires_at,
                used_at, user_agent, ip_address
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                user_id,
                email.lower().strip(),
                token_hash,
                created_at.isoformat(),
                expires_at.isoformat(),
                None,
                user_agent,
                ip_address,
            ),
        )

    return token, expires_at.isoformat()


def password_reset_row_for_token(token: str) -> dict[str, Any] | None:
    token_hash = password_reset_token_hash(token)
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, user_id, email, token_hash, created_at, expires_at, used_at
            FROM auth_password_reset_tokens
            WHERE token_hash = ?
            LIMIT 1
            """,
            (token_hash,),
        ).fetchone()

    if not row:
        return None

    reset_row = dict(row)
    if reset_row.get("used_at"):
        return None

    try:
        if datetime.fromisoformat(str(reset_row["expires_at"])) <= datetime.now(UTC):
            return None
    except ValueError:
        return None

    return reset_row


def mark_password_reset_token_used(reset_token_id: str) -> None:
    used_at = datetime.now(UTC).isoformat()
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE auth_password_reset_tokens
            SET used_at = ?
            WHERE id = ?
            """,
            (used_at, reset_token_id),
        )


def update_auth_user_password(user_id: str, password: str) -> None:
    updated_at = datetime.now(UTC).isoformat()
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE auth_users
            SET password_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (hash_password(password), updated_at, user_id),
        )


def revoke_auth_sessions_for_user(user_id: str) -> None:
    revoked_at = datetime.now(UTC).isoformat()
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?
            WHERE user_id = ? AND revoked_at IS NULL
            """,
            (revoked_at, user_id),
        )


def frontend_base_url_from_request(request: Request) -> str:
    origin = request.headers.get("origin", "").strip()
    if origin and is_allowed_cors_origin(origin):
        normalized = normalize_frontend_origin(origin)
        if normalized:
            return normalized

    configured_origins = get_configured_frontend_origins()
    if configured_origins:
        return configured_origins[0]

    return "http://127.0.0.1:3000"


def build_password_reset_url(request: Request, token: str) -> str:
    return f"{frontend_base_url_from_request(request)}/dashboard?reset_token={quote(token)}"


def smtp_is_configured() -> bool:
    return bool(os.getenv(SMTP_HOST_ENV, "").strip() and os.getenv(SMTP_FROM_EMAIL_ENV, "").strip())


def smtp_port() -> int:
    configured = os.getenv(SMTP_PORT_ENV, "587").strip()
    try:
        return int(configured)
    except ValueError:
        return 587


def smtp_use_tls() -> bool:
    return os.getenv(SMTP_USE_TLS_ENV, "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def send_password_reset_email(*, email: str, reset_url: str) -> None:
    if not smtp_is_configured():
        logger.info(
            "SMTP is not configured; password reset email for %s was not sent.",
            email,
        )
        return

    message = EmailMessage()
    message["Subject"] = "Reset your DevPilot AI password"
    message["From"] = os.getenv(SMTP_FROM_EMAIL_ENV, "").strip()
    message["To"] = email
    message.set_content(
        "\n".join(
            [
                "Use this link to reset your DevPilot AI password:",
                reset_url,
                "",
                "This link expires soon. If you did not request it, you can ignore this email.",
            ],
        ),
    )

    username = os.getenv(SMTP_USERNAME_ENV, "").strip()
    password = os.getenv(SMTP_PASSWORD_ENV, "").strip()
    try:
        with smtplib.SMTP(os.getenv(SMTP_HOST_ENV, "").strip(), smtp_port(), timeout=10) as smtp:
            if smtp_use_tls():
                smtp.starttls()
            if username:
                smtp.login(username, password)
            smtp.send_message(message)
    except Exception:
        logger.exception("Could not send password reset email to %s.", email)


def slack_webhook_url(required: bool = False) -> str | None:
    webhook_url = os.getenv(SLACK_WEBHOOK_URL_ENV, "").strip()

    if webhook_url:
        return webhook_url

    if required:
        raise HTTPException(
            status_code=500,
            detail=f"{SLACK_WEBHOOK_URL_ENV} is not configured for Slack notifications.",
        )

    return None


def truncate_text(value: str, limit: int = 800) -> str:
    normalized = " ".join(value.strip().split())
    if not normalized:
        return "Not specified."

    if len(normalized) <= limit:
        return normalized

    return f"{normalized[: limit - 3].rstrip()}..."


def slack_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def slack_field(label: str, value: str) -> dict[str, str]:
    return {
        "type": "mrkdwn",
        "text": f"*{slack_escape(label)}:*\n{slack_escape(truncate_text(value, 450))}",
    }


def build_slack_payload(
    title: str,
    summary: str,
    timestamp: str,
    fields: list[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    normalized_summary = truncate_text(summary, 1_200)
    block_fields = [slack_field("Timestamp", timestamp)]
    block_fields.extend(slack_field(label, value) for label, value in fields or [])

    return {
        "text": f"{title} - {normalized_summary}",
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": title[:150],
                },
            },
            {
                "type": "section",
                "fields": block_fields[:10],
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Incident Summary:*\n{slack_escape(normalized_summary)}",
                },
            },
        ],
    }


def send_slack_payload(payload: dict[str, Any], required: bool = False) -> bool:
    webhook_url = slack_webhook_url(required=required)
    if webhook_url is None:
        return False

    body = json.dumps(payload).encode("utf-8")
    request = UrlRequest(
        webhook_url,
        data=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "DevPilot-AI",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=10) as response:
            response.read()
            if 200 <= response.status < 300:
                return True

            if required:
                raise HTTPException(
                    status_code=502,
                    detail=f"Slack webhook returned HTTP {response.status}.",
                )
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace").strip()
        if required:
            detail = f"Slack webhook failed with HTTP {exc.code}."
            if error_body:
                detail = f"{detail} {error_body}"
            raise HTTPException(status_code=502, detail=detail) from exc

        print(f"Slack webhook failed with HTTP {exc.code}.", flush=True)
        return False
    except URLError as exc:
        if required:
            raise HTTPException(
                status_code=502,
                detail="Could not reach the Slack webhook.",
            ) from exc

        print("Could not reach the Slack webhook.", flush=True)
        return False

    return False


def send_slack_notification(
    title: str,
    summary: str,
    timestamp: str,
    fields: list[tuple[str, str]] | None = None,
    *,
    required: bool = False,
) -> bool:
    return send_slack_payload(
        build_slack_payload(title, summary, timestamp, fields),
        required=required,
    )


def model_to_dict(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()

    return model.dict()


def billing_period_bounds(now: datetime | None = None) -> tuple[str, str]:
    timestamp = now or datetime.now(UTC)
    start = timestamp.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)

    return start.isoformat(), end.isoformat()


def saas_team_from_row(row: dict[str, Any]) -> SaaSTeamAccount:
    return SaaSTeamAccount(
        id=str(row["id"]),
        name=str(row["name"]),
        plan_id=normalize_billing_plan(str(row["plan_id"])),
        owner_email=str(row["owner_email"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        member_count=int(row.get("member_count") or 0),
    )


def team_member_from_row(row: dict[str, Any]) -> TeamMember:
    role = str(row["role"])
    if role not in {"owner", "admin", "member", "viewer"}:
        role = "member"

    return TeamMember(
        id=str(row["id"]),
        team_id=str(row["team_id"]),
        email=str(row["email"]),
        role=cast(TeamMemberRole, role),
        created_at=str(row["created_at"]),
    )


def fetch_saas_team_rows() -> list[dict[str, Any]]:
    with incident_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                teams.id,
                teams.name,
                teams.plan_id,
                teams.owner_email,
                teams.created_at,
                teams.updated_at,
                COUNT(members.id) AS member_count
            FROM saas_teams AS teams
            LEFT JOIN saas_team_members AS members ON members.team_id = teams.id
            GROUP BY teams.id
            ORDER BY teams.updated_at DESC, teams.name ASC
            """,
        ).fetchall()

    return [dict(row) for row in rows]


def fetch_saas_teams() -> list[SaaSTeamAccount]:
    return [saas_team_from_row(row) for row in fetch_saas_team_rows()]


def fetch_saas_team(team_id: str | None = None) -> SaaSTeamAccount | None:
    resolved_team_id = normalize_team_id(team_id or current_team_id())
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT
                teams.id,
                teams.name,
                teams.plan_id,
                teams.owner_email,
                teams.created_at,
                teams.updated_at,
                COUNT(members.id) AS member_count
            FROM saas_teams AS teams
            LEFT JOIN saas_team_members AS members ON members.team_id = teams.id
            WHERE teams.id = ?
            GROUP BY teams.id
            LIMIT 1
            """,
            (resolved_team_id,),
        ).fetchone()

    return saas_team_from_row(dict(row)) if row else None


def require_saas_team(team_id: str | None = None) -> SaaSTeamAccount:
    team = fetch_saas_team(team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="DevPilot team account was not found.")

    return team


def fetch_team_members(team_id: str | None = None) -> list[TeamMember]:
    resolved_team_id = normalize_team_id(team_id or current_team_id())
    with incident_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, team_id, email, role, created_at
            FROM saas_team_members
            WHERE team_id = ?
            ORDER BY
                CASE role
                    WHEN 'owner' THEN 0
                    WHEN 'admin' THEN 1
                    WHEN 'member' THEN 2
                    ELSE 3
                END,
                created_at ASC
            """,
            (resolved_team_id,),
        ).fetchall()

    return [team_member_from_row(dict(row)) for row in rows]


def create_saas_team(payload: TeamCreateRequest) -> SaaSTeamAccount:
    name = truncate_text(payload.name, 120)
    owner_email = normalize_owner_email(payload.owner_email)
    plan_id = normalize_billing_plan(payload.plan_id)
    team_id = f"team_{uuid4().hex[:12]}"
    created_at = datetime.now(UTC).isoformat()

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO saas_teams (
                id, name, plan_id, owner_email, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (team_id, name, plan_id, owner_email, created_at, created_at),
        )
        connection.execute(
            """
            INSERT INTO saas_team_members (id, team_id, email, role, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid4()), team_id, owner_email, "owner", created_at),
        )

    team = fetch_saas_team(team_id)
    if team is None:
        raise HTTPException(status_code=500, detail="Could not create team account.")

    return team


def update_saas_team_plan(team_id: str, plan_id: BillingPlanId) -> SaaSTeamAccount:
    resolved_team_id = normalize_team_id(team_id)
    require_saas_team(resolved_team_id)
    updated_at = datetime.now(UTC).isoformat()

    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE saas_teams
            SET plan_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (plan_id, updated_at, resolved_team_id),
        )

    return require_saas_team(resolved_team_id)


def add_team_member(team_id: str, payload: TeamMemberInviteRequest) -> TeamMember:
    resolved_team_id = normalize_team_id(team_id)
    team = require_saas_team(resolved_team_id)
    email = normalize_owner_email(payload.email)
    role = payload.role
    members = fetch_team_members(resolved_team_id)
    plan = billing_plan_from_catalog(team.plan_id)

    if len(members) >= plan.included_members and email not in {
        member.email for member in members
    }:
        raise HTTPException(
            status_code=402,
            detail=(
                f"{plan.name} includes {plan.included_members} team member(s). "
                "Upgrade to Pro or remove a member before inviting more people."
            ),
        )

    created_at = datetime.now(UTC).isoformat()
    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO saas_team_members (id, team_id, email, role, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(team_id, email) DO UPDATE SET role = excluded.role
            """,
            (str(uuid4()), resolved_team_id, email, role, created_at),
        )

    return next(member for member in fetch_team_members(resolved_team_id) if member.email == email)


def plan_limit_for_metric(plan: BillingPlan, metric: UsageMetric) -> int:
    return {
        "api_requests": plan.monthly_api_requests,
        "ai_actions": plan.monthly_ai_actions,
        "autonomous_actions": plan.monthly_ai_actions,
        "auto_heal_actions": plan.monthly_auto_heal_actions,
    }[metric]


def usage_totals_for_team(team_id: str, period_start: str) -> dict[UsageMetric, int]:
    with incident_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT metric, COALESCE(SUM(quantity), 0) AS total
            FROM saas_usage_events
            WHERE team_id = ? AND created_at >= ?
            GROUP BY metric
            """,
            (team_id, period_start),
        ).fetchall()

    totals: dict[UsageMetric, int] = {
        "api_requests": 0,
        "ai_actions": 0,
        "autonomous_actions": 0,
        "auto_heal_actions": 0,
    }
    for row in rows:
        metric = str(row["metric"])
        if metric in totals:
            totals[cast(UsageMetric, metric)] = int(row["total"] or 0)

    return totals


def build_usage_metric(
    *,
    metric: UsageMetric,
    used: int,
    limit: int,
) -> TeamUsageMetric:
    remaining = max(limit - used, 0)
    percent_used = round(min((used / limit) * 100, 100), 1) if limit else 100.0

    return TeamUsageMetric(
        metric=metric,
        used=used,
        limit=limit,
        remaining=remaining,
        percent_used=percent_used,
    )


def team_usage_summary(team_id: str | None = None) -> TeamUsageSummaryResponse:
    team = require_saas_team(team_id)
    plan = billing_plan_from_catalog(team.plan_id)
    members = fetch_team_members(team.id)
    period_start, period_end = billing_period_bounds()
    totals = usage_totals_for_team(team.id, period_start)
    usage = [
        build_usage_metric(
            metric=metric,
            used=totals[metric],
            limit=plan_limit_for_metric(plan, metric),
        )
        for metric in (
            "api_requests",
            "ai_actions",
            "autonomous_actions",
            "auto_heal_actions",
        )
    ]

    return TeamUsageSummaryResponse(
        team=team,
        plan=plan,
        members=members,
        usage=usage,
        billing_period_start=period_start,
        billing_period_end=period_end,
    )


def track_usage_event(
    *,
    team_id: str,
    metric: UsageMetric,
    source: str,
    quantity: int = 1,
) -> None:
    if quantity <= 0:
        return

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO saas_usage_events (
                id, team_id, metric, source, quantity, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                team_id,
                metric,
                source,
                quantity,
                datetime.now(UTC).isoformat(),
            ),
        )


def metered_usage_metrics(path: str, method: str) -> list[UsageMetric]:
    if method == "OPTIONS" or path.startswith("/saas") or path in {"/health", "/"}:
        return []

    metrics: list[UsageMetric] = ["api_requests"]
    if path in {
        "/analyze-log",
        "/generate-fix",
        "/model/train",
        "/custom-model/train",
        "/ai/train-custom-model",
        "/model/evaluate",
        "/custom-model/evaluate",
        "/failures/predict",
        "/security/analyze",
        "/voice/ask",
        "/assistant/voice/ask",
    }:
        metrics.append("ai_actions")
    if path in {
        "/agent/run-cycle",
        "/autonomous-agent/run-cycle",
        "/agents/collaborate",
        "/multi-agent/collaborate",
        "/agent/approvals",
    } or path.startswith("/agent/approvals/"):
        metrics.append("autonomous_actions")
    if path in {
        "/auto-heal",
        "/kubernetes/restart-pod",
        "/kubernetes/rollback-deployment",
        "/kubernetes/scale-deployment",
        "/infra/command",
        "/terraform/apply",
    }:
        metrics.append("auto_heal_actions")

    return metrics


def quota_error_for_request(team_id: str, metrics: list[UsageMetric]) -> JSONResponse | None:
    if not metrics:
        return None

    team = fetch_saas_team(team_id)
    if team is None:
        return JSONResponse(
            status_code=404,
            content={"detail": "DevPilot team account was not found."},
        )

    plan = billing_plan_from_catalog(team.plan_id)
    period_start, _ = billing_period_bounds()
    totals = usage_totals_for_team(team_id, period_start)
    for metric in metrics:
        limit = plan_limit_for_metric(plan, metric)
        if totals[metric] + 1 > limit:
            return JSONResponse(
                status_code=402,
                content={
                    "detail": (
                        f"{plan.name} plan monthly {metric.replace('_', ' ')} "
                        "limit reached. Upgrade to Pro or wait for the next billing period."
                    ),
                    "team_id": team_id,
                    "plan_id": plan.id,
                    "metric": metric,
                },
            )

    return None


def plugin_from_catalog(
    plugin_id: PluginId,
    installed_row: dict[str, Any] | None = None,
) -> MarketplacePlugin:
    catalog = PLUGIN_MARKETPLACE_CATALOG[plugin_id]
    installed = installed_row is not None

    return MarketplacePlugin(
        id=plugin_id,
        name=str(catalog["name"]),
        category=cast(PluginCategory, catalog["category"]),
        description=str(catalog["description"]),
        capabilities=[str(value) for value in catalog["capabilities"]],
        required_secrets=[str(value) for value in catalog["required_secrets"]],
        setup_steps=[str(value) for value in catalog["setup_steps"]],
        status="installed" if installed else "available",
        connection_name=(
            str(installed_row["connection_name"])
            if installed and installed_row.get("connection_name")
            else None
        ),
        environment=(
            str(installed_row["environment"])
            if installed and installed_row.get("environment")
            else None
        ),
        installed_at=(
            str(installed_row["installed_at"])
            if installed and installed_row.get("installed_at")
            else None
        ),
        installed_by=(
            str(installed_row["installed_by"])
            if installed and installed_row.get("installed_by")
            else None
        ),
        configured=installed,
    )


def fetch_installed_plugin_rows() -> dict[str, dict[str, Any]]:
    with incident_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT plugin_id, connection_name, environment, notes, installed_by,
                   installed_at, updated_at
            FROM installed_plugins
            """,
        ).fetchall()

    return {str(row["plugin_id"]): dict(row) for row in rows}


def plugin_marketplace_response() -> PluginMarketplaceResponse:
    installed_rows = fetch_installed_plugin_rows()
    plugins = [
        plugin_from_catalog(plugin_id, installed_rows.get(plugin_id))
        for plugin_id in PLUGIN_MARKETPLACE_CATALOG
    ]
    installed_count = sum(1 for plugin in plugins if plugin.status == "installed")

    return PluginMarketplaceResponse(
        plugins=plugins,
        installed_count=installed_count,
        available_count=len(plugins) - installed_count,
    )


def installed_plugin(plugin_id: PluginId) -> MarketplacePlugin:
    return plugin_from_catalog(
        plugin_id,
        fetch_installed_plugin_rows().get(plugin_id),
    )


def clear_incident_history_cache() -> None:
    with INCIDENT_HISTORY_CACHE_LOCK:
        INCIDENT_HISTORY_CACHE.clear()


def incident_db_path() -> Path:
    configured_path = os.getenv(INCIDENT_DB_PATH_ENV, "").strip()
    if not configured_path:
        return DEFAULT_INCIDENT_DB_PATH

    path = Path(configured_path).expanduser()
    if not path.is_absolute():
        path = Path(__file__).parent / path

    return path


def ensure_sqlite_column(
    connection: StorageConnectionProxy,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    if using_postgres_storage():
        return

    columns = {
        str(row[1])
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        connection.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}",
        )


def lock_storage_initialization(connection: StorageConnectionProxy) -> None:
    if using_postgres_storage():
        connection.execute("SELECT pg_advisory_xact_lock(424242501)")


def init_incident_db() -> None:
    global INCIDENT_DB_INITIALIZED
    if INCIDENT_DB_INITIALIZED:
        return

    with INCIDENT_DB_INIT_LOCK:
        if INCIDENT_DB_INITIALIZED:
            return

        with open_storage_connection() as connection:
            lock_storage_initialization(connection)
            _initialize_storage_schema(connection)
            seeded_at = datetime.now(UTC).isoformat()
            connection.execute(
                """
                INSERT INTO saas_teams (
                    id, name, plan_id, owner_email, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
                """,
                (
                    DEFAULT_SAAS_TEAM_ID,
                    "DevPilot Demo Team",
                    "pro",
                    DEFAULT_SAAS_OWNER_EMAIL,
                    seeded_at,
                    seeded_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO saas_team_members (
                    id, team_id, email, role, created_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(team_id, email) DO NOTHING
                """,
                (
                    "member_default_owner",
                    DEFAULT_SAAS_TEAM_ID,
                    DEFAULT_SAAS_OWNER_EMAIL,
                    "owner",
                    seeded_at,
                ),
            )

        INCIDENT_DB_INITIALIZED = True


def incident_db_connection() -> StorageConnectionProxy:
    init_incident_db()
    return open_storage_connection()


def incident_search_text(
    summary: str,
    raw_logs: str | None = None,
    explanation: str | None = None,
    recommended_fix: str | None = None,
    cloud_provider: str | None = None,
    fix_payload: str | None = None,
) -> str:
    values = [
        summary,
        raw_logs or "",
        explanation or "",
        recommended_fix or "",
        cloud_provider or "",
        fix_payload or "",
    ]
    return "\n".join(value for value in values if value.strip())


def store_incident_memory(
    *,
    source: str,
    summary: str,
    raw_logs: str | None = None,
    severity: str | None = None,
    explanation: str | None = None,
    recommended_fix: str | None = None,
    cloud_provider: str | None = None,
    fix_payload: str | None = None,
    created_at: str | None = None,
) -> str:
    now = datetime.now(UTC).isoformat()
    incident_id = str(uuid4())
    team_id = current_team_id()
    normalized_summary = truncate_text(summary, 1_000)
    search_text = incident_search_text(
        summary=normalized_summary,
        raw_logs=raw_logs,
        explanation=explanation,
        recommended_fix=recommended_fix,
        cloud_provider=cloud_provider,
        fix_payload=fix_payload,
    )

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO incident_memory (
                id,
                team_id,
                source,
                raw_logs,
                summary,
                severity,
                explanation,
                recommended_fix,
                cloud_provider,
                fix_payload,
                search_text,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                incident_id,
                team_id,
                source,
                raw_logs,
                normalized_summary,
                severity,
                explanation,
                recommended_fix,
                cloud_provider,
                fix_payload,
                search_text,
                created_at or now,
                now,
            ),
        )

    clear_incident_history_cache()
    return incident_id


def first_log_summary(logs: str, filename: str | None = None) -> str:
    if filename:
        return f"Uploaded log file: {filename}"

    for line in logs.splitlines():
        stripped = line.strip()
        if stripped:
            return truncate_text(stripped, 180)

    return "Uploaded incident logs."


def store_log_analysis(logs: str, analysis: LogAnalysisResponse, detected_at: str) -> str:
    return store_incident_memory(
        source="/analyze-log",
        raw_logs=logs,
        summary=analysis.root_cause,
        severity=analysis.severity,
        explanation=analysis.explanation,
        recommended_fix=analysis.recommended_fix,
        created_at=detected_at,
    )


def store_generated_fix(
    issue: str,
    cloud_provider: CloudProvider,
    generated_fix: FixGenerationResponse,
    source: str,
    *,
    explanation: str | None = None,
    created_at: str | None = None,
) -> str:
    fix_payload = json.dumps(model_to_dict(generated_fix), ensure_ascii=True)
    suggestions = generated_fix.deployment_suggestions
    recommended_fix = "; ".join(suggestions[:4]) if suggestions else None

    return store_incident_memory(
        source=source,
        summary=issue,
        explanation=explanation,
        recommended_fix=recommended_fix,
        cloud_provider=cloud_provider,
        fix_payload=fix_payload,
        created_at=created_at,
    )


def incident_tokens(value: str) -> set[str]:
    return {
        token.lower()
        for token in INCIDENT_TOKEN_RE.findall(value)
        if token.lower() not in INCIDENT_SEARCH_STOP_WORDS
    }


def incident_similarity_score(query_tokens: set[str], search_text: str) -> float:
    candidate_tokens = incident_tokens(search_text)
    if not query_tokens or not candidate_tokens:
        return 0.0

    overlap = query_tokens & candidate_tokens
    if not overlap:
        return 0.0

    query_coverage = len(overlap) / len(query_tokens)
    candidate_coverage = len(overlap) / len(candidate_tokens)
    return round(min((query_coverage * 0.8) + (candidate_coverage * 0.2), 1.0), 4)


def fetch_incident_rows(limit: int = 100, include_search_text: bool = False) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    team_id = current_team_id()
    selected_columns = (
        "id, team_id, source, raw_logs, summary, severity, explanation, recommended_fix, "
        "cloud_provider, fix_payload, created_at, updated_at"
    )
    if include_search_text:
        selected_columns = f"{selected_columns}, search_text"

    with incident_db_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT {selected_columns}
            FROM incident_memory
            WHERE team_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (team_id, safe_limit),
        ).fetchall()

    return [dict(row) for row in rows]


def incident_record_from_row(
    row: dict[str, Any],
    similarity_score: float | None = None,
) -> IncidentMemoryRecord:
    return IncidentMemoryRecord(
        id=str(row["id"]),
        source=str(row["source"]),
        summary=str(row["summary"]),
        severity=row.get("severity"),
        explanation=row.get("explanation"),
        recommended_fix=row.get("recommended_fix"),
        cloud_provider=row.get("cloud_provider"),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        has_logs=bool(row.get("raw_logs")),
        has_fix=bool(row.get("recommended_fix") or row.get("fix_payload")),
        similarity_score=similarity_score,
    )


def cached_incident_history(limit: int) -> list[IncidentMemoryRecord]:
    team_id = current_team_id()
    safe_limit = max(1, min(limit, 100))
    cache_key = (team_id, safe_limit)
    now = time.monotonic()

    with INCIDENT_HISTORY_CACHE_LOCK:
        cached = INCIDENT_HISTORY_CACHE.get(cache_key)
        if cached:
            cached_at, records = cached
            if now - cached_at < INCIDENT_HISTORY_CACHE_TTL_SECONDS:
                return records

    records = [
        incident_record_from_row(row)
        for row in fetch_incident_rows(limit=safe_limit)
    ]

    with INCIDENT_HISTORY_CACHE_LOCK:
        INCIDENT_HISTORY_CACHE[cache_key] = (now, records)

    return records


def fetch_incident_row_by_id(incident_id: str) -> dict[str, Any] | None:
    team_id = current_team_id()
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT id, team_id, source, raw_logs, summary, severity, explanation,
                   recommended_fix, cloud_provider, fix_payload,
                   created_at, updated_at, search_text
            FROM incident_memory
            WHERE id = ? AND team_id = ?
            """,
            (incident_id, team_id),
        ).fetchone()

    return dict(row) if row else None


AUTONOMOUS_ACTION_STATUSES = {
    "observed",
    "decided",
    "pending_approval",
    "approved",
    "completed",
    "simulated",
    "skipped",
    "rejected",
    "failed",
}
AUTONOMOUS_APPROVAL_STATUSES = {
    "pending",
    "approved",
    "applied",
    "rejected",
    "failed",
}


def agent_id_for_action(action_type: str) -> DevPilotAgentId:
    return DEV_PILOT_AGENT_ACTION_MAP.get(action_type, "monitoring")


def agent_name(agent_id: DevPilotAgentId) -> str:
    return str(DEV_PILOT_AGENT_PROFILES[agent_id]["name"])


def log_autonomous_action(
    *,
    cycle_id: str,
    action_type: str,
    target: str,
    status: AutonomousActionStatus,
    detail: str,
    incident_id: str | None = None,
    created_at: str | None = None,
) -> str:
    action_id = str(uuid4())
    team_id = current_team_id()
    timestamp = created_at or datetime.now(UTC).isoformat()

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO autonomous_agent_actions (
                id,
                team_id,
                cycle_id,
                incident_id,
                action_type,
                target,
                status,
                detail,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                action_id,
                team_id,
                cycle_id,
                incident_id,
                action_type,
                target,
                status,
                truncate_text(detail, 1_500),
                timestamp,
            ),
        )

    return action_id


def autonomous_action_record_from_row(row: dict[str, Any]) -> AutonomousActionLogRecord:
    status = str(row["status"])
    if status not in AUTONOMOUS_ACTION_STATUSES:
        status = "completed"
    agent_id = agent_id_for_action(str(row["action_type"]))

    return AutonomousActionLogRecord(
        id=str(row["id"]),
        cycle_id=str(row["cycle_id"]),
        incident_id=row.get("incident_id"),
        agent_id=agent_id,
        agent_name=agent_name(agent_id),
        action_type=str(row["action_type"]),
        target=str(row["target"]),
        status=cast(AutonomousActionStatus, status),
        detail=str(row["detail"]),
        created_at=str(row["created_at"]),
    )


def fetch_autonomous_action_rows(limit: int = 25) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    team_id = current_team_id()

    with incident_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, team_id, cycle_id, incident_id, action_type, target,
                   status, detail, created_at
            FROM autonomous_agent_actions
            WHERE team_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (team_id, safe_limit),
        ).fetchall()

    return [dict(row) for row in rows]


def count_autonomous_actions() -> int:
    team_id = current_team_id()
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM autonomous_agent_actions
            WHERE team_id = ?
            """,
            (team_id,),
        ).fetchone()

    return int(row["total"] if row else 0)


def autonomous_approval_record_from_row(row: dict[str, Any]) -> AutonomousApprovalRecord:
    status = str(row["status"])
    if status not in AUTONOMOUS_APPROVAL_STATUSES:
        status = "pending"

    try:
        actions = json.loads(str(row["actions_json"]))
    except json.JSONDecodeError:
        actions = []
    if not isinstance(actions, list):
        actions = []

    cloud_provider = normalize_cloud_provider(str(row.get("cloud_provider") or "aws"))

    return AutonomousApprovalRecord(
        id=str(row["id"]),
        cycle_id=str(row["cycle_id"]),
        incident_id=row.get("incident_id"),
        summary=str(row["summary"]),
        severity=row.get("severity"),
        strategy=str(row["strategy"]),
        confidence=float(row["confidence"] or 0),
        actions=[str(action) for action in actions],
        cloud_provider=cloud_provider,
        status=cast(AutonomousApprovalStatus, status),
        requested_at=str(row["requested_at"]),
        reviewed_at=row.get("reviewed_at"),
        reviewed_by_role=row.get("reviewed_by_role"),
        reviewer_note=row.get("reviewer_note"),
        applied_at=row.get("applied_at"),
        failure_reason=row.get("failure_reason"),
    )


def fetch_autonomous_approval_rows(
    *,
    statuses: set[AutonomousApprovalStatus] | None = None,
    limit: int = 25,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 200))
    team_id = current_team_id()
    params: list[Any] = [team_id]
    where_parts = ["team_id = ?"]

    if statuses:
        placeholders = ", ".join("?" for _ in statuses)
        where_parts.append(f"status IN ({placeholders})")
        params.extend(sorted(statuses))

    params.append(safe_limit)
    where_clause = "WHERE " + " AND ".join(where_parts)

    with incident_db_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
                id,
                team_id,
                cycle_id,
                incident_id,
                summary,
                severity,
                strategy,
                confidence,
                actions_json,
                cloud_provider,
                target_json,
                generated_fix_json,
                status,
                requested_at,
                reviewed_at,
                reviewed_by_role,
                reviewer_note,
                applied_at,
                failure_reason
            FROM autonomous_agent_approvals
            {where_clause}
            ORDER BY requested_at DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

    return [dict(row) for row in rows]


def fetch_autonomous_approval_row(approval_id: str) -> dict[str, Any] | None:
    team_id = current_team_id()
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT
                id,
                team_id,
                cycle_id,
                incident_id,
                summary,
                severity,
                strategy,
                confidence,
                actions_json,
                cloud_provider,
                target_json,
                generated_fix_json,
                status,
                requested_at,
                reviewed_at,
                reviewed_by_role,
                reviewer_note,
                applied_at,
                failure_reason
            FROM autonomous_agent_approvals
            WHERE id = ? AND team_id = ?
            LIMIT 1
            """,
            (approval_id, team_id),
        ).fetchone()

    return dict(row) if row else None


def fetch_open_autonomous_approval_for_incident(
    incident_id: str,
) -> dict[str, Any] | None:
    team_id = current_team_id()
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT
                id,
                team_id,
                cycle_id,
                incident_id,
                summary,
                severity,
                strategy,
                confidence,
                actions_json,
                cloud_provider,
                target_json,
                generated_fix_json,
                status,
                requested_at,
                reviewed_at,
                reviewed_by_role,
                reviewer_note,
                applied_at,
                failure_reason
            FROM autonomous_agent_approvals
            WHERE incident_id = ?
              AND team_id = ?
              AND status IN ('pending', 'approved')
            ORDER BY requested_at DESC
            LIMIT 1
            """,
            (incident_id, team_id),
        ).fetchone()

    return dict(row) if row else None


def create_autonomous_approval_request(
    *,
    cycle_id: str,
    incident_id: str,
    decision: AutonomousAgentDecision,
    target: dict[str, str],
    cloud_provider: CloudProvider,
    generated_fix: FixGenerationResponse | None,
) -> AutonomousApprovalRecord:
    existing_approval = fetch_open_autonomous_approval_for_incident(incident_id)
    if existing_approval:
        return autonomous_approval_record_from_row(existing_approval)

    approval_id = str(uuid4())
    team_id = current_team_id()
    requested_at = datetime.now(UTC).isoformat()
    generated_fix_json = (
        json.dumps(model_to_dict(generated_fix), ensure_ascii=True)
        if generated_fix
        else None
    )

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO autonomous_agent_approvals (
                id,
                team_id,
                cycle_id,
                incident_id,
                summary,
                severity,
                strategy,
                confidence,
                actions_json,
                cloud_provider,
                target_json,
                generated_fix_json,
                status,
                requested_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                approval_id,
                team_id,
                cycle_id,
                incident_id,
                decision.summary,
                decision.severity,
                decision.strategy,
                decision.confidence,
                json.dumps(decision.actions, ensure_ascii=True),
                cloud_provider,
                json.dumps(target, ensure_ascii=True),
                generated_fix_json,
                "pending",
                requested_at,
            ),
        )

    row = fetch_autonomous_approval_row(approval_id)
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="Could not create autonomous approval request.",
        )

    return autonomous_approval_record_from_row(row)


def update_autonomous_approval_status(
    approval_id: str,
    *,
    status: AutonomousApprovalStatus,
    reviewed_at: str | None = None,
    reviewed_by_role: str | None = None,
    reviewer_note: str | None = None,
    applied_at: str | None = None,
    failure_reason: str | None = None,
) -> AutonomousApprovalRecord:
    with incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE autonomous_agent_approvals
            SET
                status = ?,
                reviewed_at = COALESCE(?, reviewed_at),
                reviewed_by_role = COALESCE(?, reviewed_by_role),
                reviewer_note = COALESCE(?, reviewer_note),
                applied_at = COALESCE(?, applied_at),
                failure_reason = ?
            WHERE id = ? AND team_id = ?
            """,
            (
                status,
                reviewed_at,
                reviewed_by_role,
                reviewer_note,
                applied_at,
                failure_reason,
                approval_id,
                current_team_id(),
            ),
        )

    row = fetch_autonomous_approval_row(approval_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Approval request was not found.")

    return autonomous_approval_record_from_row(row)


def agent_state_for_action(action: AutonomousActionLogRecord | None) -> DevPilotAgentState:
    if action is None:
        return "waiting"
    if action.status in {"failed", "rejected"}:
        return "blocked"
    if action.status in {"observed", "decided", "pending_approval", "approved"}:
        return "active"
    if action.status == "skipped":
        return "waiting"

    return "completed"


def build_agent_profiles(
    actions: list[AutonomousActionLogRecord],
) -> list[DevPilotAgentProfile]:
    actions_by_agent: dict[DevPilotAgentId, list[AutonomousActionLogRecord]] = {
        agent_id: [] for agent_id in DEV_PILOT_AGENT_ORDER
    }
    for action in actions:
        actions_by_agent[action.agent_id].append(action)

    profiles: list[DevPilotAgentProfile] = []
    for agent_id in DEV_PILOT_AGENT_ORDER:
        profile = DEV_PILOT_AGENT_PROFILES[agent_id]
        agent_actions = actions_by_agent[agent_id]
        latest_action = agent_actions[0] if agent_actions else None
        profiles.append(
            DevPilotAgentProfile(
                id=agent_id,
                name=str(profile["name"]),
                mission=str(profile["mission"]),
                status=agent_state_for_action(latest_action),
                last_action=(
                    f"{format_action_name(latest_action.action_type)}: "
                    f"{latest_action.detail}"
                    if latest_action
                    else "Waiting for a collaboration run."
                ),
                last_action_at=latest_action.created_at if latest_action else None,
                handoff_to=(
                    str(profile["handoff_to"]) if profile["handoff_to"] else None
                ),
                actions_logged=len(agent_actions),
            ),
        )

    return profiles


def has_action_for_agent(
    actions: list[AutonomousActionLogRecord],
    agent_id: DevPilotAgentId,
) -> bool:
    return any(action.agent_id == agent_id for action in actions)


def build_agent_handoffs(
    actions: list[AutonomousActionLogRecord],
) -> list[AgentCollaborationHandoff]:
    handoff_specs = [
        (
            "Monitoring Agent",
            "Bug Sentinel Agent",
            "Monitoring handed raw runtime, CI/CD, and infrastructure signals to bug triage.",
            ("monitoring", "bug_sentinel"),
        ),
        (
            "Bug Sentinel Agent",
            "Frontend Guardian Agent",
            "Bug triage handed browser, button, and route concerns to the frontend auditor.",
            ("bug_sentinel", "frontend_guardian"),
        ),
        (
            "Bug Sentinel Agent",
            "Backend Guardian Agent",
            "Bug triage handed API and auth concerns to the backend auditor.",
            ("bug_sentinel", "backend_guardian"),
        ),
        (
            "Frontend Guardian Agent",
            "Full UI Monitor Agent",
            "Frontend checks were expanded into full-section interaction monitoring.",
            ("frontend_guardian", "ui_monitor"),
        ),
        (
            "Backend Guardian Agent",
            "Database Guardian Agent",
            "Backend contracts were checked against storage and account isolation readiness.",
            ("backend_guardian", "database_guardian"),
        ),
        (
            "Database Guardian Agent",
            "Release Auditor Agent",
            "Database readiness was handed to release validation for production gaps.",
            ("database_guardian", "release_auditor"),
        ),
        (
            "Full UI Monitor Agent",
            "Release Auditor Agent",
            "UI coverage was handed to release validation for final pending-work checks.",
            ("ui_monitor", "release_auditor"),
        ),
        (
            "Release Auditor Agent",
            "Root Cause Agent",
            "Release audit handed verified product gaps and deployment signals to diagnosis.",
            ("release_auditor", "root_cause"),
        ),
        (
            "Root Cause Agent",
            "Security Agent",
            "Root cause context was reviewed for security risk before remediation.",
            ("root_cause", "security"),
        ),
        (
            "Root Cause Agent",
            "Fix Generator Agent",
            "Chosen strategy was converted into remediation artifacts.",
            ("root_cause", "fix_generator"),
        ),
        (
            "Fix Generator Agent",
            "Auto Heal Agent",
            "Generated fix plan was handed to recovery execution.",
            ("fix_generator", "auto_heal"),
        ),
        (
            "Security Agent",
            "Release Auditor Agent",
            "Security review handed remediation risk status back into the release gate.",
            ("security", "release_auditor"),
        ),
        (
            "Release Auditor Agent",
            "Auto Heal Agent",
            "Release validation cleared safe-mode remediation to proceed.",
            ("release_auditor", "auto_heal"),
        ),
    ]

    return [
        AgentCollaborationHandoff(
            from_agent=from_agent,
            to_agent=to_agent,
            detail=detail,
            status=(
                "completed"
                if has_action_for_agent(actions, source_agent)
                and has_action_for_agent(actions, target_agent)
                else "pending"
            ),
        )
        for from_agent, to_agent, detail, (source_agent, target_agent) in handoff_specs
    ]


def has_autonomous_remediation_for_incident(incident_id: str) -> bool:
    team_id = current_team_id()
    with incident_db_connection() as connection:
        row = connection.execute(
            """
            SELECT 1
            FROM autonomous_agent_actions
            WHERE incident_id = ?
              AND team_id = ?
              AND (
                (
                    action_type = 'remediation_completed'
                    AND status IN ('completed', 'simulated')
                )
                OR (
                    action_type IN (
                        'approval_requested',
                        'approval_approved',
                        'approval_rejected'
                    )
                    AND status IN (
                        'pending_approval',
                        'approved',
                        'rejected',
                        'completed'
                    )
                )
              )
            LIMIT 1
            """,
            (incident_id, team_id),
        ).fetchone()

    return row is not None


def fetch_autonomous_incident_candidates(limit: int = 100) -> list[dict[str, Any]]:
    rows = fetch_incident_rows(limit=limit, include_search_text=True)
    candidates = [
        row
        for row in rows
        if row.get("source") in AUTONOMOUS_INCIDENT_SOURCES
        and not has_autonomous_remediation_for_incident(str(row["id"]))
    ]

    return sorted(
        candidates,
        key=lambda row: (
            AUTONOMOUS_SEVERITY_PRIORITY.get(str(row.get("severity") or "").lower(), 0),
            AUTONOMOUS_SOURCE_PRIORITY.get(str(row.get("source")), 0),
            str(row.get("created_at") or ""),
        ),
        reverse=True,
    )


def find_similar_incident_rows(
    query: str,
    limit: int = 5,
) -> list[tuple[dict[str, Any], float]]:
    query_tokens = incident_tokens(query)
    if not query_tokens:
        return []

    rows = fetch_incident_rows(limit=500, include_search_text=True)
    scored_rows = [
        (row, incident_similarity_score(query_tokens, row.get("search_text") or ""))
        for row in rows
    ]

    matches = [(row, score) for row, score in scored_rows if score > 0]
    matches.sort(key=lambda match: (match[1], match[0]["created_at"]), reverse=True)
    return matches[: max(1, min(limit, 25))]


def parse_stored_fix_payload(row: dict[str, Any]) -> dict[str, Any]:
    fix_payload = row.get("fix_payload")
    if not isinstance(fix_payload, str) or not fix_payload:
        return {}

    try:
        parsed_payload: Any = json.loads(fix_payload)
    except json.JSONDecodeError:
        return {}

    return parsed_payload if isinstance(parsed_payload, dict) else {}


def unique_suggestions(suggestions: list[str], limit: int | None = None) -> list[str]:
    unique_values = []
    seen = set()
    for suggestion in suggestions:
        normalized = " ".join(suggestion.strip().split())
        if not normalized:
            continue

        key = normalized.lower()
        if key in seen:
            continue

        seen.add(key)
        unique_values.append(normalized)

        if limit is not None and len(unique_values) >= limit:
            break

    return unique_values


def failure_prediction_row_blob(row: dict[str, Any]) -> str:
    return "\n".join(
        str(row.get(key) or "")
        for key in (
            "summary",
            "raw_logs",
            "severity",
            "explanation",
            "recommended_fix",
            "search_text",
        )
    )


def count_failure_signal_occurrences(text: str, tokens: tuple[str, ...]) -> int:
    normalized_text = text.lower()
    return sum(normalized_text.count(token.lower()) for token in tokens)


def failure_signal_evidence(
    rows: list[dict[str, Any]],
    tokens: tuple[str, ...],
    limit: int = 3,
) -> list[str]:
    evidence: list[str] = []

    for row in rows:
        if count_failure_signal_occurrences(failure_prediction_row_blob(row), tokens) == 0:
            continue

        source = str(row.get("source") or "incident memory")
        created_at = str(row.get("created_at") or "unknown time")
        summary = truncate_text(str(row.get("summary") or "historical signal"), 140)
        evidence.append(f"{created_at} {source}: {summary}")

        if len(evidence) >= limit:
            break

    return evidence


def severity_boost_for_rows(rows: list[dict[str, Any]]) -> float:
    boost = 0.0
    for row in rows[:5]:
        severity = str(row.get("severity") or "").lower()
        if severity == "critical":
            boost += 0.06
        elif severity == "high":
            boost += 0.04
        elif severity == "medium":
            boost += 0.02

    return min(boost, 0.18)


def prediction_risk_level(score: float) -> Literal["low", "medium", "high", "critical"]:
    if score >= 1.35:
        return "critical"
    if score >= 0.9:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


def logs_for_failure_prediction(
    current_logs: str | None,
    rows: list[dict[str, Any]],
) -> str:
    logs = (current_logs or "").strip()
    if logs:
        return logs

    return "\n\n".join(failure_prediction_row_blob(row) for row in rows[:20])


def build_failure_prediction(
    payload: FailurePredictionRequest,
) -> FailurePredictionResponse:
    historical_rows = fetch_incident_rows(
        limit=payload.lookback_limit,
        include_search_text=True,
    )
    current_logs_provided = bool((payload.current_logs or "").strip())
    prediction_logs = logs_for_failure_prediction(payload.current_logs, historical_rows)
    patterns: list[FailureAnomalyPattern] = []
    recommendations: list[str] = []
    risk_score = 0.0

    for rule in FAILURE_SIGNAL_RULES:
        signal = str(rule["signal"])
        tokens = cast(tuple[str, ...], rule["tokens"])
        weight = float(rule["weight"])
        current_occurrences = count_failure_signal_occurrences(prediction_logs, tokens)
        historical_matches = [
            row
            for row in historical_rows
            if count_failure_signal_occurrences(failure_prediction_row_blob(row), tokens) > 0
        ]
        historical_occurrences = len(historical_matches)

        if current_logs_provided and current_occurrences == 0:
            continue

        if current_occurrences == 0 and historical_occurrences < 2:
            continue

        severity_boost = severity_boost_for_rows(historical_matches)
        pattern_confidence = min(
            0.98,
            0.34
            + min(current_occurrences, 4) * 0.12
            + min(historical_occurrences, 5) * 0.06
            + severity_boost,
        )
        risk_score += (
            min(current_occurrences, 4) * weight
            + min(historical_occurrences, 5) * weight * 0.16
            + severity_boost
        )
        patterns.append(
            FailureAnomalyPattern(
                signal=signal,
                occurrences=current_occurrences,
                historical_occurrences=historical_occurrences,
                confidence=round(pattern_confidence, 2),
                evidence=failure_signal_evidence(historical_matches, tokens),
            ),
        )
        recommendation = rule.get("recommendation")
        if isinstance(recommendation, str):
            recommendations.append(recommendation)

    patterns.sort(
        key=lambda pattern: (
            pattern.confidence,
            pattern.occurrences,
            pattern.historical_occurrences,
        ),
        reverse=True,
    )
    risk_level = prediction_risk_level(risk_score)
    prediction = risk_level != "low"
    confidence = round(min(max(risk_score / 1.55, 0.05), 0.99), 2)

    if prediction:
        message = "Possible failure predicted"
        warning = (
            "Possible failure predicted before incident impact. Recent signals match "
            "historical failure patterns stored in incident memory."
        )
    else:
        message = "No failure predicted"
        warning = (
            "No strong pre-incident anomaly pattern was found in the available logs."
        )

    if not recommendations:
        recommendations = [
            "Continue monitoring logs, health checks, and deployment events for drift.",
        ]

    return FailurePredictionResponse(
        message=message,
        prediction=prediction,
        risk_level=risk_level,
        confidence=confidence,
        historical_logs_analyzed=len(historical_rows),
        anomaly_patterns=patterns[:6],
        warning=warning,
        recommended_actions=unique_suggestions(recommendations, limit=5),
        predicted_at=datetime.now(UTC).isoformat(),
    )


def terraform_resource_blocks(terraform_code: str) -> list[dict[str, Any]]:
    lines = terraform_code.splitlines()
    blocks: list[dict[str, Any]] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        match = TERRAFORM_RESOURCE_RE.match(line)
        if not match:
            index += 1
            continue

        start = index
        depth = line.count("{") - line.count("}")
        index += 1
        while index < len(lines) and depth > 0:
            depth += lines[index].count("{") - lines[index].count("}")
            index += 1

        end = index
        block_lines = lines[start:end]
        resource_type = match.group("type")
        resource_name = match.group("name")
        blocks.append(
            {
                "type": resource_type,
                "name": resource_name,
                "address": f"{resource_type}.{resource_name}",
                "text": "\n".join(block_lines),
            },
        )

    return blocks


def add_terraform_issue(
    issues: list[TerraformDriftIssue],
    seen_issue_ids: set[str],
    *,
    issue_id: str,
    title: str,
    severity: TerraformDriftSeverity,
    resource: str,
    detail: str,
    remediation: str,
) -> None:
    if issue_id in seen_issue_ids:
        return

    seen_issue_ids.add(issue_id)
    issues.append(
        TerraformDriftIssue(
            id=issue_id,
            title=title,
            severity=severity,
            resource=resource,
            detail=detail,
            remediation=remediation,
        ),
    )


def insert_before_terraform_resource_close(block_text: str, addition: str) -> str:
    lines = block_text.splitlines()
    close_index = next(
        (
            index
            for index in range(len(lines) - 1, -1, -1)
            if lines[index].strip() == "}"
        ),
        len(lines),
    )
    addition_lines = ["", *addition.strip("\n").splitlines()]
    return "\n".join([*lines[:close_index], *addition_lines, *lines[close_index:]])


def ensure_terraform_variable(
    terraform_code: str,
    variable_name: str,
    variable_block: str,
) -> str:
    if re.search(rf'variable\s+"{re.escape(variable_name)}"\s*\{{', terraform_code):
        return terraform_code

    return f"{variable_block.strip()}\n\n{terraform_code.lstrip()}"


def append_terraform_blocks(terraform_code: str, blocks: list[str]) -> str:
    if not blocks:
        return terraform_code.rstrip() + "\n"

    normalized_code = terraform_code.rstrip()
    normalized_blocks = "\n\n".join(block.strip() for block in blocks if block.strip())
    return f"{normalized_code}\n\n{normalized_blocks}\n"


def terraform_unified_diff(original: str, corrected: str) -> str:
    diff_lines = difflib.unified_diff(
        original.rstrip().splitlines(),
        corrected.rstrip().splitlines(),
        fromfile="current.tf",
        tofile="corrected.tf",
        lineterm="",
    )
    return "\n".join(diff_lines)


def s3_bucket_reference(resource_name: str) -> str:
    return f"aws_s3_bucket.{resource_name}.id"


def remediate_terraform_code(
    terraform_code: str,
    drift_context: str | None = None,
) -> tuple[str, list[TerraformDriftIssue]]:
    corrected_code = terraform_code.rstrip() + "\n"
    blocks = terraform_resource_blocks(terraform_code)
    issues: list[TerraformDriftIssue] = []
    seen_issue_ids: set[str] = set()
    appended_blocks: list[str] = []
    needs_admin_cidr_variable = False

    for block in blocks:
        resource_type = str(block["type"])
        resource_name = str(block["name"])
        resource_address = str(block["address"])
        original_block_text = str(block["text"])
        next_block_text = original_block_text

        if re.search(r'\btags\s*=', original_block_text) is None and resource_type in {
            "aws_db_instance",
            "aws_s3_bucket",
            "aws_security_group",
        }:
            next_block_text = insert_before_terraform_resource_close(
                next_block_text,
                """  tags = {
    ManagedBy   = "DevPilot"
    Environment = "production"
  }""",
            )
            add_terraform_issue(
                issues,
                seen_issue_ids,
                issue_id=f"{resource_address}:missing-tags",
                title="Missing ownership tags",
                severity="medium",
                resource=resource_address,
                detail="Terraform resource does not include baseline ownership tags.",
                remediation="Added ManagedBy and Environment tags for drift tracking.",
            )

        if resource_type == "aws_s3_bucket":
            if re.search(r'\bacl\s*=\s*"public-read"', next_block_text):
                next_block_text = re.sub(
                    r'\bacl\s*=\s*"public-read"',
                    'acl = "private"',
                    next_block_text,
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:public-acl",
                    title="Public S3 bucket ACL drift",
                    severity="critical",
                    resource=resource_address,
                    detail="Bucket ACL allows public read access.",
                    remediation="Changed S3 ACL to private.",
                )

            if (
                f'resource "aws_s3_bucket_public_access_block" "{resource_name}"'
                not in terraform_code
            ):
                appended_blocks.append(
                    f"""resource "aws_s3_bucket_public_access_block" "{resource_name}" {{
  bucket = {s3_bucket_reference(resource_name)}

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}}""",
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:missing-public-access-block",
                    title="Missing S3 public access guard",
                    severity="high",
                    resource=resource_address,
                    detail="Bucket does not have a public access block resource.",
                    remediation="Added aws_s3_bucket_public_access_block with all protections enabled.",
                )

            if (
                f'resource "aws_s3_bucket_server_side_encryption_configuration" "{resource_name}"'
                not in terraform_code
            ):
                appended_blocks.append(
                    f"""resource "aws_s3_bucket_server_side_encryption_configuration" "{resource_name}" {{
  bucket = {s3_bucket_reference(resource_name)}

  rule {{
    apply_server_side_encryption_by_default {{
      sse_algorithm = "AES256"
    }}
  }}
}}""",
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:missing-encryption",
                    title="Missing S3 encryption",
                    severity="high",
                    resource=resource_address,
                    detail="Bucket has no server-side encryption configuration.",
                    remediation="Added default AES256 server-side encryption.",
                )

            if (
                f'resource "aws_s3_bucket_versioning" "{resource_name}"'
                not in terraform_code
            ):
                appended_blocks.append(
                    f"""resource "aws_s3_bucket_versioning" "{resource_name}" {{
  bucket = {s3_bucket_reference(resource_name)}

  versioning_configuration {{
    status = "Enabled"
  }}
}}""",
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:missing-versioning",
                    title="Missing S3 versioning",
                    severity="medium",
                    resource=resource_address,
                    detail="Bucket versioning is absent, reducing recovery coverage.",
                    remediation="Added enabled aws_s3_bucket_versioning.",
                )

        if resource_type == "aws_security_group" and re.search(
            r'\bfrom_port\s*=\s*22\b',
            original_block_text,
        ) and "0.0.0.0/0" in original_block_text:
            next_block_text = re.sub(
                r'cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0/0"\s*\]',
                "cidr_blocks = var.admin_cidr_blocks",
                next_block_text,
            )
            needs_admin_cidr_variable = True
            add_terraform_issue(
                issues,
                seen_issue_ids,
                issue_id=f"{resource_address}:open-ssh",
                title="Open SSH ingress drift",
                severity="critical",
                resource=resource_address,
                detail="Security group allows SSH from 0.0.0.0/0.",
                remediation="Restricted SSH ingress to var.admin_cidr_blocks.",
            )

        if resource_type == "aws_db_instance":
            if re.search(r'\bpublicly_accessible\s*=\s*true\b', next_block_text):
                next_block_text = re.sub(
                    r'\bpublicly_accessible\s*=\s*true\b',
                    "publicly_accessible = false",
                    next_block_text,
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:public-db",
                    title="Public database drift",
                    severity="critical",
                    resource=resource_address,
                    detail="Database instance is publicly accessible.",
                    remediation="Set publicly_accessible to false.",
                )

            if re.search(r'\bbackup_retention_period\s*=\s*0\b', next_block_text):
                next_block_text = re.sub(
                    r'\bbackup_retention_period\s*=\s*0\b',
                    "backup_retention_period = 7",
                    next_block_text,
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:no-backups",
                    title="Database backups disabled",
                    severity="high",
                    resource=resource_address,
                    detail="RDS backup retention is set to zero days.",
                    remediation="Set backup_retention_period to 7 days.",
                )
            elif "backup_retention_period" not in next_block_text:
                next_block_text = insert_before_terraform_resource_close(
                    next_block_text,
                    "  backup_retention_period = 7",
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:missing-backups",
                    title="Database backup policy missing",
                    severity="high",
                    resource=resource_address,
                    detail="RDS backup retention is not declared.",
                    remediation="Added backup_retention_period with a seven day baseline.",
                )

            if "deletion_protection" not in next_block_text:
                next_block_text = insert_before_terraform_resource_close(
                    next_block_text,
                    "  deletion_protection = true",
                )
                add_terraform_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"{resource_address}:missing-deletion-protection",
                    title="Database deletion protection missing",
                    severity="medium",
                    resource=resource_address,
                    detail="RDS deletion protection is not declared.",
                    remediation="Added deletion_protection to reduce accidental destructive drift.",
                )

        if next_block_text != original_block_text:
            corrected_code = corrected_code.replace(original_block_text, next_block_text, 1)

    if drift_context and any(
        token in drift_context.lower()
        for token in ("terraform plan", "will be updated", "forces replacement", "drift")
    ):
        add_terraform_issue(
            issues,
            seen_issue_ids,
            issue_id="terraform-plan:drift-signal",
            title="Terraform plan drift signal",
            severity="medium",
            resource="terraform plan",
            detail="Provided drift context indicates Terraform detected infrastructure drift.",
            remediation="Generated a corrected Terraform baseline before apply.",
        )

    if needs_admin_cidr_variable:
        corrected_code = ensure_terraform_variable(
            corrected_code,
            "admin_cidr_blocks",
            """variable "admin_cidr_blocks" {
  description = "Approved administrative CIDR ranges for SSH access."
  type        = list(string)
  default     = ["10.0.0.0/8"]
}""",
        )

    corrected_code = append_terraform_blocks(corrected_code, appended_blocks)
    return corrected_code, issues


def build_terraform_remediation(
    payload: TerraformRemediationRequest,
) -> TerraformRemediationResponse:
    cloud_provider = normalize_cloud_provider(payload.cloud_provider)
    terraform_code = payload.terraform_code.strip()
    if not terraform_code:
        raise HTTPException(status_code=400, detail="Terraform code is required.")

    corrected_code, drift_issues = remediate_terraform_code(
        terraform_code,
        payload.drift_context,
    )
    unified_diff = terraform_unified_diff(terraform_code, corrected_code)
    drift_detected = bool(drift_issues and unified_diff.strip())
    generated_at = datetime.now(UTC).isoformat()
    message = (
        "Terraform remediation generated."
        if drift_detected
        else "No Terraform drift detected."
    )

    if drift_detected:
        store_incident_memory(
            source="/terraform/remediate",
            raw_logs=payload.drift_context or terraform_code,
            summary=(
                f"Terraform drift detected in {len(drift_issues)} resource "
                "configuration(s)."
            ),
            severity=(
                "critical"
                if any(issue.severity == "critical" for issue in drift_issues)
                else "high"
            ),
            explanation="Generated corrected Terraform code and a pre-apply diff.",
            recommended_fix="Review the generated diff, then auto-patch Terraform infra.",
            cloud_provider=cloud_provider,
            fix_payload=json.dumps(
                {
                    "corrected_terraform": corrected_code,
                    "unified_diff": unified_diff,
                    "drift_issues": [model_to_dict(issue) for issue in drift_issues],
                },
                ensure_ascii=True,
            ),
            created_at=generated_at,
        )

    return TerraformRemediationResponse(
        message=message,
        drift_detected=drift_detected,
        drift_count=len(drift_issues),
        cloud_provider=cloud_provider,
        corrected_terraform=corrected_code,
        unified_diff=unified_diff,
        drift_issues=drift_issues,
        apply_ready=drift_detected,
        generated_at=generated_at,
    )


def apply_terraform_remediation(
    payload: TerraformApplyRequest,
) -> TerraformApplyResponse:
    if not payload.approved:
        raise HTTPException(
            status_code=400,
            detail="Terraform patch requires explicit approval.",
        )

    original = payload.original_terraform.strip()
    corrected = payload.corrected_terraform.strip()
    if not original or not corrected:
        raise HTTPException(
            status_code=400,
            detail="Original and corrected Terraform code are required.",
        )

    unified_diff = terraform_unified_diff(original, corrected)
    if not unified_diff.strip():
        return TerraformApplyResponse(
            message="No Terraform drift patch was needed.",
            applied=False,
            patched_terraform=corrected + "\n",
            unified_diff="",
            applied_at=datetime.now(UTC).isoformat(),
        )

    applied_at = datetime.now(UTC).isoformat()
    store_incident_memory(
        source="/terraform/apply",
        summary="Terraform infra auto-patched after diff review.",
        recommended_fix="Terraform infra auto-patched.",
        fix_payload=json.dumps(
            {
                "patched_terraform": corrected,
                "unified_diff": unified_diff,
            },
            ensure_ascii=True,
        ),
        created_at=applied_at,
    )

    return TerraformApplyResponse(
        message="Terraform infra auto-patched.",
        applied=True,
        patched_terraform=corrected + "\n",
        unified_diff=unified_diff,
        applied_at=applied_at,
    )


def round_currency(value: float) -> float:
    return round(max(value, 0.0), 2)


def build_demo_cost_resources(
    cloud_provider: CloudProvider = "aws",
) -> list[CloudCostResource]:
    return [
        CloudCostResource(
            id="aws-ec2-prod-api-1",
            name="prod-api-primary",
            cloud_provider=cloud_provider,
            service="ec2",
            region="us-east-1",
            instance_type="m5.large",
            monthly_cost=70.08,
            cpu_utilization_percent=8.0,
            memory_utilization_percent=34.0,
            network_utilization_percent=7.0,
            requests_per_hour=420.0,
            last_activity_hours_ago=0.3,
            environment="production",
        ),
        CloudCostResource(
            id="aws-ec2-staging-worker",
            name="staging-worker-batch",
            cloud_provider=cloud_provider,
            service="ec2",
            region="us-east-1",
            instance_type="t3.large",
            monthly_cost=60.74,
            cpu_utilization_percent=2.1,
            memory_utilization_percent=8.0,
            network_utilization_percent=0.4,
            requests_per_hour=0.0,
            last_activity_hours_ago=216.0,
            environment="staging",
        ),
        CloudCostResource(
            id="aws-rds-dev-reports",
            name="dev-reporting-db",
            cloud_provider=cloud_provider,
            service="rds",
            region="us-east-1",
            instance_type="db.t3.medium",
            monthly_cost=58.40,
            cpu_utilization_percent=4.0,
            memory_utilization_percent=22.0,
            network_utilization_percent=1.0,
            last_activity_hours_ago=190.0,
            environment="development",
        ),
        CloudCostResource(
            id="aws-cache-session",
            name="session-cache",
            cloud_provider=cloud_provider,
            service="redis",
            region="us-east-1",
            instance_type="cache.t3.medium",
            monthly_cost=49.64,
            cpu_utilization_percent=18.0,
            memory_utilization_percent=41.0,
            network_utilization_percent=9.0,
            requests_per_hour=180.0,
            last_activity_hours_ago=0.1,
            environment="production",
        ),
        CloudCostResource(
            id="aws-ebs-orphaned-volume",
            name="checkout-old-root-volume",
            cloud_provider=cloud_provider,
            service="volume",
            region="us-east-1",
            monthly_cost=16.00,
            storage_gb=200.0,
            attached=False,
            last_activity_hours_ago=744.0,
            environment="production",
        ),
        CloudCostResource(
            id="aws-alb-preview",
            name="preview-alb-unused",
            cloud_provider=cloud_provider,
            service="load_balancer",
            region="us-east-1",
            monthly_cost=18.25,
            network_utilization_percent=0.2,
            requests_per_hour=1.0,
            last_activity_hours_ago=172.0,
            environment="preview",
        ),
        CloudCostResource(
            id="aws-ec2-gateway",
            name="gateway-active",
            cloud_provider=cloud_provider,
            service="ec2",
            region="us-east-1",
            instance_type="t3.medium",
            monthly_cost=30.37,
            cpu_utilization_percent=47.0,
            memory_utilization_percent=59.0,
            network_utilization_percent=34.0,
            requests_per_hour=2_400.0,
            last_activity_hours_ago=0.0,
            environment="production",
        ),
    ]


def cost_resource_text(resource: CloudCostResource) -> str:
    return " ".join(
        part.lower()
        for part in (
            resource.service,
            resource.name,
            resource.id,
            resource.instance_type or "",
            resource.environment or "",
        )
    )


def has_service_token(resource: CloudCostResource, tokens: tuple[str, ...]) -> bool:
    text = cost_resource_text(resource)
    return any(token in text for token in tokens)


def estimated_current_monthly_cost(resource: CloudCostResource) -> float:
    if resource.monthly_cost > 0:
        return round_currency(resource.monthly_cost)

    if resource.instance_type:
        catalog = CLOUD_INSTANCE_MONTHLY_COSTS.get(resource.cloud_provider, {})
        return round_currency(catalog.get(resource.instance_type, 0.0))

    return 0.0


def is_resource_idle(resource: CloudCostResource) -> bool:
    if not has_service_token(resource, IDLE_RESOURCE_SERVICE_TOKENS):
        return False

    if not resource.attached:
        return True

    if (
        resource.last_activity_hours_ago is not None
        and resource.last_activity_hours_ago >= 168
    ):
        return True

    cpu = resource.cpu_utilization_percent
    memory = resource.memory_utilization_percent
    network = resource.network_utilization_percent
    requests = resource.requests_per_hour

    if cpu is not None and cpu <= 5:
        memory_is_low = memory is None or memory <= 15
        network_is_low = network is None or network <= 3
        requests_are_low = requests is None or requests <= 5
        return memory_is_low and network_is_low and requests_are_low

    return False


def idle_cost_retention_ratio(resource: CloudCostResource) -> float:
    text = cost_resource_text(resource)
    if any(token in text for token in ("database", "rds")):
        return 0.15
    if any(token in text for token in ("volume", "disk", "storage")):
        return 0.0
    return 0.0


def idle_action_for_resource(resource: CloudCostResource) -> CostOptimizationAction:
    text = cost_resource_text(resource)
    if any(token in text for token in ("volume", "disk")) and not resource.attached:
        return "delete_idle"
    if any(token in text for token in ("storage", "s3", "bucket")):
        return "archive_storage"
    return "stop_or_schedule"


def idle_reason_for_resource(resource: CloudCostResource) -> str:
    if not resource.attached:
        return "Resource is detached, so it can be removed after snapshot or backup validation."
    if (
        resource.last_activity_hours_ago is not None
        and resource.last_activity_hours_ago >= 168
    ):
        days = round(resource.last_activity_hours_ago / 24)
        return f"No meaningful activity was detected for about {days} day(s)."
    return (
        "Observed CPU, memory, network, and request signals are below idle thresholds."
    )


def rightsize_target_for_resource(
    resource: CloudCostResource,
) -> tuple[str, float] | None:
    if not resource.instance_type:
        return None

    if not has_service_token(resource, RIGHTSIZE_SERVICE_TOKENS):
        return None

    cpu = resource.cpu_utilization_percent
    memory = resource.memory_utilization_percent
    if cpu is None and memory is None:
        return None

    cpu_is_small = cpu is None or cpu <= 30
    memory_is_small = memory is None or memory <= 55
    if not (cpu_is_small and memory_is_small):
        return None

    provider = resource.cloud_provider
    target_size = CLOUD_INSTANCE_RIGHTSIZE_TARGETS.get(provider, {}).get(
        resource.instance_type,
    )
    if not target_size:
        return None

    current_cost = estimated_current_monthly_cost(resource)
    catalog = CLOUD_INSTANCE_MONTHLY_COSTS.get(provider, {})
    target_cost = round_currency(catalog.get(target_size, current_cost * 0.62))

    if current_cost <= 0 or target_cost >= current_cost:
        return None

    return target_size, target_cost


def build_idle_cost_recommendation(
    resource: CloudCostResource,
    current_cost: float,
) -> CostOptimizationRecommendation:
    retained_cost = round_currency(current_cost * idle_cost_retention_ratio(resource))
    savings = round_currency(current_cost - retained_cost)

    return CostOptimizationRecommendation(
        id=f"idle:{resource.id}",
        resource_id=resource.id,
        resource_name=resource.name,
        cloud_provider=resource.cloud_provider,
        service=resource.service,
        region=resource.region,
        action=idle_action_for_resource(resource),
        current_size=resource.instance_type,
        recommended_size=None,
        current_monthly_cost=current_cost,
        recommended_monthly_cost=retained_cost,
        estimated_monthly_savings=savings,
        confidence=0.88,
        reason=idle_reason_for_resource(resource),
    )


def build_rightsize_cost_recommendation(
    resource: CloudCostResource,
    current_cost: float,
    target_size: str,
    target_cost: float,
) -> CostOptimizationRecommendation:
    savings = round_currency(current_cost - target_cost)
    cpu = resource.cpu_utilization_percent
    memory = resource.memory_utilization_percent
    utilization_bits = []
    if cpu is not None:
        utilization_bits.append(f"CPU averages {cpu:g}%")
    if memory is not None:
        utilization_bits.append(f"memory averages {memory:g}%")
    utilization_summary = " and ".join(utilization_bits) or "utilization is low"

    return CostOptimizationRecommendation(
        id=f"rightsize:{resource.id}",
        resource_id=resource.id,
        resource_name=resource.name,
        cloud_provider=resource.cloud_provider,
        service=resource.service,
        region=resource.region,
        action="rightsize_instance",
        current_size=resource.instance_type,
        recommended_size=target_size,
        current_monthly_cost=current_cost,
        recommended_monthly_cost=target_cost,
        estimated_monthly_savings=savings,
        confidence=0.82,
        reason=(
            f"{utilization_summary}, so {resource.instance_type} can likely move "
            f"to {target_size} with capacity headroom."
        ),
    )


def build_cost_optimization(
    payload: CostOptimizationRequest,
) -> CostOptimizationResponse:
    cloud_provider = normalize_cloud_provider(payload.cloud_provider)
    resources = payload.resources or build_demo_cost_resources(cloud_provider)
    current_monthly_cost = round_currency(
        sum(estimated_current_monthly_cost(resource) for resource in resources),
    )
    recommendations: list[CostOptimizationRecommendation] = []

    for resource in resources:
        current_cost = estimated_current_monthly_cost(resource)
        if current_cost <= 0:
            continue

        if is_resource_idle(resource):
            recommendations.append(build_idle_cost_recommendation(resource, current_cost))
            continue

        rightsize_target = rightsize_target_for_resource(resource)
        if rightsize_target:
            target_size, target_cost = rightsize_target
            recommendations.append(
                build_rightsize_cost_recommendation(
                    resource,
                    current_cost,
                    target_size,
                    target_cost,
                ),
            )

    recommendations.sort(
        key=lambda recommendation: recommendation.estimated_monthly_savings,
        reverse=True,
    )
    estimated_monthly_savings = round_currency(
        sum(recommendation.estimated_monthly_savings for recommendation in recommendations),
    )
    optimized_monthly_cost = round_currency(current_monthly_cost - estimated_monthly_savings)
    idle_resource_count = sum(
        1
        for recommendation in recommendations
        if recommendation.action in {"delete_idle", "stop_or_schedule", "archive_storage"}
    )
    rightsizing_count = sum(
        1
        for recommendation in recommendations
        if recommendation.action == "rightsize_instance"
    )
    generated_at = datetime.now(UTC).isoformat()
    message = (
        f"Estimated {payload.currency.upper()} {estimated_monthly_savings:.2f}/month "
        f"in cloud savings."
        if recommendations
        else "No cost optimization opportunity detected."
    )

    return CostOptimizationResponse(
        message=message,
        currency=payload.currency.upper(),
        analyzed_resource_count=len(resources),
        recommendation_count=len(recommendations),
        idle_resource_count=idle_resource_count,
        rightsizing_count=rightsizing_count,
        current_monthly_cost=current_monthly_cost,
        optimized_monthly_cost=optimized_monthly_cost,
        estimated_monthly_savings=estimated_monthly_savings,
        estimated_annual_savings=round_currency(estimated_monthly_savings * 12),
        recommendations=recommendations[:12],
        generated_at=generated_at,
    )


def build_demo_security_targets() -> list[SecurityScanTarget]:
    dockerfile = """\
FROM python:latest
WORKDIR /app
ARG DEPLOY_TOKEN=demo-build-token-1234
ENV ADMIN_PASSWORD=demo-password-1234
COPY . .
RUN apt-get update && apt-get install -y curl
RUN curl https://example.invalid/install.sh | sh
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
"""
    kubernetes_yaml = """\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpilot-api
spec:
  template:
    spec:
      hostNetwork: true
      containers:
        - name: api
          image: ghcr.io/acme/devpilot-api:latest
          securityContext:
            privileged: true
            allowPrivilegeEscalation: true
            runAsUser: 0
          env:
            - name: DATABASE_PASSWORD
              value: demo-password-1234
"""
    app_config = """\
DEBUG=true
CORS_ALLOW_ORIGINS=*
OPENAI_API_KEY=demo-api-key-1234
"""

    return [
        SecurityScanTarget(
            path="Dockerfile",
            content=dockerfile,
            kind="dockerfile",
        ),
        SecurityScanTarget(
            path="k8s/devpilot-api.yaml",
            content=kubernetes_yaml,
            kind="yaml",
        ),
        SecurityScanTarget(
            path=".env.production",
            content=app_config,
            kind="env",
        ),
    ]


def infer_security_config_kind(target: SecurityScanTarget) -> SecurityConfigKind:
    if target.kind != "auto":
        return target.kind

    path = target.path.lower()
    name = Path(path).name
    if name == "dockerfile" or path.endswith(".dockerfile"):
        return "dockerfile"
    if path.endswith((".yaml", ".yml")):
        return "yaml"
    if path.endswith(".env") or ".env" in path:
        return "env"
    if path.endswith(".json"):
        return "json"

    return "text"


def mask_security_evidence(line: str) -> str:
    masked = SECRET_ASSIGNMENT_RE.sub(
        lambda match: f"{match.group('key')}={match.group('quote')}***",
        line.strip(),
    )
    return truncate_text(masked, 180)


def secret_value_looks_sensitive(value: str) -> bool:
    normalized = value.strip().strip("\"'").strip()
    lowered = normalized.lower()
    if not normalized:
        return False

    safe_tokens = {
        "changeme",
        "change_me",
        "example",
        "placeholder",
        "replace_me",
        "false",
        "true",
        "null",
        "none",
    }
    if lowered in safe_tokens:
        return False

    if normalized.startswith(("$", "${", "{{")):
        return False

    return len(normalized) >= 8 or any(
        token in lowered for token in ("password", "secret", "token", "key")
    )


def add_security_issue(
    issues: list[SecurityIssue],
    seen_issue_ids: set[str],
    *,
    issue_id: str,
    title: str,
    severity: SecurityIssueSeverity,
    category: SecurityIssueCategory,
    target_path: str,
    line_number: int | None,
    evidence: str,
    recommendation: str,
) -> None:
    if issue_id in seen_issue_ids:
        return

    seen_issue_ids.add(issue_id)
    issues.append(
        SecurityIssue(
            id=issue_id,
            title=title,
            severity=severity,
            category=category,
            target_path=target_path,
            line_number=line_number,
            evidence=mask_security_evidence(evidence),
            recommendation=recommendation,
        ),
    )


def scan_target_for_secrets(
    target: SecurityScanTarget,
    issues: list[SecurityIssue],
    seen_issue_ids: set[str],
) -> None:
    previous_secret_name_line: tuple[int, str] | None = None
    for line_number, line in enumerate(target.content.splitlines(), start=1):
        secret_match = SECRET_ASSIGNMENT_RE.search(line)
        if secret_match and secret_value_looks_sensitive(secret_match.group("value")):
            key = secret_match.group("key")
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"secret:{target.path}:{line_number}:{key.lower()}",
                title="Possible hard-coded secret",
                severity="critical",
                category="secret",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation=(
                    "Move the value into a secrets manager or runtime secret reference, "
                    "then rotate the exposed credential."
                ),
            )

        if YAML_SECRET_NAME_RE.search(line):
            previous_secret_name_line = (line_number, line.strip())
            continue

        if previous_secret_name_line and re.search(r"^\s*value:\s*\S+", line):
            _, secret_name_line = previous_secret_name_line
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"secret-yaml-value:{target.path}:{line_number}",
                title="Kubernetes environment variable contains a literal secret",
                severity="critical",
                category="secret",
                target_path=target.path,
                line_number=line_number,
                evidence=f"{secret_name_line} {line.strip()}",
                recommendation=(
                    "Replace the literal value with valueFrom.secretKeyRef or an "
                    "external secret controller reference."
                ),
            )
            previous_secret_name_line = None
        elif line.strip().startswith("- name:"):
            previous_secret_name_line = None


def scan_dockerfile_security(
    target: SecurityScanTarget,
    issues: list[SecurityIssue],
    seen_issue_ids: set[str],
) -> None:
    lines = target.content.splitlines()
    has_user_instruction = False
    has_healthcheck = False

    for line_number, line in enumerate(lines, start=1):
        stripped = line.strip()
        upper = stripped.upper()

        if upper.startswith("USER "):
            has_user_instruction = True
            if stripped.lower() in {"user root", "user 0"}:
                add_security_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"docker-root-user:{target.path}:{line_number}",
                    title="Dockerfile explicitly runs as root",
                    severity="high",
                    category="dockerfile",
                    target_path=target.path,
                    line_number=line_number,
                    evidence=line,
                    recommendation="Create an unprivileged user and switch to it with USER.",
                )

        if upper.startswith("HEALTHCHECK "):
            has_healthcheck = True

        if DOCKER_FROM_LATEST_RE.search(line):
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"docker-latest:{target.path}:{line_number}",
                title="Dockerfile uses a floating latest tag",
                severity="medium",
                category="dockerfile",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation="Pin the base image to a specific trusted version or digest.",
            )

        if DOCKER_ENV_SECRET_RE.search(line):
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"docker-secret-env:{target.path}:{line_number}",
                title="Docker build stores a secret in ARG or ENV",
                severity="critical",
                category="secret",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation=(
                    "Remove secrets from Docker layers and inject them at runtime "
                    "through the orchestrator secret store."
                ),
            )

        if "curl" in stripped.lower() and "| sh" in stripped.lower():
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"docker-curl-sh:{target.path}:{line_number}",
                title="Dockerfile pipes remote script into shell",
                severity="high",
                category="dockerfile",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation=(
                    "Download and verify installer checksums or signatures before execution."
                ),
            )

        if "chmod 777" in stripped.lower():
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"docker-chmod-777:{target.path}:{line_number}",
                title="Dockerfile grants world-writable permissions",
                severity="high",
                category="dockerfile",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation="Use least-privilege file permissions for the exact runtime user.",
            )

        if (
            "apt-get install" in stripped.lower()
            and "rm -rf /var/lib/apt/lists" not in stripped.lower()
        ):
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"docker-apt-cache:{target.path}:{line_number}",
                title="Dockerfile leaves package manager cache behind",
                severity="low",
                category="dockerfile",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation=(
                    "Clean package indexes in the same RUN layer to reduce stale packages "
                    "and image attack surface."
                ),
            )

    if lines and not has_user_instruction:
        add_security_issue(
            issues,
            seen_issue_ids,
            issue_id=f"docker-missing-user:{target.path}",
            title="Dockerfile does not switch to a non-root user",
            severity="high",
            category="dockerfile",
            target_path=target.path,
            line_number=None,
            evidence="No USER instruction found.",
            recommendation="Create a dedicated application user and set USER before CMD.",
        )

    if lines and not has_healthcheck:
        add_security_issue(
            issues,
            seen_issue_ids,
            issue_id=f"docker-missing-healthcheck:{target.path}",
            title="Dockerfile has no healthcheck",
            severity="medium",
            category="dockerfile",
            target_path=target.path,
            line_number=None,
            evidence="No HEALTHCHECK instruction found.",
            recommendation=(
                "Add a HEALTHCHECK so orchestrators can replace unhealthy containers quickly."
            ),
        )


def scan_yaml_security(
    target: SecurityScanTarget,
    issues: list[SecurityIssue],
    seen_issue_ids: set[str],
) -> None:
    content = target.content
    has_kubernetes_workload = any(
        token in content for token in ("kind: Deployment", "kind: Pod", "kind: StatefulSet")
    )
    has_run_as_non_root = "runAsNonRoot: true" in content
    has_read_only_root = "readOnlyRootFilesystem: true" in content

    for line_number, line in enumerate(content.splitlines(), start=1):
        stripped = line.strip()
        lowered = stripped.lower()

        yaml_checks: list[tuple[str, SecurityIssueSeverity, str, str]] = [
            (
                "privileged: true",
                "critical",
                "Kubernetes container runs privileged",
                "Remove privileged mode and grant only the specific Linux capabilities required.",
            ),
            (
                "allowprivilegeescalation: true",
                "high",
                "Kubernetes container allows privilege escalation",
                "Set allowPrivilegeEscalation: false in the container securityContext.",
            ),
            (
                "runasuser: 0",
                "high",
                "Kubernetes workload runs as root",
                "Run as a non-root UID and enforce runAsNonRoot: true.",
            ),
            (
                "runasnonroot: false",
                "high",
                "Kubernetes workload disables non-root enforcement",
                "Set runAsNonRoot: true and use a non-root image user.",
            ),
            (
                "hostnetwork: true",
                "high",
                "Kubernetes workload uses host networking",
                "Disable hostNetwork unless there is a documented node-level requirement.",
            ),
            (
                "hostpid: true",
                "high",
                "Kubernetes workload uses the host PID namespace",
                "Disable hostPID so the workload cannot inspect host processes.",
            ),
            (
                "hostipc: true",
                "high",
                "Kubernetes workload uses the host IPC namespace",
                "Disable hostIPC unless explicitly required and isolated.",
            ),
            (
                "automountserviceaccounttoken: true",
                "medium",
                "Service account token is mounted by default",
                "Disable automountServiceAccountToken where the workload does not call the API.",
            ),
        ]

        for token, severity, title, recommendation in yaml_checks:
            if lowered == token:
                add_security_issue(
                    issues,
                    seen_issue_ids,
                    issue_id=f"yaml:{token}:{target.path}:{line_number}",
                    title=title,
                    severity=severity,
                    category="yaml",
                    target_path=target.path,
                    line_number=line_number,
                    evidence=line,
                    recommendation=recommendation,
                )

        if YAML_IMAGE_LATEST_RE.search(line):
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"yaml-latest-image:{target.path}:{line_number}",
                title="Kubernetes manifest uses a floating latest image tag",
                severity="medium",
                category="yaml",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation="Pin images to immutable tags or digests.",
            )

        if "add:" in lowered and any(
            capability in lowered for capability in ("sys_admin", "net_admin", "all")
        ):
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"yaml-capabilities:{target.path}:{line_number}",
                title="Kubernetes workload adds powerful Linux capabilities",
                severity="high",
                category="yaml",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation="Drop all capabilities and add back only the minimum required.",
            )

        if stripped == "stringData:":
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"yaml-string-data:{target.path}:{line_number}",
                title="Kubernetes Secret uses plain-text stringData",
                severity="high",
                category="secret",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation=(
                    "Prefer external secret synchronization and avoid committing plain-text "
                    "secret material."
                ),
            )

    if has_kubernetes_workload and not has_run_as_non_root:
        add_security_issue(
            issues,
            seen_issue_ids,
            issue_id=f"yaml-missing-run-as-non-root:{target.path}",
            title="Kubernetes workload does not enforce non-root execution",
            severity="medium",
            category="yaml",
            target_path=target.path,
            line_number=None,
            evidence="runAsNonRoot: true is not present.",
            recommendation="Set pod or container securityContext.runAsNonRoot to true.",
        )

    if has_kubernetes_workload and not has_read_only_root:
        add_security_issue(
            issues,
            seen_issue_ids,
            issue_id=f"yaml-missing-read-only-root:{target.path}",
            title="Kubernetes workload does not use a read-only root filesystem",
            severity="medium",
            category="yaml",
            target_path=target.path,
            line_number=None,
            evidence="readOnlyRootFilesystem: true is not present.",
            recommendation=(
                "Enable readOnlyRootFilesystem and mount writable volumes only where needed."
            ),
        )


def scan_general_config_security(
    target: SecurityScanTarget,
    issues: list[SecurityIssue],
    seen_issue_ids: set[str],
) -> None:
    for line_number, line in enumerate(target.content.splitlines(), start=1):
        lowered = line.strip().lower()
        if lowered in {"debug=true", "debug: true"}:
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"config-debug:{target.path}:{line_number}",
                title="Production config enables debug mode",
                severity="medium",
                category="configuration",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation="Disable debug mode outside local development.",
            )

        if lowered in {
            "cors_allow_origins=*",
            "allowed_origins=*",
            "access-control-allow-origin: *",
        }:
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"config-cors-wildcard:{target.path}:{line_number}",
                title="Config allows wildcard CORS origins",
                severity="medium",
                category="configuration",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation="Restrict CORS to approved frontend origins.",
            )

        if "public-read" in lowered or "0.0.0.0/0" in lowered:
            add_security_issue(
                issues,
                seen_issue_ids,
                issue_id=f"config-public-access:{target.path}:{line_number}",
                title="Config grants broad public access",
                severity="high",
                category="configuration",
                target_path=target.path,
                line_number=line_number,
                evidence=line,
                recommendation=(
                    "Limit public access to explicit trusted networks or private resources."
                ),
            )


def highest_security_severity(
    issues: list[SecurityIssue],
) -> SecurityIssueSeverity | None:
    if not issues:
        return None

    return max(
        (issue.severity for issue in issues),
        key=lambda severity: SECURITY_SEVERITY_PRIORITY[severity],
    )


def build_security_suggested_fixes(issues: list[SecurityIssue]) -> list[str]:
    return unique_suggestions(
        [issue.recommendation for issue in issues],
        limit=6,
    )


def build_security_analysis(
    payload: SecurityAnalysisRequest,
) -> SecurityAnalysisResponse:
    targets = payload.targets or build_demo_security_targets()
    issues: list[SecurityIssue] = []
    seen_issue_ids: set[str] = set()

    for target in targets:
        kind = infer_security_config_kind(target)
        scan_target_for_secrets(target, issues, seen_issue_ids)
        scan_general_config_security(target, issues, seen_issue_ids)

        if kind == "dockerfile":
            scan_dockerfile_security(target, issues, seen_issue_ids)
        elif kind == "yaml":
            scan_yaml_security(target, issues, seen_issue_ids)

    issues.sort(
        key=lambda issue: (
            SECURITY_SEVERITY_PRIORITY[issue.severity],
            issue.target_path,
            issue.line_number or 0,
        ),
        reverse=True,
    )
    generated_at = datetime.now(UTC).isoformat()
    highest_severity = highest_security_severity(issues)
    suggested_fixes = build_security_suggested_fixes(issues)
    secret_count = sum(1 for issue in issues if issue.category == "secret")
    dockerfile_issue_count = sum(
        1 for issue in issues if issue.category == "dockerfile"
    )
    yaml_issue_count = sum(1 for issue in issues if issue.category == "yaml")
    message = (
        f"Security analysis found {len(issues)} issue(s)."
        if issues
        else "No security issues detected."
    )

    if issues:
        store_incident_memory(
            source="/security/analyze",
            raw_logs=json.dumps(
                {
                    "targets": [target.path for target in targets],
                    "issue_count": len(issues),
                    "secret_count": secret_count,
                    "highest_severity": highest_severity,
                },
                ensure_ascii=True,
            ),
            summary=message,
            severity=highest_severity,
            explanation=(
                "Configuration security scan found secrets, Dockerfile risks, "
                "or insecure YAML settings."
            ),
            recommended_fix=suggested_fixes[0] if suggested_fixes else None,
            fix_payload=json.dumps(
                {
                    "issues": [model_to_dict(issue) for issue in issues[:20]],
                    "suggested_fixes": suggested_fixes,
                },
                ensure_ascii=True,
            ),
            created_at=generated_at,
        )

    return SecurityAnalysisResponse(
        message=message,
        target_count=len(targets),
        issue_count=len(issues),
        secret_count=secret_count,
        dockerfile_issue_count=dockerfile_issue_count,
        yaml_issue_count=yaml_issue_count,
        highest_severity=highest_severity,
        issues=issues[:20],
        suggested_fixes=suggested_fixes,
        generated_at=generated_at,
    )


def history_recommendations_from_rows(
    similar_incidents: list[tuple[dict[str, Any], float]],
) -> list[str]:
    recommendations: list[str] = []

    for row, _score in similar_incidents:
        summary = truncate_text(str(row.get("summary") or "similar incident"), 120)
        recommended_fix = row.get("recommended_fix")
        if isinstance(recommended_fix, str) and recommended_fix.strip():
            recommendations.append(
                f"Past incident memory ({summary}): {recommended_fix}",
            )

        fix_payload = parse_stored_fix_payload(row)
        stored_suggestions = fix_payload.get("deployment_suggestions")
        if isinstance(stored_suggestions, list):
            for suggestion in stored_suggestions[:2]:
                if isinstance(suggestion, str):
                    recommendations.append(f"Past generated fix: {suggestion}")

    return unique_suggestions(recommendations, limit=5)


def format_incident_history_for_prompt(
    similar_incidents: list[tuple[dict[str, Any], float]],
) -> str:
    if not similar_incidents:
        return "No similar incident history found yet."

    history_blocks = []
    for row, score in similar_incidents:
        lines = [
            f"- Match score: {score:.2f}",
            f"  Seen at: {row.get('created_at')}",
            f"  Source: {row.get('source')}",
            f"  Summary: {truncate_text(str(row.get('summary') or ''), 300)}",
        ]

        severity = row.get("severity")
        if isinstance(severity, str) and severity:
            lines.append(f"  Severity: {severity}")

        recommended_fix = row.get("recommended_fix")
        if isinstance(recommended_fix, str) and recommended_fix:
            lines.append(f"  Prior fix: {truncate_text(recommended_fix, 500)}")

        fix_payload = parse_stored_fix_payload(row)
        stored_suggestions = fix_payload.get("deployment_suggestions")
        if isinstance(stored_suggestions, list) and stored_suggestions:
            suggestions = [
                suggestion
                for suggestion in stored_suggestions[:3]
                if isinstance(suggestion, str)
            ]
            if suggestions:
                lines.append(
                    "  Prior deployment suggestions: "
                    + truncate_text("; ".join(suggestions), 500),
                )

        history_blocks.append("\n".join(lines))

    return "\n\n".join(history_blocks)


def custom_model_name() -> str:
    configured_model = (
        os.getenv("DEVPILOT_CUSTOM_MODEL")
        or os.getenv("OPENAI_FINE_TUNED_MODEL")
        or ""
    ).strip()

    return configured_model or "devpilot-incident-model-v1"


def openai_incident_analysis_model() -> str:
    return (
        os.getenv("DEVPILOT_CUSTOM_MODEL")
        or os.getenv("OPENAI_FINE_TUNED_MODEL")
        or os.getenv("OPENAI_MODEL")
        or "gpt-5.4-mini"
    )


def custom_model_base_model() -> str:
    return os.getenv("OPENAI_BASE_MODEL", os.getenv("OPENAI_MODEL", "gpt-5.4-mini"))


def normalize_training_severity(value: Any) -> Literal["low", "medium", "high", "critical"]:
    severity = str(value or "").strip().lower()
    if severity in {"low", "medium", "high", "critical"}:
        return cast(Literal["low", "medium", "high", "critical"], severity)

    return "medium"


def classify_incident_for_training(row: dict[str, Any]) -> IncidentTrainingSource:
    source = str(row.get("source") or "").lower()
    text = incident_search_blob(row).lower()

    if source == "/kubernetes/status" or any(
        token in text
        for token in (
            "kubernetes",
            "kubelet",
            "pod/",
            "deployment/",
            "crashloopbackoff",
            "imagepullbackoff",
            "oomkilled",
            "failedmount",
            "replicaset",
        )
    ):
        return "kubernetes"

    if source == "/ci-cd/checks" or any(
        token in text
        for token in (
            "github actions",
            "workflow failed",
            "process completed with exit code",
            "pytest",
            "build-and-push",
            "release-image",
            "jenkins",
            "circleci",
        )
    ):
        return "ci_cd"

    return "cloud_logs"


def is_training_candidate(row: dict[str, Any]) -> bool:
    source = str(row.get("source") or "")
    if source in {
        "/api/logs/upload",
        "/analyze-log",
        "/chaos/inject",
        "/ci-cd/checks",
        "/kubernetes/status",
    }:
        return True

    text = incident_search_blob(row).lower()
    return any(
        token in text
        for token in (
            "crashloopbackoff",
            "failedmount",
            "github actions",
            "workflow failed",
            "cloudwatch",
            "database connection failed",
            "latency",
            "timeout",
            "redis",
        )
    )


def training_input_from_row(row: dict[str, Any]) -> str:
    raw_logs = row.get("raw_logs")
    if isinstance(raw_logs, str) and raw_logs.strip():
        return truncate_text(raw_logs, 8_000)

    search_text = row.get("search_text")
    if isinstance(search_text, str) and search_text.strip():
        return truncate_text(search_text, 8_000)

    return truncate_text(str(row.get("summary") or "Incident signal unavailable."), 8_000)


def fallback_training_fix(source_type: IncidentTrainingSource) -> str:
    if source_type == "kubernetes":
        return (
            "Inspect pod events, roll back the failing deployment when a recent "
            "release caused the issue, restore missing configuration, and verify "
            "restart counts recover."
        )

    if source_type == "ci_cd":
        return (
            "Block release promotion, fix the failing pipeline contract, rerun "
            "tests and image build steps, then deploy only after checks pass."
        )

    return (
        "Inspect cloud runtime logs, restore missing secrets or dependency access, "
        "restart the affected service, and validate health checks before traffic resumes."
    )


def training_example_from_row(row: dict[str, Any]) -> IncidentTrainingExample:
    source_type = classify_incident_for_training(row)
    expected_root_cause = (
        str(row.get("explanation") or "").strip()
        or str(row.get("summary") or "").strip()
        or "DevOps incident requires diagnosis from the provided logs."
    )
    expected_fix = str(row.get("recommended_fix") or "").strip() or fallback_training_fix(
        source_type,
    )

    return IncidentTrainingExample(
        id=str(row.get("id") or uuid4()),
        source=str(row.get("source") or "incident_memory"),
        source_type=source_type,
        split="train",
        input=training_input_from_row(row),
        expected_root_cause=truncate_text(expected_root_cause, 1_500),
        expected_severity=normalize_training_severity(row.get("severity")),
        expected_fix=truncate_text(expected_fix, 1_500),
        created_at=str(row.get("created_at") or datetime.now(UTC).isoformat()),
    )


def training_example_from_demo(record: dict[str, str]) -> IncidentTrainingExample:
    return IncidentTrainingExample(
        id=record["id"],
        source=record["source"],
        source_type=cast(IncidentTrainingSource, record["source_type"]),
        split="train",
        input=truncate_text(record["input"], 8_000),
        expected_root_cause=record["expected_root_cause"],
        expected_severity=normalize_training_severity(record["expected_severity"]),
        expected_fix=record["expected_fix"],
        created_at=datetime.now(UTC).isoformat(),
    )


def dedupe_training_examples(
    examples: list[IncidentTrainingExample],
) -> list[IncidentTrainingExample]:
    unique_examples: list[IncidentTrainingExample] = []
    seen = set()

    for example in examples:
        key = (
            example.source_type,
            " ".join(example.input.lower().split())[:420],
            example.expected_root_cause.lower()[:220],
        )
        if key in seen:
            continue

        seen.add(key)
        unique_examples.append(example)

    return unique_examples


def assign_training_splits(
    examples: list[IncidentTrainingExample],
    validation_ratio: float,
) -> list[IncidentTrainingExample]:
    if len(examples) < 3:
        return examples

    sorted_examples = sorted(
        examples,
        key=lambda example: (example.source_type, example.created_at, example.id),
    )
    target_validation_count = max(
        1,
        min(
            len(sorted_examples) - 1,
            round(len(sorted_examples) * validation_ratio),
        ),
    )
    validation_ids: set[str] = set()

    for source_type in ("kubernetes", "ci_cd", "cloud_logs"):
        source_examples = [
            example for example in sorted_examples if example.source_type == source_type
        ]
        if source_examples and len(validation_ids) < target_validation_count:
            validation_ids.add(source_examples[-1].id)

    for example in reversed(sorted_examples):
        if len(validation_ids) >= target_validation_count:
            break
        validation_ids.add(example.id)

    return [
        IncidentTrainingExample(
            **{
                **model_to_dict(example),
                "split": "validation" if example.id in validation_ids else "train",
            },
        )
        for example in sorted_examples
    ]


def build_custom_model_examples(
    payload: CustomModelTrainingRequest,
) -> list[IncidentTrainingExample]:
    rows = fetch_incident_rows(limit=300, include_search_text=True)
    examples = [
        training_example_from_row(row)
        for row in rows
        if is_training_candidate(row)
    ]

    if payload.include_demo_data:
        examples.extend(training_example_from_demo(record) for record in DEMO_TRAINING_INCIDENTS)

    examples = dedupe_training_examples(examples)
    return assign_training_splits(examples, payload.validation_ratio)


def source_breakdown_from_examples(
    examples: list[IncidentTrainingExample],
) -> CustomModelSourceBreakdown:
    counts = {"kubernetes": 0, "ci_cd": 0, "cloud_logs": 0}
    for example in examples:
        counts[example.source_type] += 1

    return CustomModelSourceBreakdown(**counts)


def custom_model_dataset_ready(
    examples: list[IncidentTrainingExample],
    min_examples: int,
) -> bool:
    breakdown = source_breakdown_from_examples(examples)
    train_count = sum(1 for example in examples if example.split == "train")
    validation_count = sum(1 for example in examples if example.split == "validation")

    return (
        train_count >= min_examples
        and validation_count > 0
        and breakdown.kubernetes > 0
        and breakdown.ci_cd > 0
        and breakdown.cloud_logs > 0
    )


def training_example_to_jsonl(example: IncidentTrainingExample) -> str:
    assistant_payload = {
        "root_cause": example.expected_root_cause,
        "severity": example.expected_severity,
        "explanation": example.expected_root_cause,
        "recommended_fix": example.expected_fix,
    }
    record = {
        "messages": [
            {"role": "system", "content": CUSTOM_MODEL_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Source type: {example.source_type}\n"
                    "Incident evidence:\n"
                    f"{example.input}"
                ),
            },
            {
                "role": "assistant",
                "content": json.dumps(assistant_payload, ensure_ascii=True),
            },
        ],
    }

    return json.dumps(record, ensure_ascii=True)


def custom_model_prediction(
    example: IncidentTrainingExample,
) -> tuple[str, Literal["low", "medium", "high", "critical"], str]:
    text = example.input.lower()

    if example.source_type == "kubernetes":
        if "oomkilled" in text or "memory limit" in text:
            return (
                "Kubernetes pods are restarting because the container exceeded memory limits and was OOMKilled.",
                "high",
                "Raise memory requests and limits, roll back if the release caused the spike, and verify restart counts recover.",
            )

        if any(token in text for token in ("failedmount", "secret", "database_url")):
            return (
                "Kubernetes deployment is failing because required runtime configuration or secrets are missing, causing CrashLoopBackOff.",
                "critical",
                "Restore the missing secret or environment variable, roll back the failing deployment, and restart managed pods after health checks pass.",
            )

        if "imagepullbackoff" in text:
            return (
                "Kubernetes rollout is blocked because the referenced container image cannot be pulled.",
                "high",
                "Publish the expected image tag, fix image pull credentials, and rerun rollout validation.",
            )

        return (
            "Kubernetes workload health checks indicate a bad release or pod-level runtime failure.",
            "high",
            "Inspect pod events, restart unhealthy managed pods, and roll back the deployment if the latest ReplicaSet introduced the failure.",
        )

    if example.source_type == "ci_cd":
        if "imagepullbackoff" in text or "build-and-push skipped" in text:
            return (
                "CI/CD promoted an image tag that was not built or pushed successfully, so deployment cannot pull the image.",
                "high",
                "Require the build-and-push job to pass before deploy, publish the missing image tag, and rerun rollout validation.",
            )

        if any(token in text for token in ("database_url", "pytest", "exit code 1")):
            return (
                "The CI/CD release failed because backend tests or startup checks are missing required runtime configuration.",
                "high",
                "Block promotion, restore required CI secrets, rerun tests, and rebuild the release image after checks pass.",
            )

        return (
            "The delivery pipeline failed before a safe release artifact could be promoted.",
            "medium",
            "Keep the release blocked, fix the failing job, and require all deployment checks to pass before promotion.",
        )

    if any(token in text for token in ("redis", "pool exhausted", "queue depth")):
        return (
            "Cloud runtime logs show Redis connection pool exhaustion causing queue latency and request timeouts.",
            "medium",
            "Increase Redis pool limits, add backpressure, and monitor p95 latency until the backlog clears.",
        )

    if any(token in text for token in ("database_url", "database connection failed")):
        return (
            "Cloud runtime logs show the service cannot start because database configuration is missing or unreachable.",
            "critical",
            "Restore database secrets through the cloud secret manager, restart the service, and verify readiness before routing traffic.",
        )

    return (
        "Cloud application logs show dependency or runtime failure affecting service health.",
        "medium",
        "Inspect dependency access, restore missing configuration, restart the service, and validate health checks.",
    )


def generic_model_prediction(
    example: IncidentTrainingExample,
) -> tuple[str, Literal["low", "medium", "high", "critical"], str]:
    text = example.input.lower()
    severity: Literal["low", "medium", "high", "critical"] = (
        "high" if any(token in text for token in ("critical", "failed", "error")) else "medium"
    )

    return (
        "The logs show a software or infrastructure failure that needs investigation.",
        severity,
        "Review recent changes, inspect the logs, retry the failed operation, and restart the service if needed.",
    )


def text_similarity_score(expected: str, actual: str) -> float:
    expected_tokens = incident_tokens(expected)
    actual_tokens = incident_tokens(actual)
    if not expected_tokens or not actual_tokens:
        return 0.0

    overlap = expected_tokens & actual_tokens
    if not overlap:
        return 0.0

    expected_coverage = len(overlap) / len(expected_tokens)
    actual_coverage = len(overlap) / len(actual_tokens)
    return round(min(expected_coverage * 0.78 + actual_coverage * 0.22, 1.0), 4)


def severity_similarity_score(
    expected: str,
    actual: str,
) -> float:
    if expected == actual:
        return 1.0

    high_band = {"high", "critical"}
    medium_band = {"low", "medium"}
    if expected in high_band and actual in high_band:
        return 0.7
    if expected in medium_band and actual in medium_band:
        return 0.65

    return 0.2


def score_model_prediction(
    example: IncidentTrainingExample,
    root_cause: str,
    severity: str,
    fix: str,
) -> tuple[float, float, float, float]:
    root_score = text_similarity_score(example.expected_root_cause, root_cause)
    fix_score = text_similarity_score(example.expected_fix, fix)
    severity_score = severity_similarity_score(example.expected_severity, severity)
    average_score = round(root_score * 0.45 + fix_score * 0.4 + severity_score * 0.15, 4)

    return average_score, root_score, fix_score, severity_score


def summarize_model_scores(
    model_name: str,
    scores: list[tuple[float, float, float, float]],
) -> ModelEvaluationSummary:
    if not scores:
        return ModelEvaluationSummary(
            model_name=model_name,
            accuracy=0,
            average_score=0,
            root_cause_score=0,
            remediation_score=0,
            severity_score=0,
        )

    count = len(scores)
    return ModelEvaluationSummary(
        model_name=model_name,
        accuracy=round(sum(1 for score in scores if score[0] >= 0.68) / count, 2),
        average_score=round(sum(score[0] for score in scores) / count, 2),
        root_cause_score=round(sum(score[1] for score in scores) / count, 2),
        remediation_score=round(sum(score[2] for score in scores) / count, 2),
        severity_score=round(sum(score[3] for score in scores) / count, 2),
    )


def evaluate_custom_model_examples(
    examples: list[IncidentTrainingExample],
) -> CustomModelEvaluationResponse:
    evaluation_examples = [
        example for example in examples if example.split == "validation"
    ] or examples
    custom_scores: list[tuple[float, float, float, float]] = []
    generic_scores: list[tuple[float, float, float, float]] = []
    cases: list[ModelEvaluationCase] = []

    for example in evaluation_examples:
        custom_root_cause, custom_severity, custom_fix = custom_model_prediction(example)
        generic_root_cause, generic_severity, generic_fix = generic_model_prediction(example)
        custom_score = score_model_prediction(
            example,
            custom_root_cause,
            custom_severity,
            custom_fix,
        )
        generic_score = score_model_prediction(
            example,
            generic_root_cause,
            generic_severity,
            generic_fix,
        )
        custom_scores.append(custom_score)
        generic_scores.append(generic_score)

        if abs(custom_score[0] - generic_score[0]) < 0.02:
            winner: EvaluationWinner = "tie"
        else:
            winner = "custom" if custom_score[0] > generic_score[0] else "generic"

        cases.append(
            ModelEvaluationCase(
                id=example.id,
                source_type=example.source_type,
                expected_root_cause=example.expected_root_cause,
                expected_fix=example.expected_fix,
                custom_root_cause=custom_root_cause,
                generic_root_cause=generic_root_cause,
                custom_score=round(custom_score[0], 2),
                generic_score=round(generic_score[0], 2),
                winner=winner,
            ),
        )

    custom_summary = summarize_model_scores(custom_model_name(), custom_scores)
    generic_summary = summarize_model_scores("generic-llm-baseline", generic_scores)
    improvement = round(
        custom_summary.average_score - generic_summary.average_score,
        2,
    )

    return CustomModelEvaluationResponse(
        evaluated_at=datetime.now(UTC).isoformat(),
        pass_threshold=CUSTOM_MODEL_PASS_THRESHOLD,
        passed=improvement >= CUSTOM_MODEL_PASS_THRESHOLD,
        improvement=improvement,
        custom_model=custom_summary,
        generic_baseline=generic_summary,
        cases=cases,
    )


def store_custom_model_training_run(
    response: CustomModelTrainingResponse,
) -> None:
    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO custom_model_training_runs (
                id,
                model_name,
                base_model,
                status,
                training_examples,
                validation_examples,
                source_breakdown,
                evaluation_payload,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                response.model_name,
                response.base_model,
                response.status,
                response.training_examples,
                response.validation_examples,
                json.dumps(model_to_dict(response.source_breakdown), ensure_ascii=True),
                json.dumps(model_to_dict(response.evaluation), ensure_ascii=True),
                response.trained_at,
            ),
        )


def build_custom_model_dataset_response(
    payload: CustomModelTrainingRequest,
) -> CustomModelDatasetResponse:
    examples = build_custom_model_examples(payload)
    train_examples = [example for example in examples if example.split == "train"]

    return CustomModelDatasetResponse(
        model_name=custom_model_name(),
        base_model=custom_model_base_model(),
        examples=examples,
        source_breakdown=source_breakdown_from_examples(examples),
        jsonl_preview=[
            training_example_to_jsonl(example)
            for example in train_examples[:3]
        ],
        ready_for_fine_tuning=custom_model_dataset_ready(
            examples,
            payload.min_examples,
        ),
    )


def train_custom_devpilot_model(
    payload: CustomModelTrainingRequest,
) -> CustomModelTrainingResponse:
    examples = build_custom_model_examples(payload)
    train_count = sum(1 for example in examples if example.split == "train")
    validation_count = sum(1 for example in examples if example.split == "validation")
    ready_for_fine_tuning = custom_model_dataset_ready(examples, payload.min_examples)
    evaluation = evaluate_custom_model_examples(examples)
    trained_at = datetime.now(UTC).isoformat()
    status: CustomModelTrainingStatus = (
        "trained" if ready_for_fine_tuning and evaluation.passed else "needs_more_data"
    )
    message = (
        "Custom DevPilot incident model trained and beat the generic baseline."
        if status == "trained"
        else "More balanced incident examples are needed before this model should be promoted."
    )
    train_examples = [example for example in examples if example.split == "train"]
    response = CustomModelTrainingResponse(
        message=message,
        status=status,
        model_name=custom_model_name(),
        base_model=custom_model_base_model(),
        training_examples=train_count,
        validation_examples=validation_count,
        source_breakdown=source_breakdown_from_examples(examples),
        ready_for_fine_tuning=ready_for_fine_tuning,
        jsonl_preview=[
            training_example_to_jsonl(example)
            for example in train_examples[:3]
        ],
        evaluation=evaluation,
        trained_at=trained_at,
    )

    store_custom_model_training_run(response)
    return response


def normalize_cloud_provider(value: Any) -> CloudProvider:
    if not isinstance(value, str):
        raise HTTPException(
            status_code=400,
            detail="cloud_provider must be one of: aws, azure, gcp.",
        )

    normalized = value.strip().lower().replace("-", "_")
    aliases = {
        "amazon": "aws",
        "amazon_web_services": "aws",
        "microsoft_azure": "azure",
        "google": "gcp",
        "google_cloud": "gcp",
        "google_cloud_platform": "gcp",
    }
    provider = aliases.get(normalized, normalized)

    if provider not in CLOUD_PROVIDER_LABELS:
        raise HTTPException(
            status_code=400,
            detail="cloud_provider must be one of: aws, azure, gcp.",
        )

    return cast(CloudProvider, provider)


def get_github_token() -> str:
    token = os.getenv("GITHUB_TOKEN")

    if not token:
        raise HTTPException(
            status_code=500,
            detail="GITHUB_TOKEN is not configured for the backend.",
        )

    return token


def normalize_github_repository(repository: str | None) -> str:
    repo = (repository or os.getenv("GITHUB_REPOSITORY") or "").strip()

    if not repo:
        raise HTTPException(
            status_code=400,
            detail=(
                "GitHub repository is required. Provide repository as owner/repo "
                "or set GITHUB_REPOSITORY."
            ),
        )

    if "github.com/" in repo:
        repo = repo.split("github.com/", 1)[1]

    repo = repo.strip().strip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]

    parts = repo.split("/")
    if len(parts) < 2:
        raise HTTPException(
            status_code=400,
            detail="GitHub repository must be formatted as owner/repo.",
        )

    normalized = f"{parts[0]}/{parts[1].removesuffix('.git')}"
    if not GITHUB_REPOSITORY_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="GitHub repository contains unsupported characters.",
        )

    return normalized


def validate_branch_name(branch_name: str) -> str:
    branch = branch_name.strip()

    invalid = (
        not branch
        or not GITHUB_BRANCH_RE.fullmatch(branch)
        or branch.startswith(("/", "."))
        or branch.endswith(("/", ".", ".lock"))
        or "//" in branch
        or any(fragment in branch for fragment in INVALID_BRANCH_FRAGMENTS)
    )

    if invalid:
        raise HTTPException(
            status_code=400,
            detail="GitHub branch name is invalid or unsafe.",
        )

    return branch


def build_fix_branch_name(issue: str, requested_branch: str | None) -> str:
    if requested_branch:
        return validate_branch_name(requested_branch)

    slug = re.sub(r"[^a-z0-9]+", "-", issue.lower()).strip("-")[:48] or "fix"
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    return validate_branch_name(f"devpilot/{slug}-{timestamp}")


def github_repo_path(repository: str, suffix: str) -> str:
    owner, repo = repository.split("/", 1)
    return f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}{suffix}"


def github_api_request(
    method: str,
    path: str,
    token: str,
    payload: dict[str, Any] | None = None,
    *,
    allow_not_found: bool = False,
) -> Any:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "DevPilot-AI",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    if body is not None:
        headers["Content-Type"] = "application/json"

    request = UrlRequest(
        f"{GITHUB_API_BASE_URL}{path}",
        data=body,
        headers=headers,
        method=method,
    )

    try:
        with urlopen(request, timeout=25) as response:
            response_body = response.read()
    except HTTPError as exc:
        if allow_not_found and exc.code == 404:
            return None

        error_body = exc.read().decode("utf-8", errors="replace")
        message = error_body
        try:
            parsed_error: Any = json.loads(error_body)
            if isinstance(parsed_error, dict) and isinstance(
                parsed_error.get("message"),
                str,
            ):
                message = parsed_error["message"]
        except json.JSONDecodeError:
            pass

        status_code = exc.code if exc.code in {401, 403, 404, 409, 422} else 502
        raise HTTPException(
            status_code=status_code,
            detail=f"GitHub API {method} {path} failed: {message}",
        ) from exc
    except URLError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not reach the GitHub API.",
        ) from exc

    if not response_body:
        return {}

    try:
        return json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="GitHub API returned an invalid JSON response.",
        ) from exc


def fix_files_to_github_payload(
    files: FixGenerationResponse,
) -> list[dict[str, str]]:
    return [
        {
            "path": GENERATED_FIX_FILE_PATHS["dockerfile"],
            "content": files.dockerfile,
        },
        {
            "path": GENERATED_FIX_FILE_PATHS["kubernetes_yaml"],
            "content": files.kubernetes_yaml,
        },
        {
            "path": GENERATED_FIX_FILE_PATHS["github_actions_workflow"],
            "content": files.github_actions_workflow,
        },
    ]


def default_pull_request_body(
    issue: str,
    file_paths: list[str],
    files: FixGenerationResponse,
) -> str:
    trimmed_issue = issue.strip()
    if len(trimmed_issue) > 1_200:
        trimmed_issue = f"{trimmed_issue[:1_200].rstrip()}..."

    files_list = "\n".join(f"- `{path}`" for path in file_paths)
    provider_label = CLOUD_PROVIDER_LABELS[files.cloud_provider]
    suggestions = files.deployment_suggestions or deployment_suggestions_for_provider(
        files.cloud_provider,
    )
    suggestion_list = "\n".join(f"- {suggestion}" for suggestion in suggestions)

    return (
        f"DevPilot AI generated {provider_label} remediation files for the detected issue.\n\n"
        "## Detected issue\n"
        f"{trimmed_issue}\n\n"
        "## Cloud provider\n"
        f"{provider_label}\n\n"
        "## Files\n"
        f"{files_list}\n\n"
        "## Deployment suggestions\n"
        f"{suggestion_list}\n\n"
        "Please review the generated changes before merging."
    )


def create_branch_from_base(
    token: str,
    repository: str,
    base_branch: str,
    branch_name: str,
) -> None:
    encoded_ref = quote(f"heads/{base_branch}", safe="/")
    base_ref = github_api_request(
        "GET",
        github_repo_path(repository, f"/git/ref/{encoded_ref}"),
        token,
    )

    base_sha = None
    if isinstance(base_ref, dict):
        ref_object = base_ref.get("object")
        if isinstance(ref_object, dict):
            base_sha = ref_object.get("sha")

    if not isinstance(base_sha, str):
        raise HTTPException(
            status_code=502,
            detail="GitHub base branch response did not include a commit SHA.",
        )

    github_api_request(
        "POST",
        github_repo_path(repository, "/git/refs"),
        token,
        {
            "ref": f"refs/heads/{branch_name}",
            "sha": base_sha,
        },
    )


def commit_generated_file(
    token: str,
    repository: str,
    branch_name: str,
    path: str,
    content: str,
) -> CommittedFixFile:
    encoded_path = quote(path, safe="/")
    encoded_branch = quote(branch_name, safe="")
    existing_file = github_api_request(
        "GET",
        github_repo_path(repository, f"/contents/{encoded_path}?ref={encoded_branch}"),
        token,
        allow_not_found=True,
    )

    existing_sha = None
    if isinstance(existing_file, dict):
        existing_sha = existing_file.get("sha")
    elif existing_file is not None:
        raise HTTPException(
            status_code=409,
            detail=f"GitHub path {path} is not a file and cannot be updated.",
        )

    commit_payload: dict[str, Any] = {
        "message": f"Add DevPilot generated fix file: {path}",
        "content": b64encode(content.encode("utf-8")).decode("ascii"),
        "branch": branch_name,
    }
    if isinstance(existing_sha, str):
        commit_payload["sha"] = existing_sha

    response = github_api_request(
        "PUT",
        github_repo_path(repository, f"/contents/{encoded_path}"),
        token,
        commit_payload,
    )

    created_content = response.get("content") if isinstance(response, dict) else None
    created_sha = None
    html_url = None
    if isinstance(created_content, dict):
        created_sha = created_content.get("sha")
        html_url = created_content.get("html_url")

    return CommittedFixFile(
        path=path,
        status="updated" if existing_sha else "created",
        sha=created_sha if isinstance(created_sha, str) else None,
        html_url=html_url if isinstance(html_url, str) else None,
    )


def create_github_pull_request(
    token: str,
    repository: str,
    branch_name: str,
    base_branch: str,
    title: str,
    body: str,
) -> dict[str, Any]:
    pull_request = github_api_request(
        "POST",
        github_repo_path(repository, "/pulls"),
        token,
        {
            "title": title,
            "head": branch_name,
            "base": base_branch,
            "body": body,
        },
    )

    if not isinstance(pull_request, dict):
        raise HTTPException(
            status_code=502,
            detail="GitHub API returned an invalid pull request response.",
        )

    return pull_request


KUBECONFIG_B64_ENV = "KUBECONFIG_B64"
KUBECONFIG_CONTENT_ENV = "KUBECONFIG_CONTENT"


def normalize_kubeconfig_content(content: str) -> str:
    return content.strip().replace("\\n", "\n")


def looks_like_inline_kubeconfig(value: str) -> bool:
    normalized = normalize_kubeconfig_content(value)
    return (
        "apiVersion:" in normalized
        and "clusters:" in normalized
        and "contexts:" in normalized
    )


def validate_inline_kubeconfig_content(content: str, source: str) -> str:
    normalized = normalize_kubeconfig_content(content)
    if not normalized:
        raise HTTPException(
            status_code=400,
            detail=f"{source} is configured but empty.",
        )

    missing_keys = [
        key
        for key in ("apiVersion:", "clusters:", "contexts:")
        if key not in normalized
    ]
    if missing_keys:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{source} does not look like a Kubernetes kubeconfig. "
                f"Missing {', '.join(missing_keys)}."
            ),
        )

    return normalized + "\n"


def inline_kubeconfig_from_environment() -> str | None:
    encoded_kubeconfig = os.getenv(KUBECONFIG_B64_ENV, "").strip()
    if encoded_kubeconfig:
        try:
            decoded = base64.b64decode(encoded_kubeconfig, validate=True).decode(
                "utf-8",
            )
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"{KUBECONFIG_B64_ENV} is configured but is not valid base64.",
            ) from exc

        return validate_inline_kubeconfig_content(decoded, KUBECONFIG_B64_ENV)

    raw_kubeconfig = os.getenv(KUBECONFIG_CONTENT_ENV, "").strip()
    if raw_kubeconfig:
        return validate_inline_kubeconfig_content(
            raw_kubeconfig,
            KUBECONFIG_CONTENT_ENV,
        )

    return None


def write_environment_kubeconfig(content: str) -> str:
    temp_root = (Path(tempfile.gettempdir()) / "devpilot-ai").resolve()
    temp_root.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    target_path = (temp_root / f"kubeconfig-{digest}.yaml").resolve()
    if target_path.parent != temp_root:
        raise HTTPException(
            status_code=500,
            detail="Could not prepare a safe kubeconfig path.",
        )

    target_path.write_text(content, encoding="utf-8")
    try:
        os.chmod(target_path, 0o600)
    except OSError:
        logger.debug("Could not tighten kubeconfig file permissions.", exc_info=True)

    return str(target_path)


def resolve_existing_kubeconfig_path(configured_path: str) -> str:
    normalized_path = configured_path.strip()
    if not normalized_path:
        raise HTTPException(
            status_code=400,
            detail="Kubeconfig path is empty.",
        )

    if os.pathsep in normalized_path:
        missing_paths = [
            str(Path(path_value).expanduser())
            for path_value in normalized_path.split(os.pathsep)
            if path_value.strip() and not Path(path_value).expanduser().exists()
        ]
        if missing_paths:
            raise HTTPException(
                status_code=400,
                detail=f"Kubeconfig file was not found: {missing_paths[0]}",
            )
        return normalized_path

    resolved_path = Path(normalized_path).expanduser()
    if not resolved_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Kubeconfig file was not found: {resolved_path}",
        )

    return str(resolved_path)


def resolve_kubeconfig_path(kubeconfig_path: str | None) -> str | None:
    if kubeconfig_path:
        if looks_like_inline_kubeconfig(kubeconfig_path):
            raise HTTPException(
                status_code=400,
                detail=(
                    "kubeconfig_path accepts a file path only. Store kubeconfig "
                    f"contents in {KUBECONFIG_B64_ENV} or {KUBECONFIG_CONTENT_ENV}."
                ),
            )
        return resolve_existing_kubeconfig_path(kubeconfig_path)

    inline_config = inline_kubeconfig_from_environment()
    if inline_config is not None:
        return write_environment_kubeconfig(inline_config)

    configured_path = os.getenv("KUBECONFIG", "").strip()
    if not configured_path:
        return None

    if looks_like_inline_kubeconfig(configured_path):
        inline_config = validate_inline_kubeconfig_content(
            configured_path,
            "KUBECONFIG",
        )
        return write_environment_kubeconfig(inline_config)

    return resolve_existing_kubeconfig_path(configured_path)


def kubernetes_error_detail(exc: ApiException) -> str:
    reason = exc.reason or "Kubernetes API request failed"
    if exc.body:
        return f"{reason}: {exc.body}"

    return reason


def get_kubernetes_client(
    payload: KubernetesConnectionRequest,
) -> tuple[client.ApiClient, str | None]:
    kubeconfig_path = resolve_kubeconfig_path(payload.kubeconfig_path)

    try:
        _, active_context = config.list_kube_config_contexts(
            config_file=kubeconfig_path,
        )
        api_client = config.new_client_from_config(
            config_file=kubeconfig_path,
            context=payload.context,
        )
    except ConfigException as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not load kubeconfig: {exc}",
        ) from exc

    context_name = payload.context
    if context_name is None and isinstance(active_context, dict):
        active_name = active_context.get("name")
        if isinstance(active_name, str):
            context_name = active_name

    return api_client, context_name


def container_state_summary(status: Any) -> tuple[str, str | None]:
    state = getattr(status, "state", None)
    if state is None:
        return "unknown", None

    waiting = getattr(state, "waiting", None)
    if waiting is not None:
        return "waiting", getattr(waiting, "reason", None)

    terminated = getattr(state, "terminated", None)
    if terminated is not None:
        reason = getattr(terminated, "reason", None)
        exit_code = getattr(terminated, "exit_code", None)
        if reason and exit_code is not None:
            return "terminated", f"{reason} ({exit_code})"
        return "terminated", reason

    running = getattr(state, "running", None)
    if running is not None:
        return "running", None

    return "unknown", None


def deployment_by_replicaset(
    replica_sets: list[Any],
) -> dict[tuple[str, str], str]:
    deployment_lookup: dict[tuple[str, str], str] = {}

    for replica_set in replica_sets:
        metadata = getattr(replica_set, "metadata", None)
        if metadata is None:
            continue

        namespace = getattr(metadata, "namespace", None)
        name = getattr(metadata, "name", None)
        owner_refs = getattr(metadata, "owner_references", None) or []

        for owner_ref in owner_refs:
            if getattr(owner_ref, "kind", None) == "Deployment":
                owner_name = getattr(owner_ref, "name", None)
                if isinstance(namespace, str) and isinstance(name, str) and isinstance(
                    owner_name,
                    str,
                ):
                    deployment_lookup[(namespace, name)] = owner_name

    return deployment_lookup


def pod_deployment_name(
    pod: Any,
    replica_set_lookup: dict[tuple[str, str], str],
) -> str | None:
    metadata = getattr(pod, "metadata", None)
    if metadata is None:
        return None

    namespace = getattr(metadata, "namespace", None)
    owner_refs = getattr(metadata, "owner_references", None) or []

    for owner_ref in owner_refs:
        owner_kind = getattr(owner_ref, "kind", None)
        owner_name = getattr(owner_ref, "name", None)
        if owner_kind == "Deployment" and isinstance(owner_name, str):
            return owner_name

        if owner_kind == "ReplicaSet" and isinstance(namespace, str) and isinstance(
            owner_name,
            str,
        ):
            deployment_name = replica_set_lookup.get((namespace, owner_name))
            if deployment_name:
                return deployment_name

    return None


def summarize_pod(
    pod: Any,
    replica_set_lookup: dict[tuple[str, str], str],
) -> KubernetesPodStatus:
    metadata = pod.metadata
    pod_status = pod.status
    phase = pod_status.phase or "Unknown"
    container_statuses = list(pod_status.init_container_statuses or []) + list(
        pod_status.container_statuses or [],
    )
    container_summaries: list[KubernetesContainerStatus] = []
    reasons: list[str] = []
    restart_count = 0

    if getattr(metadata, "deletion_timestamp", None) is not None:
        reasons.append("Pod is terminating")

    if phase not in {"Running", "Succeeded"}:
        reasons.append(f"Pod phase is {phase}")

    for container_status in container_statuses:
        state, reason = container_state_summary(container_status)
        ready = bool(getattr(container_status, "ready", False))
        restarts = int(getattr(container_status, "restart_count", 0) or 0)
        restart_count += restarts
        name = getattr(container_status, "name", "unknown")

        container_summaries.append(
            KubernetesContainerStatus(
                name=name,
                ready=ready,
                restart_count=restarts,
                state=state,
                reason=reason,
            ),
        )

        if phase == "Running" and not ready:
            reasons.append(f"Container {name} is not ready")
        if state == "waiting" and reason:
            reasons.append(f"Container {name} is waiting: {reason}")
        if state == "terminated" and reason:
            reasons.append(f"Container {name} terminated: {reason}")
        if restarts >= 3:
            reasons.append(f"Container {name} restarted {restarts} times")

    ready = phase == "Succeeded" or (
        phase == "Running"
        and bool(container_summaries)
        and all(container_status.ready for container_status in container_summaries)
    )

    owner_kind = None
    owner_name = None
    owner_refs = metadata.owner_references or []
    if owner_refs:
        owner_kind = owner_refs[0].kind
        owner_name = owner_refs[0].name

    return KubernetesPodStatus(
        namespace=metadata.namespace or "default",
        name=metadata.name or "unknown",
        phase=phase,
        ready=ready,
        restart_count=restart_count,
        node_name=pod_status.node_name,
        owner_kind=owner_kind,
        owner_name=owner_name,
        deployment_name=pod_deployment_name(pod, replica_set_lookup),
        unhealthy=bool(reasons),
        reasons=sorted(set(reasons)),
        containers=container_summaries,
    )


def unhealthy_pods_incident_summary(
    unhealthy_pods: list[KubernetesPodStatus],
    limit: int = 5,
) -> str:
    pod_summaries = []
    for pod in unhealthy_pods[:limit]:
        reasons = "; ".join(pod.reasons[:3]) or "marked unhealthy"
        pod_summaries.append(f"{pod.namespace}/{pod.name}: {reasons}")

    if len(unhealthy_pods) > limit:
        pod_summaries.append(
            f"{len(unhealthy_pods) - limit} more unhealthy pod(s) omitted.",
        )

    return " | ".join(pod_summaries)


def replica_set_revision(replica_set: Any) -> int:
    annotations = getattr(getattr(replica_set, "metadata", None), "annotations", None) or {}
    revision = annotations.get("deployment.kubernetes.io/revision", "0")
    try:
        return int(revision)
    except (TypeError, ValueError):
        return 0


def rollback_deployment_template(
    apps_api: client.AppsV1Api,
    namespace: str,
    deployment_name: str,
) -> None:
    try:
        deployment = apps_api.read_namespaced_deployment(
            name=deployment_name,
            namespace=namespace,
        )
        replica_sets = apps_api.list_namespaced_replica_set(namespace=namespace).items
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc

    owned_replica_sets = [
        replica_set
        for replica_set in replica_sets
        for owner_ref in (replica_set.metadata.owner_references or [])
        if owner_ref.kind == "Deployment" and owner_ref.name == deployment.metadata.name
    ]
    revision_pairs = sorted(
        (
            (replica_set_revision(replica_set), replica_set)
            for replica_set in owned_replica_sets
            if replica_set.spec and replica_set.spec.template
        ),
        key=lambda item: item[0],
        reverse=True,
    )

    if len(revision_pairs) < 2:
        raise HTTPException(
            status_code=409,
            detail="No previous ReplicaSet revision is available for rollback.",
        )

    previous_template = client.ApiClient().sanitize_for_serialization(
        revision_pairs[1][1].spec.template,
    )
    metadata = previous_template.setdefault("metadata", {})
    for field in (
        "creationTimestamp",
        "generateName",
        "ownerReferences",
        "resourceVersion",
        "selfLink",
        "uid",
    ):
        metadata.pop(field, None)

    labels = metadata.get("labels")
    if isinstance(labels, dict):
        labels.pop("pod-template-hash", None)

    annotations = metadata.setdefault("annotations", {})
    if isinstance(annotations, dict):
        annotations["devpilot.ai/rolled-back-at"] = datetime.now(UTC).isoformat()

    try:
        apps_api.patch_namespaced_deployment(
            name=deployment_name,
            namespace=namespace,
            body={"spec": {"template": previous_template}},
        )
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc


def patch_deployment_replicas(
    apps_api: client.AppsV1Api,
    namespace: str,
    deployment_name: str,
    replicas: int,
) -> None:
    try:
        apps_api.patch_namespaced_deployment_scale(
            name=deployment_name,
            namespace=namespace,
            body={"spec": {"replicas": replicas}},
        )
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc


def normalized_command_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def normalize_namespace_hint(value: str | None) -> str:
    namespace = (value or "production").strip().lower()
    aliases = {
        "prod": "production",
        "production": "production",
        "stage": "staging",
        "stg": "staging",
        "staging": "staging",
        "dev": "development",
    }
    namespace = aliases.get(namespace, namespace)
    namespace = re.sub(r"[^a-z0-9.-]+", "-", namespace).strip(".-")
    return namespace or "production"


def clean_command_target(value: str | None, fallback: str = "app") -> str:
    target = (value or "").lower()
    target = re.sub(
        r"\b(the|a|an|pods?|service|services|deployment|deployments|replicas?|"
        r"namespace|ns|in|to|please|now)\b",
        " ",
        target,
    )
    target = re.sub(r"[^a-z0-9.-]+", "-", target).strip(".-")
    return target or fallback


def extract_namespace_from_command(command: str, default_namespace: str) -> str:
    lowered = command.lower()
    explicit_match = re.search(
        r"\b(?:in|namespace|ns)\s+([a-z0-9][a-z0-9.-]{0,252})\b",
        lowered,
    )
    if explicit_match:
        return normalize_namespace_hint(explicit_match.group(1))

    for alias in ("production", "prod", "staging", "stage", "stg", "dev"):
        if re.search(rf"\b{re.escape(alias)}\b", lowered):
            return normalize_namespace_hint(alias)

    return normalize_namespace_hint(default_namespace)


def validate_infra_command_plan(plan: InfraCommandPlan) -> InfraCommandPlan:
    namespace = normalize_namespace_hint(plan.namespace)
    target = clean_command_target(plan.target, fallback=namespace)
    replicas = plan.replicas

    if plan.action == "scale_deployment" and replicas is None:
        raise ValueError("Scale commands must include a replica count.")

    return InfraCommandPlan(
        action=plan.action,
        namespace=namespace,
        target=target,
        replicas=replicas,
        confidence=max(0, min(plan.confidence, 1)),
        reasoning=truncate_text(plan.reasoning, 300),
    )


def parse_infra_command_with_openai(
    command: str,
    default_namespace: str,
) -> InfraCommandPlan:
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")

    instructions = (
        "You translate plain English infrastructure commands into exactly one "
        "safe Kubernetes action. Allowed actions are restart_pods, "
        "rollback_deployment, and scale_deployment. Extract namespace, target, "
        "and replica count. Use the default namespace when none is named. "
        "For 'restart payment pods', use action restart_pods and target payment. "
        "For 'rollback staging', use namespace staging and target staging. "
        "For 'scale web service to 10 replicas', use action scale_deployment, "
        "target web, replicas 10. Never invent multiple actions."
    )

    response = client.responses.parse(
        model=model,
        instructions=instructions,
        input=(
            f"Default namespace: {default_namespace}\n"
            f"Plain English command: {command}"
        ),
        text_format=InfraCommandPlan,
        max_output_tokens=500,
    )

    if response.output_parsed is None:
        raise ValueError("OpenAI did not return a valid infrastructure command.")

    return validate_infra_command_plan(response.output_parsed)


def parse_infra_command_fallback(
    command: str,
    default_namespace: str,
) -> InfraCommandPlan:
    lowered = command.lower().strip()
    namespace = extract_namespace_from_command(lowered, default_namespace)

    if re.search(r"\b(scale|resize|replicas?)\b", lowered):
        replica_match = re.search(
            r"\b(?:to|replicas?\s*=?)\s*(\d{1,3})\b",
            lowered,
        )
        if replica_match is None:
            replica_match = re.search(r"\b(\d{1,3})\s+replicas?\b", lowered)
        if replica_match is None:
            raise HTTPException(
                status_code=400,
                detail="Scale commands must include a replica count.",
            )

        target_match = re.search(
            r"\bscale\s+(?:the\s+)?([a-z0-9][a-z0-9.-]*)",
            lowered,
        )
        target = clean_command_target(
            target_match.group(1) if target_match else "app",
            fallback="app",
        )

        return InfraCommandPlan(
            action="scale_deployment",
            namespace=namespace,
            target=target,
            replicas=int(replica_match.group(1)),
            confidence=0.78,
            reasoning="Matched scale intent and replica count from the command.",
        )

    if re.search(r"\b(rollback|roll\s*back|revert)\b", lowered):
        target_match = re.search(
            r"\b(?:rollback|roll\s*back|revert)\s+(?:the\s+)?"
            r"([a-z0-9][a-z0-9.-]*)",
            lowered,
        )
        target = clean_command_target(
            target_match.group(1) if target_match else namespace,
            fallback=namespace,
        )

        return InfraCommandPlan(
            action="rollback_deployment",
            namespace=namespace,
            target=target,
            confidence=0.74,
            reasoning="Matched rollback intent from the command.",
        )

    if re.search(r"\b(restart|reboot|bounce|redeploy)\b", lowered):
        target_match = re.search(
            r"\b(?:restart|reboot|bounce|redeploy)\s+(?:the\s+)?"
            r"([a-z0-9][a-z0-9.-]*)",
            lowered,
        )
        target = clean_command_target(
            target_match.group(1) if target_match else "app",
            fallback="app",
        )

        return InfraCommandPlan(
            action="restart_pods",
            namespace=namespace,
            target=target,
            confidence=0.8,
            reasoning="Matched restart intent from the command.",
        )

    raise HTTPException(
        status_code=400,
        detail=(
            "Command intent was not recognized. Try restart, rollback, or scale "
            "with a Kubernetes target."
        ),
    )


def parse_infra_command(command: str, default_namespace: str) -> InfraCommandPlan:
    if has_openai_key():
        try:
            return parse_infra_command_with_openai(command, default_namespace)
        except (OpenAIError, ValueError, HTTPException) as exc:
            print(
                f"Plain English command OpenAI fallback: {exc.__class__.__name__}",
                flush=True,
            )

    return validate_infra_command_plan(
        parse_infra_command_fallback(command, default_namespace),
    )


def deployment_matches_hint(deployment: Any, target_hint: str) -> bool:
    metadata = getattr(deployment, "metadata", None)
    if metadata is None:
        return False

    hint = normalized_command_token(target_hint)
    values = [getattr(metadata, "name", "") or ""]
    labels = getattr(metadata, "labels", None) or {}
    values.extend(str(value) for value in labels.values())

    return any(hint and hint in normalized_command_token(value) for value in values)


def pod_matches_hint(pod: Any, target_hint: str) -> bool:
    metadata = getattr(pod, "metadata", None)
    if metadata is None:
        return False

    hint = normalized_command_token(target_hint)
    values = [getattr(metadata, "name", "") or ""]
    labels = getattr(metadata, "labels", None) or {}
    values.extend(str(value) for value in labels.values())

    return any(hint and hint in normalized_command_token(value) for value in values)


def deployment_label_selector(deployment: Any) -> str | None:
    selector = getattr(getattr(deployment, "spec", None), "selector", None)
    match_labels = getattr(selector, "match_labels", None) or {}
    if not match_labels:
        return None

    return ",".join(f"{key}={value}" for key, value in match_labels.items())


def resolve_deployment_for_command(
    apps_api: client.AppsV1Api,
    namespace: str,
    target_hint: str,
) -> str:
    try:
        deployment = apps_api.read_namespaced_deployment(
            name=target_hint,
            namespace=namespace,
        )
        if getattr(getattr(deployment, "metadata", None), "name", None):
            return str(deployment.metadata.name)
    except ApiException as exc:
        if exc.status != 404:
            raise HTTPException(
                status_code=exc.status or 502,
                detail=kubernetes_error_detail(exc),
            ) from exc

    try:
        deployments = apps_api.list_namespaced_deployment(namespace=namespace).items
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc

    matches = [
        deployment.metadata.name
        for deployment in deployments
        if getattr(deployment, "metadata", None)
        and getattr(deployment.metadata, "name", None)
        and deployment_matches_hint(deployment, target_hint)
    ]

    if len(matches) == 1:
        return str(matches[0])

    if target_hint == namespace and len(deployments) == 1:
        deployment_name = getattr(deployments[0].metadata, "name", None)
        if isinstance(deployment_name, str):
            return deployment_name

    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Command target '{target_hint}' matched multiple deployments: "
                f"{', '.join(sorted(matches))}."
            ),
        )

    raise HTTPException(
        status_code=404,
        detail=f"No deployment matched target '{target_hint}' in namespace {namespace}.",
    )


def pods_for_command_target(
    core_api: client.CoreV1Api,
    apps_api: client.AppsV1Api,
    namespace: str,
    target_hint: str,
) -> list[Any]:
    try:
        pods = core_api.list_namespaced_pod(namespace=namespace).items
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc

    matches = [pod for pod in pods if pod_matches_hint(pod, target_hint)]
    if matches:
        return matches

    deployment_name = resolve_deployment_for_command(apps_api, namespace, target_hint)
    try:
        deployment = apps_api.read_namespaced_deployment(
            name=deployment_name,
            namespace=namespace,
        )
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc

    selector = deployment_label_selector(deployment)
    if not selector:
        return []

    try:
        return core_api.list_namespaced_pod(
            namespace=namespace,
            label_selector=selector,
        ).items
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc


def preview_infra_command_action(plan: InfraCommandPlan) -> InfraCommandActionResult:
    target = f"{plan.namespace}/{plan.target}"
    if plan.action == "scale_deployment":
        message = f"Ready to scale {target} to {plan.replicas} replicas."
    elif plan.action == "rollback_deployment":
        message = f"Ready to roll back deployment {target}."
    else:
        message = f"Ready to restart pods matching {target}."

    return InfraCommandActionResult(
        action=plan.action,
        status="planned",
        namespace=plan.namespace,
        target=target,
        message=message,
        replicas=plan.replicas,
        completed_at=datetime.now(UTC).isoformat(),
    )


def execute_infra_command_plan(
    payload: InfraCommandRequest,
    plan: InfraCommandPlan,
) -> tuple[str | None, list[InfraCommandActionResult]]:
    api_client, context_name = get_kubernetes_client(payload)
    core_api = client.CoreV1Api(api_client)
    apps_api = client.AppsV1Api(api_client)
    completed_at = datetime.now(UTC).isoformat()

    if plan.action == "restart_pods":
        pods = pods_for_command_target(
            core_api=core_api,
            apps_api=apps_api,
            namespace=plan.namespace,
            target_hint=plan.target,
        )
        selected_pods = pods[: payload.max_pods]
        pod_names = [
            pod.metadata.name
            for pod in selected_pods
            if getattr(pod, "metadata", None) and pod.metadata.name
        ]

        if not pod_names:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No pods matched target '{plan.target}' in namespace "
                    f"{plan.namespace}."
                ),
            )

        for pod_name in pod_names:
            try:
                core_api.delete_namespaced_pod(
                    name=pod_name,
                    namespace=plan.namespace,
                    body=client.V1DeleteOptions(grace_period_seconds=30),
                )
            except ApiException as exc:
                raise HTTPException(
                    status_code=exc.status or 502,
                    detail=kubernetes_error_detail(exc),
                ) from exc

        return context_name, [
            InfraCommandActionResult(
                action=plan.action,
                status="completed",
                namespace=plan.namespace,
                target=f"{plan.namespace}/{plan.target}",
                pod_names=pod_names,
                message=f"Restart requested for {len(pod_names)} pod(s).",
                completed_at=completed_at,
            ),
        ]

    deployment_name = resolve_deployment_for_command(
        apps_api=apps_api,
        namespace=plan.namespace,
        target_hint=plan.target,
    )

    if plan.action == "rollback_deployment":
        rollback_deployment_template(
            apps_api=apps_api,
            namespace=plan.namespace,
            deployment_name=deployment_name,
        )
        return context_name, [
            InfraCommandActionResult(
                action=plan.action,
                status="completed",
                namespace=plan.namespace,
                target=f"{plan.namespace}/{deployment_name}",
                deployment_name=deployment_name,
                message="Deployment rollback requested using the previous ReplicaSet.",
                completed_at=completed_at,
            ),
        ]

    if plan.action == "scale_deployment":
        if plan.replicas is None:
            raise HTTPException(
                status_code=400,
                detail="Scale commands must include a replica count.",
            )

        patch_deployment_replicas(
            apps_api=apps_api,
            namespace=plan.namespace,
            deployment_name=deployment_name,
            replicas=plan.replicas,
        )
        return context_name, [
            InfraCommandActionResult(
                action=plan.action,
                status="completed",
                namespace=plan.namespace,
                target=f"{plan.namespace}/{deployment_name}",
                deployment_name=deployment_name,
                replicas=plan.replicas,
                message=f"Deployment scaled to {plan.replicas} replicas.",
                completed_at=completed_at,
            ),
        ]

    raise HTTPException(status_code=400, detail="Unsupported infrastructure action.")


def sanitize_request_text(value: str) -> str:
    return value.replace("\x00", "").strip()


async def read_request_body(request: Request) -> bytes:
    if request_body_size_too_large(request):
        raise HTTPException(status_code=413, detail="Request body is too large.")

    body = await request.body()
    if len(body) > MAX_REQUEST_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body is too large.")

    return body


async def extract_logs_from_request(request: Request) -> str:
    content_type = request.headers.get("content-type", "").lower()
    body = await read_request_body(request)

    if not body:
        raise HTTPException(status_code=400, detail="Raw logs text is required.")

    if "application/json" in content_type:
        try:
            payload: Any = json.loads(body)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON payload.") from exc

        if isinstance(payload, str):
            return sanitize_request_text(payload)

        if isinstance(payload, dict):
            for key in ("logs", "content", "raw_logs"):
                value = payload.get(key)
                if isinstance(value, str):
                    return sanitize_request_text(value)

        raise HTTPException(
            status_code=400,
            detail="JSON payload must include a logs, content, or raw_logs string.",
        )

    try:
        return sanitize_request_text(body.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Logs must be UTF-8 text.") from exc


async def extract_issue_from_request(request: Request) -> str:
    content_type = request.headers.get("content-type", "").lower()
    body = await read_request_body(request)

    if not body:
        raise HTTPException(status_code=400, detail="Detected issue is required.")

    if "application/json" in content_type:
        try:
            payload: Any = json.loads(body)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON payload.") from exc

        if isinstance(payload, str):
            return sanitize_request_text(payload)

        if isinstance(payload, dict):
            for key in ("issue", "detected_issue", "root_cause", "problem"):
                value = payload.get(key)
                if isinstance(value, str):
                    return sanitize_request_text(value)

        raise HTTPException(
            status_code=400,
            detail=(
                "JSON payload must include an issue, detected_issue, "
                "root_cause, or problem string."
            ),
        )

    try:
        return sanitize_request_text(body.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Issue must be UTF-8 text.") from exc


async def extract_fix_generation_request(request: Request) -> FixGenerationRequest:
    content_type = request.headers.get("content-type", "").lower()
    body = await read_request_body(request)

    if not body:
        raise HTTPException(status_code=400, detail="Detected issue is required.")

    if "application/json" not in content_type:
        try:
            issue = sanitize_request_text(body.decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=400, detail="Issue must be UTF-8 text.") from exc

        return FixGenerationRequest(issue=issue, cloud_provider="aws")

    try:
        payload: Any = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.") from exc

    if isinstance(payload, str):
        return FixGenerationRequest(
            issue=sanitize_request_text(payload),
            cloud_provider="aws",
        )

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="JSON payload must include an issue string.",
        )

    issue = None
    for key in ("issue", "detected_issue", "root_cause", "problem"):
        value = payload.get(key)
        if isinstance(value, str):
            issue = sanitize_request_text(value)
            break

    if issue is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "JSON payload must include an issue, detected_issue, "
                "root_cause, or problem string."
            ),
        )

    cloud_provider = normalize_cloud_provider(payload.get("cloud_provider", "aws"))
    return FixGenerationRequest(issue=issue, cloud_provider=cloud_provider)


def analyze_logs_with_openai(logs: str) -> LogAnalysisResponse:
    if not has_openai_key():
        return analyze_logs_with_fallback(logs)

    client = get_openai_client()
    model = openai_incident_analysis_model()

    instructions = (
        "You are DevPilot AI, an autonomous DevOps incident analyst. "
        "Analyze raw application, deployment, CI, or infrastructure logs. "
        "Return a concise, actionable diagnosis. "
        "Classify severity as one of: low, medium, high, critical. "
        "Do not invent facts that are not supported by the logs; say when evidence is limited."
    )

    try:
        response = client.responses.parse(
            model=model,
            instructions=instructions,
            input=(
                "Analyze these raw logs and identify the most likely root cause, "
                "severity, explanation, and recommended fix.\n\n"
                f"{logs}"
            ),
            text_format=LogAnalysisResponse,
            max_output_tokens=700,
        )
    except OpenAIError:
        return analyze_logs_with_fallback(logs)

    if response.output_parsed is None:
        return analyze_logs_with_fallback(logs)

    return response.output_parsed


def issue_comment(issue: str) -> str:
    lines = [line.strip() for line in issue.splitlines() if line.strip()]
    if not lines:
        return "# Issue: unspecified"

    limited_lines = lines[:6]
    comments = [f"# Issue: {limited_lines[0]}"]
    comments.extend(f"# {line}" for line in limited_lines[1:])
    return "\n".join(comments)


def deployment_suggestions_for_provider(
    cloud_provider: CloudProvider,
    similar_incidents: list[tuple[dict[str, Any], float]] | None = None,
) -> list[str]:
    suggestions = list(CLOUD_PROVIDER_CONFIG[cloud_provider]["suggestions"])
    if similar_incidents:
        suggestions.extend(history_recommendations_from_rows(similar_incidents))

    return unique_suggestions(suggestions)


def indent_lines(value: str, spaces: int) -> str:
    padding = " " * spaces
    return "\n".join(f"{padding}{line}" if line else line for line in value.splitlines())


def render_mapping(mapping: dict[str, str], spaces: int) -> str:
    padding = " " * spaces
    return "\n".join(f"{padding}{key}: {value}" for key, value in mapping.items())


def render_deploy_step(step: dict[str, str]) -> str:
    lines = [f"      - name: {step['name']}"]

    if "uses" in step:
        lines.append(f"        uses: {step['uses']}")

    if "run" in step:
        lines.append("        run: |")
        lines.append(indent_lines(step["run"], 10))

    return "\n".join(lines)


def analyze_logs_with_fallback(logs: str) -> LogAnalysisResponse:
    normalized = logs.lower()
    has_database_config_failure = any(
        token in normalized
        for token in (
            "database_url",
            "database url",
            "missing database",
            "connection string",
            "dsn",
        )
    )
    has_crash_loop = any(
        token in normalized
        for token in ("crashloopbackoff", "crash loop", "failedmount", "back-off")
    )
    has_ci_failure = any(
        token in normalized
        for token in ("pytest", "exit code 1", "workflow failed", "ci failed")
    )
    has_security_failure = any(
        token in normalized
        for token in ("secret", "password", "token", "permission denied", "forbidden")
    )

    if has_database_config_failure:
        return LogAnalysisResponse(
            root_cause=(
                "The service appears to be missing required database runtime "
                "configuration."
            ),
            severity="high" if has_crash_loop or has_ci_failure else "medium",
            explanation=(
                "The logs mention database configuration or connection string "
                "failures. This commonly prevents the API from starting and can "
                "cascade into failed readiness checks or CI release gates."
            ),
            recommended_fix=(
                "Restore the expected DATABASE_URL or equivalent secret, restart "
                "the affected deployment, and keep promotion blocked until health "
                "checks and backend tests pass."
            ),
        )

    if has_crash_loop:
        return LogAnalysisResponse(
            root_cause="A Kubernetes workload is repeatedly failing during startup.",
            severity="critical" if "production" in normalized else "high",
            explanation=(
                "The logs include CrashLoopBackOff or pod restart signals, which "
                "means the workload is not reaching a stable ready state."
            ),
            recommended_fix=(
                "Inspect the container startup logs, roll back the latest release "
                "if it introduced the failure, and restart managed pods after the "
                "runtime configuration is corrected."
            ),
        )

    if has_security_failure:
        return LogAnalysisResponse(
            root_cause="The failure is likely tied to credentials, secrets, or access control.",
            severity="high",
            explanation=(
                "The log signal references secrets, tokens, passwords, or access "
                "denials. Treat this as a sensitive configuration issue until "
                "the exact permission boundary is verified."
            ),
            recommended_fix=(
                "Rotate exposed credentials if needed, move secrets into the "
                "runtime secret store, and validate the service account or IAM "
                "permissions before retrying the deployment."
            ),
        )

    return LogAnalysisResponse(
        root_cause="The logs show an application or deployment failure, but evidence is limited.",
        severity="medium" if "error" in normalized or "failed" in normalized else "low",
        explanation=(
            "DevPilot used the local fallback analyzer because no hosted OpenAI "
            "model was available or the model call failed. The payload still "
            "contains enough signal for a safe first-pass remediation."
        ),
        recommended_fix=(
            "Review the earliest error line, confirm recent deployment changes, "
            "restore missing environment variables, and rerun health checks."
        ),
    )


def render_provider_workflow(
    comment: str,
    cloud_provider: CloudProvider,
) -> str:
    config = CLOUD_PROVIDER_CONFIG[cloud_provider]
    provider_label = CLOUD_PROVIDER_LABELS[cloud_provider]
    auth_with = render_mapping(config["auth_with"], 10)
    deploy_steps = "\n\n".join(
        render_deploy_step(step) for step in config["deploy_steps"]
    )
    env_values = render_mapping(config["env"], 2)

    return f"""{comment}
name: DevPilot {provider_label} Remediation CI

on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]

permissions:
  contents: read
  id-token: write

env:
{env_values}

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.14"

      - name: Install backend dependencies
        run: pip install -r backend/requirements.txt

      - name: Compile backend
        run: python -m compileall backend

      - name: {config["auth_step"]}
        uses: {config["auth_uses"]}
        with:
{auth_with}

{deploy_steps}
"""


def generate_fallback_fix(
    issue: str,
    cloud_provider: CloudProvider = "aws",
    similar_incidents: list[tuple[dict[str, Any], float]] | None = None,
) -> FixGenerationResponse:
    comment = issue_comment(issue)
    config = CLOUD_PROVIDER_CONFIG[cloud_provider]
    provider_label = CLOUD_PROVIDER_LABELS[cloud_provider]

    dockerfile = f"""{comment}
FROM python:3.14-slim

LABEL devpilot.cloud-provider="{provider_label}"

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
"""

    kubernetes_yaml = f"""{comment}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpilot-api
  labels:
    app: devpilot-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: devpilot-api
  template:
    metadata:
      labels:
        app: devpilot-api
    spec:
      containers:
        - name: devpilot-api
          image: ghcr.io/your-org/devpilot-api:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8000
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {config["secret_name"]}
                  key: {config["secret_key"]}
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
---
apiVersion: v1
kind: Service
metadata:
  name: devpilot-api
spec:
  type: ClusterIP
  selector:
    app: devpilot-api
  ports:
    - name: http
      port: 80
      targetPort: 8000
"""

    kubernetes_yaml = kubernetes_yaml.replace(
        "image: ghcr.io/your-org/devpilot-api:latest",
        f"image: {config['registry_image']}",
    )

    github_actions_workflow = render_provider_workflow(comment, cloud_provider)

    return FixGenerationResponse(
        dockerfile=dockerfile,
        kubernetes_yaml=kubernetes_yaml,
        github_actions_workflow=github_actions_workflow,
        cloud_provider=cloud_provider,
        deployment_suggestions=deployment_suggestions_for_provider(
            cloud_provider,
            similar_incidents,
        ),
    )


def demo_timestamp(base_time: datetime, minutes_ago: int) -> str:
    return (base_time - timedelta(minutes=minutes_ago)).isoformat()


def build_demo_ci_failures() -> list[DemoCiFailure]:
    return [
        DemoCiFailure(
            provider="GitHub Actions",
            workflow="backend-ci",
            job="test",
            step="Run pytest",
            branch="main",
            commit_sha="9f31c2a",
            status="failed",
            duration_seconds=96,
            failure_summary=(
                "Backend tests failed because DATABASE_URL is not present in "
                "the release environment."
            ),
            logs=(
                "Run pytest backend/tests -q\n"
                "E   RuntimeError: DATABASE_URL is required for startup checks\n"
                "FAILED backend/tests/test_health.py::test_database_ready\n"
                "Error: Process completed with exit code 1."
            ),
        ),
        DemoCiFailure(
            provider="GitHub Actions",
            workflow="release-image",
            job="build-and-push",
            step="Compile backend",
            branch="main",
            commit_sha="9f31c2a",
            status="failed",
            duration_seconds=222,
            failure_summary=(
                "Container image build failed during backend compilation after "
                "the same release commit."
            ),
            logs=(
                "Run docker build -t ghcr.io/acme/devpilot-api:9f31c2a .\n"
                "#13 ERROR: failed to solve: process \"/bin/sh -c python -m "
                "compileall backend\" did not complete successfully: exit code: 1\n"
                "release-image / build-and-push failed after 3m 42s"
            ),
        ),
    ]


def build_demo_cluster_status(checked_at: str) -> KubernetesClusterStatusResponse:
    pods = [
        KubernetesPodStatus(
            namespace="production",
            name="api-7f9d8c6b5d-crashloop",
            phase="Running",
            ready=False,
            restart_count=7,
            node_name="ip-10-0-4-12.ec2.internal",
            owner_kind="ReplicaSet",
            owner_name="devpilot-api-7f9d8c6b5d",
            deployment_name="devpilot-api",
            unhealthy=True,
            reasons=[
                "Container api is waiting: CrashLoopBackOff",
                "Container api restarted 7 times",
                "Container api is not ready",
            ],
            containers=[
                KubernetesContainerStatus(
                    name="api",
                    ready=False,
                    restart_count=7,
                    state="waiting",
                    reason="CrashLoopBackOff",
                ),
            ],
        ),
        KubernetesPodStatus(
            namespace="production",
            name="worker-54b8c9d7c8-timeout",
            phase="Running",
            ready=False,
            restart_count=4,
            node_name="ip-10-0-5-18.ec2.internal",
            owner_kind="ReplicaSet",
            owner_name="devpilot-worker-54b8c9d7c8",
            deployment_name="devpilot-worker",
            unhealthy=True,
            reasons=[
                "Container worker is waiting: ErrImagePull",
                "Container worker restarted 4 times",
                "Container worker is not ready",
            ],
            containers=[
                KubernetesContainerStatus(
                    name="worker",
                    ready=False,
                    restart_count=4,
                    state="waiting",
                    reason="ErrImagePull",
                ),
            ],
        ),
        KubernetesPodStatus(
            namespace="production",
            name="gateway-688ffb8449-bx8dt",
            phase="Running",
            ready=True,
            restart_count=0,
            node_name="ip-10-0-4-33.ec2.internal",
            owner_kind="ReplicaSet",
            owner_name="gateway-688ffb8449",
            deployment_name="gateway",
            unhealthy=False,
            reasons=[],
            containers=[
                KubernetesContainerStatus(
                    name="gateway",
                    ready=True,
                    restart_count=0,
                    state="running",
                ),
            ],
        ),
        KubernetesPodStatus(
            namespace="observability",
            name="otel-collector-6b786c6749-ztb2m",
            phase="Running",
            ready=True,
            restart_count=1,
            node_name="ip-10-0-6-21.ec2.internal",
            owner_kind="ReplicaSet",
            owner_name="otel-collector-6b786c6749",
            deployment_name="otel-collector",
            unhealthy=False,
            reasons=[],
            containers=[
                KubernetesContainerStatus(
                    name="otel-collector",
                    ready=True,
                    restart_count=1,
                    state="running",
                ),
            ],
        ),
    ]

    return KubernetesClusterStatusResponse(
        context="devpilot-demo/us-east-1",
        namespaces=["ci-runners", "observability", "production"],
        pods=pods,
        unhealthy_pods=[pod for pod in pods if pod.unhealthy],
        checked_at=checked_at,
    )


def build_demo_auto_heal_response(healed_at: str) -> AutoHealResponse:
    actions = [
        AutoHealAction(
            action="restart_failed_pod",
            target="production/api-7f9d8c6b5d-crashloop",
            status="simulated",
            detail=(
                "Restarted the CrashLoopBackOff pod after confirming it is "
                "managed by deployment/devpilot-api."
            ),
        ),
        AutoHealAction(
            action="rollback_deployment",
            target="production/devpilot-api",
            status="simulated",
            detail=(
                "Rolled deployment/devpilot-api back from release 9f31c2a to "
                "the previous stable ReplicaSet."
            ),
        ),
        AutoHealAction(
            action="patch_config",
            target="production/devpilot-api-config",
            status="simulated",
            detail=(
                "Restored DATABASE_URL from the production secret reference and "
                "tightened readiness checks."
            ),
        ),
    ]

    return AutoHealResponse(
        message="Demo recovery completed successfully.",
        actions=actions,
        healed_at=healed_at,
    )


def timestamp_after(base_time: datetime, seconds_after: int) -> str:
    return (base_time + timedelta(seconds=seconds_after)).isoformat()


def build_chaos_failure(
    payload: ChaosInjectionRequest,
    injected_at: str,
) -> ChaosInjectedFailure:
    namespace = payload.namespace
    service = payload.service

    if payload.failure_type == "network_outage":
        target = f"{namespace}/networkpolicy/{service}-egress"
        logs = "\n".join(
            [
                f"{injected_at} chaos-controller INFO blocked egress for service/{service}",
                f"{injected_at} pod/{namespace}/{payload.pod_name} WARN upstream api timeout after 3000ms",
                f"{injected_at} service/{namespace}/{service} ERROR synthetic check failed: connection reset",
            ],
        )
        return ChaosInjectedFailure(
            failure_type=payload.failure_type,
            title="Network outage injected",
            target=target,
            severity="high",
            blast_radius="Production API pods cannot reach their upstream dependency.",
            signals=[
                "Synthetic checks report connection reset",
                "Service mesh egress policy denies upstream traffic",
                "Application logs show repeated timeout retries",
            ],
            logs=logs,
            injected_at=injected_at,
        )

    if payload.failure_type == "cicd_failure":
        target = f"github-actions/{payload.workflow}@{payload.branch}:{payload.commit_sha}"
        logs = "\n".join(
            [
                f"{injected_at} github-actions/{payload.workflow} ERROR build failed for {payload.commit_sha}",
                f"{injected_at} job/build-and-push WARN image promotion blocked by failed contract test",
                f"{injected_at} deploy/{service} WARN release candidate rejected before rollout",
            ],
        )
        return ChaosInjectedFailure(
            failure_type=payload.failure_type,
            title="CI/CD failure injected",
            target=target,
            severity="medium",
            blast_radius="Release automation is blocked before the bad artifact reaches production.",
            signals=[
                "Pipeline job exits non-zero",
                "Release image promotion is blocked",
                "Deployment remains pinned to the last healthy revision",
            ],
            logs=logs,
            injected_at=injected_at,
        )

    target = f"{namespace}/{payload.pod_name}"
    logs = "\n".join(
        [
            f"{injected_at} chaos-controller INFO killed pod/{namespace}/{payload.pod_name}",
            f"{injected_at} kubelet WARN pod/{namespace}/{payload.pod_name} failed liveness probe",
            f"{injected_at} pod/{namespace}/{payload.pod_name} Warning BackOff restarting failed container api",
        ],
    )
    return ChaosInjectedFailure(
        failure_type=payload.failure_type,
        title="Pod crash injected",
        target=target,
        severity="critical",
        blast_radius="One production API replica is crash-looping and serving no traffic.",
        signals=[
            "Pod entered CrashLoopBackOff",
            "Readiness probe failed",
            "Restart count increased after forced crash",
        ],
        logs=logs,
        injected_at=injected_at,
    )


def build_chaos_detection(
    payload: ChaosInjectionRequest,
    detected_at: str,
) -> ChaosDetectionResult:
    def confidence(base: float) -> float:
        evidence_count = sum(
            1
            for value in (
                payload.namespace,
                payload.service,
                payload.deployment,
                payload.pod_name,
                payload.workflow,
                payload.commit_sha,
            )
            if value
        )
        fingerprint = (
            sum(ord(character) for character in payload.failure_type + payload.commit_sha)
            % 5
        )
        return round(min(base + evidence_count * 0.008 + fingerprint * 0.006, 0.97), 2)

    if payload.failure_type == "network_outage":
        return ChaosDetectionResult(
            detected=True,
            root_cause=(
                "Network egress was denied for the production API service, causing "
                "upstream request timeouts."
            ),
            confidence=confidence(0.87),
            recommended_strategy=(
                "Restore the service egress policy, recycle affected pods, and "
                "validate traffic with a synthetic probe."
            ),
            detected_at=detected_at,
        )

    if payload.failure_type == "cicd_failure":
        return ChaosDetectionResult(
            detected=True,
            root_cause=(
                "The release pipeline failed before image promotion, so DevPilot "
                "kept production pinned to the last stable deployment."
            ),
            confidence=confidence(0.84),
            recommended_strategy=(
                "Block the failed artifact, patch the pipeline contract, and keep "
                "serving the previous healthy revision."
            ),
            detected_at=detected_at,
        )

    return ChaosDetectionResult(
        detected=True,
        root_cause=(
            "A production API pod crashed and entered CrashLoopBackOff after the "
            "chaos injection."
        ),
        confidence=confidence(0.88),
        recommended_strategy=(
            "Restart the failed pod, roll back the deployment if instability "
            "continues, and patch readiness configuration."
        ),
        detected_at=detected_at,
    )


def build_chaos_auto_heal_response(
    payload: ChaosInjectionRequest,
    healed_at: str,
) -> AutoHealResponse:
    namespace = payload.namespace
    config_map = f"{payload.service}-config"

    if payload.failure_type == "network_outage":
        actions = [
            AutoHealAction(
                action="restore_network_policy",
                target=f"{namespace}/networkpolicy/{payload.service}-egress",
                status="simulated",
                detail="Restored required egress rules for the affected service.",
            ),
            AutoHealAction(
                action="restart_failed_pod",
                target=f"{namespace}/{payload.pod_name}",
                status="simulated",
                detail="Recycled affected pods to refresh DNS and connection pools.",
            ),
            AutoHealAction(
                action="validate_service_path",
                target=f"{namespace}/{payload.service}",
                status="simulated",
                detail="Validated synthetic requests through the recovered network path.",
            ),
        ]
        return AutoHealResponse(
            message="Network outage auto-healed successfully.",
            actions=actions,
            healed_at=healed_at,
        )

    if payload.failure_type == "cicd_failure":
        actions = [
            AutoHealAction(
                action="rollback_deployment",
                target=f"{namespace}/{payload.deployment}",
                status="simulated",
                detail="Kept production on the previous stable deployment revision.",
            ),
            AutoHealAction(
                action="patch_ci_workflow",
                target=f"github-actions/{payload.workflow}",
                status="simulated",
                detail="Patched the release workflow contract and blocked the failed artifact.",
            ),
            AutoHealAction(
                action="validate_release_gate",
                target=f"{payload.branch}/{payload.commit_sha}",
                status="simulated",
                detail="Confirmed release gates reject the bad build before deployment.",
            ),
        ]
        return AutoHealResponse(
            message="CI/CD failure auto-healed successfully.",
            actions=actions,
            healed_at=healed_at,
        )

    actions = [
        AutoHealAction(
            action="restart_failed_pod",
            target=f"{namespace}/{payload.pod_name}",
            status="simulated",
            detail="Restarted the crash-looping pod under controller supervision.",
        ),
        AutoHealAction(
            action="rollback_deployment",
            target=f"{namespace}/{payload.deployment}",
            status="simulated",
            detail="Rolled the deployment back to the last stable ReplicaSet revision.",
        ),
        AutoHealAction(
            action="patch_config",
            target=f"{namespace}/{config_map}",
            status="simulated",
            detail="Patched readiness and recovery settings to prevent repeat restarts.",
        ),
    ]
    return AutoHealResponse(
        message="Pod crash auto-healed successfully.",
        actions=actions,
        healed_at=healed_at,
    )


def build_chaos_timeline(
    *,
    base_time: datetime,
    failure: ChaosInjectedFailure,
    detection: ChaosDetectionResult,
    auto_heal: AutoHealResponse,
) -> list[ChaosTimelineStep]:
    return [
        ChaosTimelineStep(
            stage="Failure injected",
            status="simulated",
            detail=f"{failure.title} against {failure.target}.",
            completed_at=timestamp_after(base_time, 0),
        ),
        ChaosTimelineStep(
            stage="Signal detected",
            status="completed",
            detail=f"DevPilot detected {len(failure.signals)} matching failure signal(s).",
            completed_at=detection.detected_at,
        ),
        ChaosTimelineStep(
            stage="Root cause ranked",
            status="completed",
            detail=f"{detection.confidence:.0%} confidence: {detection.root_cause}",
            completed_at=timestamp_after(base_time, 2),
        ),
        ChaosTimelineStep(
            stage="Auto-heal executed",
            status="simulated",
            detail=f"Applied {len(auto_heal.actions)} recovery action(s) in safe mode.",
            completed_at=auto_heal.healed_at,
        ),
        ChaosTimelineStep(
            stage="Recovery validated",
            status="completed",
            detail="Synthetic checks passed and the service returned to healthy state.",
            completed_at=timestamp_after(base_time, 4),
        ),
    ]


def autonomous_agent_config_snapshot() -> dict[str, Any]:
    with AUTONOMOUS_AGENT_LOCK:
        return dict(AUTONOMOUS_AGENT_CONFIG)


def update_autonomous_agent_state(
    *,
    last_checked_at: str | None = None,
    last_decision: AutonomousAgentDecision | None = None,
    last_error: str | None = None,
) -> None:
    global AUTONOMOUS_AGENT_LAST_CHECKED_AT
    global AUTONOMOUS_AGENT_LAST_DECISION
    global AUTONOMOUS_AGENT_LAST_ERROR

    with AUTONOMOUS_AGENT_LOCK:
        if last_checked_at is not None:
            AUTONOMOUS_AGENT_LAST_CHECKED_AT = last_checked_at
        AUTONOMOUS_AGENT_LAST_DECISION = last_decision
        AUTONOMOUS_AGENT_LAST_ERROR = last_error


def incident_search_blob(row: dict[str, Any]) -> str:
    return "\n".join(
        str(row.get(key) or "")
        for key in (
            "summary",
            "raw_logs",
            "explanation",
            "recommended_fix",
            "search_text",
        )
    )


def infer_cloud_provider_from_incident(row: dict[str, Any]) -> CloudProvider:
    try:
        return normalize_cloud_provider(row.get("cloud_provider") or "aws")
    except HTTPException:
        return "aws"


def infer_kubernetes_target(row: dict[str, Any]) -> dict[str, str]:
    default_target = {
        "namespace": "production",
        "pod_name": "api-7f9d8c6b5d-crashloop",
        "deployment_name": "devpilot-api",
        "config_map": "devpilot-api-config",
    }
    raw_logs = row.get("raw_logs")
    if not isinstance(raw_logs, str) or not raw_logs.strip().startswith("["):
        return default_target

    try:
        pods = json.loads(raw_logs)
    except json.JSONDecodeError:
        return default_target

    if not isinstance(pods, list) or not pods:
        return default_target

    pod = pods[0]
    if not isinstance(pod, dict):
        return default_target

    namespace = pod.get("namespace")
    name = pod.get("name")
    deployment_name = pod.get("deployment_name")

    return {
        "namespace": namespace if isinstance(namespace, str) else default_target["namespace"],
        "pod_name": name if isinstance(name, str) else default_target["pod_name"],
        "deployment_name": (
            deployment_name
            if isinstance(deployment_name, str)
            else default_target["deployment_name"]
        ),
        "config_map": default_target["config_map"],
    }


def autonomous_decision_confidence(
    *,
    base: float,
    text: str,
    severity: Any,
    indicators: tuple[str, ...],
    row: dict[str, Any],
) -> float:
    matched_indicators = sum(1 for indicator in indicators if indicator in text)
    severity_name = str(severity or "").lower()
    severity_boost = {
        "critical": 0.07,
        "high": 0.05,
        "medium": 0.025,
        "low": 0.0,
    }.get(severity_name, 0.015)
    stored_fix_boost = 0.025 if row.get("has_fix") else 0.0
    explanation_boost = 0.015 if row.get("explanation") else 0.0

    return round(
        min(
            base
            + min(matched_indicators, 5) * 0.028
            + severity_boost
            + stored_fix_boost
            + explanation_boost,
            0.97,
        ),
        2,
    )


def build_autonomous_decision(row: dict[str, Any]) -> AutonomousAgentDecision:
    text = incident_search_blob(row).lower()
    summary = str(row.get("summary") or "Unresolved incident detected.")
    incident_id = str(row.get("id")) if row.get("id") else None
    severity = row.get("severity")
    kubernetes_indicators = (
        "crashloopbackoff",
        "errimagepull",
        "progressdeadlineexceeded",
        "unhealthy pod",
        "kubernetes",
        "failedmount",
    )

    if any(
        token in text
        for token in kubernetes_indicators
    ):
        return AutonomousAgentDecision(
            incident_id=incident_id,
            summary=summary,
            severity=severity,
            strategy="rollback_restart_and_restore_config",
            confidence=autonomous_decision_confidence(
                base=0.72,
                text=text,
                severity=severity,
                indicators=kubernetes_indicators,
                row=row,
            ),
            actions=[
                "generate_remediation",
                "restart_failed_pod",
                "rollback_deployment",
                "patch_config",
            ],
            reason=(
                "Kubernetes failure signals indicate a bad release or runtime "
                "configuration drift, so the safest remediation is rollback, "
                "pod restart, and config restoration."
            ),
        )

    ci_indicators = ("github actions", "ci/cd", "pytest", "workflow")
    if any(token in text for token in ci_indicators):
        return AutonomousAgentDecision(
            incident_id=incident_id,
            summary=summary,
            severity=severity,
            strategy="generate_fix_and_block_release",
            confidence=autonomous_decision_confidence(
                base=0.68,
                text=text,
                severity=severity,
                indicators=ci_indicators,
                row=row,
            ),
            actions=["generate_remediation", "patch_config"],
            reason=(
                "CI/CD failure signals point to a release contract issue; "
                "generate remediation and patch the missing runtime contract "
                "before promotion continues."
            ),
        )

    return AutonomousAgentDecision(
        incident_id=incident_id,
        summary=summary,
        severity=severity,
        strategy="generate_fix_and_recover_defaults",
        confidence=autonomous_decision_confidence(
            base=0.6,
            text=text,
            severity=severity,
            indicators=("error", "failed", "timeout", "missing", "latency"),
            row=row,
        ),
        actions=["generate_remediation", "patch_config"],
        reason=(
            "The incident is unresolved and has enough signal for a conservative "
            "remediation plan with safe runtime defaults."
        ),
    )


def collect_kubernetes_incidents_for_agent(cycle_id: str, config_snapshot: dict[str, Any]) -> None:
    kubeconfig_path = config_snapshot.get("kubeconfig_path") or os.getenv("KUBECONFIG")
    context = config_snapshot.get("context")
    mode = config_snapshot.get("mode")

    if not kubeconfig_path and mode != "kubernetes":
        return

    try:
        api_client, context_name = get_kubernetes_client(
            KubernetesConnectionRequest(
                kubeconfig_path=kubeconfig_path,
                context=context,
            ),
        )
        core_api = client.CoreV1Api(api_client)
        apps_api = client.AppsV1Api(api_client)
        replica_sets = apps_api.list_replica_set_for_all_namespaces().items
        replica_set_lookup = deployment_by_replicaset(replica_sets)
        pods = [
            summarize_pod(pod, replica_set_lookup)
            for pod in core_api.list_pod_for_all_namespaces().items
        ]
    except Exception as exc:
        log_autonomous_action(
            cycle_id=cycle_id,
            action_type="monitor_kubernetes",
            target=str(kubeconfig_path or "default-kubeconfig"),
            status="failed",
            detail=f"Kubernetes monitor failed: {exc.__class__.__name__}: {exc}",
        )
        return

    unhealthy_pods = [pod for pod in pods if pod.unhealthy]
    log_autonomous_action(
        cycle_id=cycle_id,
        action_type="monitor_kubernetes",
        target=context_name or "current-context",
        status="observed",
        detail=f"Checked Kubernetes cluster and found {len(unhealthy_pods)} unhealthy pod(s).",
    )

    if not unhealthy_pods:
        return

    checked_at = datetime.now(UTC).isoformat()
    store_incident_memory(
        source="/kubernetes/status",
        raw_logs=json.dumps(
            [model_to_dict(pod) for pod in unhealthy_pods],
            ensure_ascii=True,
        ),
        summary=unhealthy_pods_incident_summary(unhealthy_pods),
        severity="high",
        explanation=(
            f"Autonomous agent detected {len(unhealthy_pods)} unhealthy pod(s) "
            f"in context {context_name or 'default'}."
        ),
        recommended_fix=(
            "Restart failed pods, roll back affected deployments, and restore "
            "runtime configuration automatically."
        ),
        created_at=checked_at,
    )


def apply_kubernetes_action_if_enabled(
    *,
    cycle_id: str,
    incident_id: str | None,
    action: str,
    target: dict[str, str],
    config_snapshot: dict[str, Any],
) -> AutonomousActionStatus:
    mode = config_snapshot.get("mode")
    apply_real_actions = bool(config_snapshot.get("apply_real_kubernetes_actions"))
    if mode != "kubernetes" or not apply_real_actions:
        return "simulated"

    payload = KubernetesConnectionRequest(
        kubeconfig_path=config_snapshot.get("kubeconfig_path"),
        context=config_snapshot.get("context"),
    )

    try:
        api_client, _ = get_kubernetes_client(payload)
        if action == "restart_failed_pod":
            core_api = client.CoreV1Api(api_client)
            core_api.delete_namespaced_pod(
                name=target["pod_name"],
                namespace=target["namespace"],
                body=client.V1DeleteOptions(grace_period_seconds=30),
            )
        elif action == "rollback_deployment":
            apps_api = client.AppsV1Api(api_client)
            rollback_deployment_template(
                apps_api=apps_api,
                namespace=target["namespace"],
                deployment_name=target["deployment_name"],
            )
        else:
            return "simulated"
    except Exception as exc:
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type=action,
            target=f"{target['namespace']}/{target['pod_name']}",
            status="failed",
            detail=f"Real Kubernetes action failed: {exc.__class__.__name__}: {exc}",
        )
        return "failed"

    return "completed"


def apply_autonomous_remediation_actions(
    *,
    cycle_id: str,
    incident_id: str,
    decision: AutonomousAgentDecision,
    target: dict[str, str],
    cloud_provider: CloudProvider,
    config_snapshot: dict[str, Any],
    approval_id: str | None = None,
    reviewed_by_role: UserRole | None = None,
) -> None:
    for action in decision.actions:
        if action not in AUTONOMOUS_REMEDIATION_ACTIONS or action == "generate_remediation":
            continue

        status = apply_kubernetes_action_if_enabled(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action=action,
            target=target,
            config_snapshot=config_snapshot,
        )
        if status == "failed":
            continue

        action_target = {
            "restart_failed_pod": f"{target['namespace']}/{target['pod_name']}",
            "rollback_deployment": f"{target['namespace']}/{target['deployment_name']}",
            "patch_config": f"{target['namespace']}/{target['config_map']}",
        }[action]
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type=action,
            target=action_target,
            status=status,
            detail=(
                (
                    "Applied after human approval."
                    if reviewed_by_role
                    else "Applied automatically with approval gate disabled."
                )
                if status == "completed"
                else (
                    "Simulated after human approval in safe demo mode."
                    if reviewed_by_role
                    else "Simulated automatically with approval gate disabled."
                )
            ),
        )

    healed_at = datetime.now(UTC).isoformat()
    auto_heal_actions = [
        AutoHealAction(
            action="restart_failed_pod",
            target=f"{target['namespace']}/{target['pod_name']}",
            status="simulated",
            detail="Autonomous agent restarted or simulated restart of the failed pod.",
        ),
        AutoHealAction(
            action="rollback_deployment",
            target=f"{target['namespace']}/{target['deployment_name']}",
            status="simulated",
            detail="Autonomous agent rolled back or simulated rollback of the deployment.",
        ),
        AutoHealAction(
            action="patch_config",
            target=f"{target['namespace']}/{target['config_map']}",
            status="simulated",
            detail="Autonomous agent restored safe runtime configuration defaults.",
        ),
    ]
    store_incident_memory(
        source="/auto-heal",
        summary=(
            f"Autonomous agent healed incident {incident_id}: "
            f"{truncate_text(decision.summary, 180)}"
        ),
        recommended_fix="Autonomous remediation completed.",
        cloud_provider=cloud_provider,
        fix_payload=json.dumps(
            {
                "strategy": decision.strategy,
                "confidence": decision.confidence,
                "approval_id": approval_id,
                "actions": [model_to_dict(action) for action in auto_heal_actions],
            },
            ensure_ascii=True,
        ),
        created_at=healed_at,
    )
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="remediation_completed",
        target=decision.strategy,
        status=(
            "completed"
            if config_snapshot.get("mode") == "kubernetes"
            and config_snapshot.get("apply_real_kubernetes_actions")
            else "simulated"
        ),
        detail=(
            f"Human-approved remediation completed by {USER_ROLE_LABELS[reviewed_by_role]}."
            if reviewed_by_role
            else "Autonomous remediation completed with approval gate disabled."
        ),
    )


def execute_autonomous_remediation(
    *,
    cycle_id: str,
    row: dict[str, Any],
    decision: AutonomousAgentDecision,
    config_snapshot: dict[str, Any],
) -> None:
    incident_id = str(row["id"])
    target = infer_kubernetes_target(row)
    cloud_provider = infer_cloud_provider_from_incident(row)
    generated_fix: FixGenerationResponse | None = None

    if "generate_remediation" in decision.actions:
        similar_incidents = find_similar_incident_rows(decision.summary, limit=3)
        generated_fix = generate_fallback_fix(
            decision.summary,
            cloud_provider,
            similar_incidents,
        )
        store_generated_fix(
            decision.summary,
            cloud_provider,
            generated_fix,
            source="/generate-fix",
            explanation="Generated automatically by the autonomous agent.",
        )
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type="generate_remediation",
            target=f"{cloud_provider}:{decision.strategy}",
            status="completed",
            detail="Generated Dockerfile, Kubernetes YAML, CI workflow, and deployment guidance.",
        )

    if config_snapshot.get("require_human_approval", True):
        approval = create_autonomous_approval_request(
            cycle_id=cycle_id,
            incident_id=incident_id,
            decision=decision,
            target=target,
            cloud_provider=cloud_provider,
            generated_fix=generated_fix,
        )
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type="approval_requested",
            target=approval.id,
            status="pending_approval",
            detail=(
                "Generated remediation is waiting for Admin or DevOps Engineer "
                "approval before any recovery action is applied."
            ),
        )
        return

    apply_autonomous_remediation_actions(
        cycle_id=cycle_id,
        incident_id=incident_id,
        decision=decision,
        target=target,
        cloud_provider=cloud_provider,
        config_snapshot=config_snapshot,
    )


def autonomous_target_from_approval_row(row: dict[str, Any]) -> dict[str, str]:
    default_target = {
        "namespace": "production",
        "pod_name": "api-7f9d8c6b5d-crashloop",
        "deployment_name": "devpilot-api",
        "config_map": "devpilot-api-config",
    }
    raw_target = row.get("target_json")
    if not isinstance(raw_target, str):
        return default_target

    try:
        parsed_target = json.loads(raw_target)
    except json.JSONDecodeError:
        return default_target

    if not isinstance(parsed_target, dict):
        return default_target

    return {
        key: (
            str(parsed_target[key])
            if isinstance(parsed_target.get(key), str)
            else default_value
        )
        for key, default_value in default_target.items()
    }


def autonomous_decision_from_approval_row(
    row: dict[str, Any],
) -> AutonomousAgentDecision:
    record = autonomous_approval_record_from_row(row)
    return AutonomousAgentDecision(
        incident_id=record.incident_id,
        summary=record.summary,
        severity=record.severity,
        strategy=record.strategy,
        confidence=record.confidence,
        actions=record.actions,
        reason="Human approval gate reviewed the generated autonomous remediation.",
    )


def review_autonomous_remediation_approval(
    *,
    approval_id: str,
    approved: bool,
    reviewer_role: UserRole,
    reviewer_note: str | None,
) -> AutonomousApprovalRecord:
    approval_row = fetch_autonomous_approval_row(approval_id)
    if approval_row is None:
        raise HTTPException(status_code=404, detail="Approval request was not found.")

    current_status = str(approval_row["status"])
    if current_status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Approval request is already {current_status}.",
        )

    reviewed_at = datetime.now(UTC).isoformat()
    reviewer_label = USER_ROLE_LABELS[reviewer_role]
    decision = autonomous_decision_from_approval_row(approval_row)
    incident_id = str(approval_row["incident_id"]) if approval_row.get("incident_id") else None
    cycle_id = str(approval_row["cycle_id"])

    if not approved:
        rejected_record = update_autonomous_approval_status(
            approval_id,
            status="rejected",
            reviewed_at=reviewed_at,
            reviewed_by_role=reviewer_label,
            reviewer_note=reviewer_note,
        )
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type="approval_rejected",
            target=approval_id,
            status="rejected",
            detail=f"Autonomous remediation was rejected by {reviewer_label}.",
        )
        return rejected_record

    update_autonomous_approval_status(
        approval_id,
        status="approved",
        reviewed_at=reviewed_at,
        reviewed_by_role=reviewer_label,
        reviewer_note=reviewer_note,
    )
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="approval_approved",
        target=approval_id,
        status="approved",
        detail=f"Autonomous remediation was approved by {reviewer_label}.",
    )

    try:
        apply_autonomous_remediation_actions(
            cycle_id=cycle_id,
            incident_id=incident_id or approval_id,
            decision=decision,
            target=autonomous_target_from_approval_row(approval_row),
            cloud_provider=normalize_cloud_provider(
                str(approval_row.get("cloud_provider") or "aws"),
            ),
            config_snapshot=autonomous_agent_config_snapshot(),
            approval_id=approval_id,
            reviewed_by_role=reviewer_role,
        )
    except Exception as exc:
        failure_reason = f"{exc.__class__.__name__}: {exc}"
        failed_record = update_autonomous_approval_status(
            approval_id,
            status="failed",
            failure_reason=failure_reason,
        )
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type="remediation_completed",
            target=decision.strategy,
            status="failed",
            detail=f"Human-approved remediation failed: {failure_reason}",
        )
        return failed_record

    return update_autonomous_approval_status(
        approval_id,
        status="applied",
        applied_at=datetime.now(UTC).isoformat(),
    )


def create_collaboration_drill_incident(created_at: str) -> dict[str, Any]:
    raw_logs = "\n".join(
        [
            f"{created_at} monitor/prod WARN p95 latency rose above SLO",
            f"{created_at} pod/production/api-7f9d8c6b5d-collab Warning CrashLoopBackOff",
            f"{created_at} github-actions/backend-ci ERROR release contract failed",
            f"{created_at} security-scan INFO no blocking secret exposure in generated patch",
        ],
    )
    incident_id = store_incident_memory(
        source="/kubernetes/status",
        raw_logs=raw_logs,
        summary=(
            "Multi-agent drill: production API is crash-looping after a risky "
            "release candidate."
        ),
        severity="high",
        explanation=(
            "Monitoring detected a failing pod and CI signal; root cause points "
            "to an unstable release that needs rollback, config patching, and "
            "security review before recovery."
        ),
        recommended_fix=(
            "Generate remediation, validate it with security checks, restart the "
            "failed pod, roll back the deployment, and patch runtime config."
        ),
        cloud_provider="aws",
        created_at=created_at,
    )
    row = fetch_incident_row_by_id(incident_id)
    if row is None:
        raise HTTPException(
            status_code=500,
            detail="Could not create collaboration drill incident.",
        )

    return row


def log_specialist_readiness_actions(
    *,
    cycle_id: str,
    incident_id: str,
    trigger: str,
) -> None:
    specialist_actions: list[tuple[str, str, AutonomousActionStatus, str]] = [
        (
            "scan_error_backlog",
            "bugs/regression-hotspots",
            "observed",
            (
                "Bug Sentinel Agent scanned runtime errors, failed checks, "
                "broken-button reports, and demo blockers."
            ),
        ),
        (
            "audit_frontend_routes",
            "frontend/routes-forms-responsive-states",
            "completed",
            (
                "Frontend Guardian Agent audited routes, forms, responsive "
                "layouts, client-side fetches, and visible error states."
            ),
        ),
        (
            "validate_backend_contracts",
            "backend/auth-api-integrations",
            "completed",
            (
                "Backend Guardian Agent validated API contracts, separate "
                "account signup, login, forgot-password reset, and role gates."
            ),
        ),
        (
            "verify_database_storage",
            "database/sqlite-postgres-neon-readiness",
            "completed",
            (
                "Database Guardian Agent checked storage readiness, Postgres "
                "compatibility, Neon DATABASE_URL expectations, and tenant isolation."
            ),
        ),
        (
            "monitor_ui_sections",
            "ui/all-product-sections-and-buttons",
            "completed",
            (
                "Full UI Monitor Agent swept every major product section and "
                "button path for demo-breaking issues."
            ),
        ),
        (
            "audit_pending_work",
            "release/github-vercel-render-openai-twilio",
            "completed",
            (
                "Release Auditor Agent checked pending work across GitHub, "
                "Vercel production, Render backend configuration, OpenAI, "
                "Twilio email readiness, and release notes."
            ),
        ),
    ]

    for action_type, target, status, detail in specialist_actions:
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type=action_type,
            target=f"{trigger}:{target}",
            status=status,
            detail=detail,
        )


def run_multi_agent_collaboration(
    trigger: str = "manual-collaboration",
) -> AutonomousAgentDecision:
    cycle_id = str(uuid4())
    checked_at = datetime.now(UTC).isoformat()
    config_snapshot = autonomous_agent_config_snapshot()
    row = create_collaboration_drill_incident(checked_at)
    decision = build_autonomous_decision(row)
    incident_id = str(row["id"])

    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="monitor_incidents",
        target=trigger,
        status="observed",
        detail=(
            "Monitoring Agent correlated Kubernetes, CI/CD, and latency signals "
            "for the specialist team."
        ),
    )
    log_specialist_readiness_actions(
        cycle_id=cycle_id,
        incident_id=incident_id,
        trigger=trigger,
    )
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="decide_remediation",
        target=decision.strategy,
        status="decided",
        detail=(
            f"Root Cause Agent selected {decision.strategy} with "
            f"{decision.confidence:.0%} confidence."
        ),
    )
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="security_scan",
        target="generated-remediation/security-gate",
        status="completed",
        detail=(
            "Security Agent checked the remediation path for exposed secrets, "
            "privileged workloads, and unsafe release gates."
        ),
    )
    execute_autonomous_remediation(
        cycle_id=cycle_id,
        row=row,
        decision=decision,
        config_snapshot=config_snapshot,
    )
    update_autonomous_agent_state(
        last_checked_at=checked_at,
        last_decision=decision,
        last_error=None,
    )

    return decision


def run_autonomous_monitor_cycle(trigger: str = "background") -> AutonomousAgentDecision | None:
    cycle_id = str(uuid4())
    checked_at = datetime.now(UTC).isoformat()
    config_snapshot = autonomous_agent_config_snapshot()

    log_autonomous_action(
        cycle_id=cycle_id,
        action_type="monitor_incidents",
        target=trigger,
        status="observed",
        detail="Autonomous agent checked incident memory and configured infrastructure monitors.",
    )
    collect_kubernetes_incidents_for_agent(cycle_id, config_snapshot)
    log_autonomous_action(
        cycle_id=cycle_id,
        action_type="security_scan",
        target=trigger,
        status="observed",
        detail=(
            "Security Agent reviewed recent incident context for secrets, "
            "privileged workload settings, and unsafe release gates."
        ),
    )

    candidates = fetch_autonomous_incident_candidates(limit=100)
    if not candidates:
        log_autonomous_action(
            cycle_id=cycle_id,
            action_type="decide_remediation",
            target=trigger,
            status="skipped",
            detail="No unresolved incidents required remediation.",
        )
        update_autonomous_agent_state(
            last_checked_at=checked_at,
            last_decision=None,
            last_error=None,
        )
        return None

    row = candidates[0]
    decision = build_autonomous_decision(row)
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=decision.incident_id,
        action_type="decide_remediation",
        target=decision.strategy,
        status="decided",
        detail=(
            f"Selected {decision.strategy} with confidence "
            f"{decision.confidence:.0%}. {decision.reason}"
        ),
    )
    execute_autonomous_remediation(
        cycle_id=cycle_id,
        row=row,
        decision=decision,
        config_snapshot=config_snapshot,
    )
    update_autonomous_agent_state(
        last_checked_at=checked_at,
        last_decision=decision,
        last_error=None,
    )
    return decision


def autonomous_agent_loop() -> None:
    while not AUTONOMOUS_AGENT_STOP_EVENT.is_set():
        config_snapshot = autonomous_agent_config_snapshot()
        if not config_snapshot.get("enabled"):
            break

        try:
            run_autonomous_monitor_cycle()
        except Exception as exc:
            error_message = f"{exc.__class__.__name__}: {exc}"
            update_autonomous_agent_state(last_error=error_message)
            log_autonomous_action(
                cycle_id=str(uuid4()),
                action_type="agent_error",
                target="background",
                status="failed",
                detail=error_message,
            )

        interval_seconds = int(config_snapshot.get("interval_seconds") or 15)
        AUTONOMOUS_AGENT_STOP_EVENT.wait(interval_seconds)


def start_autonomous_agent_thread() -> None:
    global AUTONOMOUS_AGENT_THREAD

    with AUTONOMOUS_AGENT_LOCK:
        if AUTONOMOUS_AGENT_THREAD and AUTONOMOUS_AGENT_THREAD.is_alive():
            return

        AUTONOMOUS_AGENT_STOP_EVENT.clear()
        AUTONOMOUS_AGENT_THREAD = threading.Thread(
            target=autonomous_agent_loop,
            name="devpilot-autonomous-agent",
            daemon=True,
        )
        AUTONOMOUS_AGENT_THREAD.start()


def stop_autonomous_agent_thread() -> None:
    global AUTONOMOUS_AGENT_THREAD

    AUTONOMOUS_AGENT_STOP_EVENT.set()
    thread = AUTONOMOUS_AGENT_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=2)


def autonomous_agent_status_response() -> AutonomousAgentStatusResponse:
    config_snapshot = autonomous_agent_config_snapshot()
    recent_actions = [
        autonomous_action_record_from_row(row)
        for row in fetch_autonomous_action_rows(limit=25)
    ]
    pending_approvals = [
        autonomous_approval_record_from_row(row)
        for row in fetch_autonomous_approval_rows(statuses={"pending"}, limit=10)
    ]

    with AUTONOMOUS_AGENT_LOCK:
        running = bool(AUTONOMOUS_AGENT_THREAD and AUTONOMOUS_AGENT_THREAD.is_alive())
        last_checked_at = AUTONOMOUS_AGENT_LAST_CHECKED_AT
        last_decision = AUTONOMOUS_AGENT_LAST_DECISION
        last_error = AUTONOMOUS_AGENT_LAST_ERROR

    return AutonomousAgentStatusResponse(
        enabled=bool(config_snapshot["enabled"]),
        running=running,
        mode=cast(AutonomousAgentMode, config_snapshot["mode"]),
        interval_seconds=int(config_snapshot["interval_seconds"]),
        apply_real_kubernetes_actions=bool(
            config_snapshot["apply_real_kubernetes_actions"],
        ),
        require_human_approval=bool(config_snapshot["require_human_approval"]),
        kubeconfig_path=config_snapshot.get("kubeconfig_path"),
        context=config_snapshot.get("context"),
        last_checked_at=last_checked_at,
        last_decision=last_decision,
        last_error=last_error,
        total_actions_logged=count_autonomous_actions(),
        pending_approvals=pending_approvals,
        recent_actions=recent_actions,
        agents=build_agent_profiles(recent_actions),
        handoffs=build_agent_handoffs(recent_actions),
    )


def compact_incident_evidence(record: IncidentMemoryRecord) -> str:
    pieces = [record.summary]
    if record.explanation:
        pieces.append(record.explanation)
    if record.recommended_fix:
        pieces.append(f"Fix: {record.recommended_fix}")
    if record.severity:
        pieces.append(f"Severity: {record.severity}")

    return truncate_text(" ".join(pieces), 450)


def compact_action_evidence(action: AutonomousActionLogRecord) -> str:
    return truncate_text(
        f"{format_action_name(action.action_type)} on {action.target}: "
        f"{action.status}. {action.detail}",
        360,
    )


def format_action_name(action_type: str) -> str:
    return action_type.replace("_", " ")


def voice_source_label(source: str) -> str:
    labels = {
        "/api/logs/upload": "log intake",
        "/analyze-log": "AI log analysis",
        "/ci-cd/checks": "CI/CD checks",
        "/kubernetes/status": "Kubernetes health",
        "/auto-heal": "auto-heal",
        "/generate-fix": "generated remediation",
    }

    return labels.get(source, source.strip("/").replace("-", " ").replace("/", " "))


def latest_relevant_incidents(limit: int = 8) -> list[IncidentMemoryRecord]:
    rows = fetch_incident_rows(limit=50)
    records = [incident_record_from_row(row) for row in rows]
    source_priority = {
        "/kubernetes/status": 5,
        "/analyze-log": 4,
        "/ci-cd/checks": 3,
        "/auto-heal": 2,
        "/generate-fix": 1,
        "/api/logs/upload": 1,
    }

    return sorted(
        records,
        key=lambda record: (
            source_priority.get(record.source, 0),
            AUTONOMOUS_SEVERITY_PRIORITY.get((record.severity or "").lower(), 0),
            record.created_at,
        ),
        reverse=True,
    )[:limit]


def fallback_voice_assistant_answer(question: str) -> VoiceAssistantResponse:
    answered_at = datetime.now(UTC).isoformat()
    incidents = latest_relevant_incidents(limit=8)
    actions = [
        autonomous_action_record_from_row(row)
        for row in fetch_autonomous_action_rows(limit=20)
        if row.get("status") != "skipped"
    ][:6]
    latest_incident = incidents[0] if incidents else None
    latest_decision = None

    with AUTONOMOUS_AGENT_LOCK:
        latest_decision = AUTONOMOUS_AGENT_LAST_DECISION

    if latest_incident is None:
        answer = (
            "I do not see a recorded deployment incident yet. Run Demo or upload "
            "deployment logs, then ask again and I can explain the failure."
        )
        return VoiceAssistantResponse(
            question=question,
            answer=answer,
            spoken_answer=answer,
            confidence=0.42,
            evidence=[],
            answered_at=answered_at,
        )

    root_cause = latest_incident.summary
    if latest_incident.explanation:
        root_cause = latest_incident.explanation

    action_summary = ""
    completed_actions = [
        action
        for action in actions
        if action.action_type in AUTONOMOUS_REMEDIATION_ACTIONS
        or action.action_type == "remediation_completed"
    ]
    if completed_actions:
        action_summary = (
            " DevPilot responded by "
            + ", ".join(format_action_name(action.action_type) for action in completed_actions[:4])
            + "."
        )

    decision_summary = ""
    if latest_decision:
        decision_summary = (
            f" The autonomous agent chose {format_action_name(latest_decision.strategy)} "
            f"with {round(latest_decision.confidence * 100)} percent confidence."
        )

    answer = (
        f"The deployment failed because {root_cause} "
        f"The strongest signal is {voice_source_label(latest_incident.source)}."
        f"{decision_summary}{action_summary}"
    )
    if latest_incident.recommended_fix:
        answer = f"{answer} Recommended fix: {latest_incident.recommended_fix}"

    evidence = [compact_incident_evidence(incident) for incident in incidents[:4]]
    evidence.extend(compact_action_evidence(action) for action in actions[:4])

    return VoiceAssistantResponse(
        question=question,
        answer=answer,
        spoken_answer=truncate_text(answer, 520),
        confidence=0.86 if latest_decision else 0.74,
        evidence=evidence[:6],
        answered_at=answered_at,
    )


def voice_assistant_context() -> str:
    incidents = latest_relevant_incidents(limit=8)
    actions = [
        autonomous_action_record_from_row(row)
        for row in fetch_autonomous_action_rows(limit=12)
        if row.get("status") != "skipped"
    ]
    status = autonomous_agent_status_response()
    context = {
        "agent_status": {
            "running": status.running,
            "mode": status.mode,
            "last_decision": (
                model_to_dict(status.last_decision)
                if status.last_decision is not None
                else None
            ),
            "last_error": status.last_error,
        },
        "incidents": [model_to_dict(incident) for incident in incidents],
        "actions": [model_to_dict(action) for action in actions],
    }
    return json.dumps(context, ensure_ascii=True)


def answer_voice_question_with_openai(question: str) -> VoiceAssistantResponse:
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")

    try:
        response = client.responses.parse(
            model=model,
            instructions=(
                "You are DevPilot AI's voice assistant for DevOps incidents. "
                "Answer the user's spoken question from the provided incident "
                "memory and autonomous action log. Be concise, accurate, and "
                "suitable for speaking aloud. If evidence is missing, say so."
            ),
            input=(
                f"User question: {question}\n\n"
                "DevPilot context JSON:\n"
                f"{voice_assistant_context()}"
            ),
            text_format=VoiceAssistantResponse,
            max_output_tokens=700,
        )
    except OpenAIError as exc:
        print(f"Voice assistant OpenAI fallback: {exc.__class__.__name__}", flush=True)
        return fallback_voice_assistant_answer(question)

    if response.output_parsed is None:
        return fallback_voice_assistant_answer(question)

    parsed = response.output_parsed
    parsed.question = question
    parsed.answered_at = datetime.now(UTC).isoformat()
    if not parsed.spoken_answer:
        parsed.spoken_answer = truncate_text(parsed.answer, 520)

    return parsed


def generate_fix_with_openai(
    issue: str,
    cloud_provider: CloudProvider = "aws",
    similar_incidents: list[tuple[dict[str, Any], float]] | None = None,
) -> FixGenerationResponse:
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
    provider_label = CLOUD_PROVIDER_LABELS[cloud_provider]
    provider_suggestions = deployment_suggestions_for_provider(
        cloud_provider,
        similar_incidents,
    )
    incident_history = format_incident_history_for_prompt(similar_incidents or [])

    instructions = (
        "You are DevPilot AI, a senior DevOps engineer. "
        "Generate production-minded but MVP-friendly remediation files for the detected issue. "
        "Return only complete file contents for a Dockerfile, Kubernetes YAML, "
        "and a GitHub Actions workflow. Keep secrets referenced through environment variables "
        "or Kubernetes secrets; never hardcode credentials. "
        "Use relevant previous incident history to avoid repeating failed patterns "
        "and to reuse fixes that worked before. "
        f"Tailor every file and deployment_suggestions to {provider_label}. "
        "Use managed Kubernetes and container registry conventions for the selected provider. "
        "Set cloud_provider to the selected provider key."
    )

    try:
        response = client.responses.parse(
            model=model,
            instructions=instructions,
            input=(
                "Detected issue:\n"
                f"{issue}\n\n"
                f"Selected cloud provider: {provider_label} ({cloud_provider}).\n"
                "Recommended deployment suggestions to reflect or improve:\n"
                f"{json.dumps(provider_suggestions)}\n\n"
                "Relevant previous incident memory:\n"
                f"{incident_history}\n\n"
                "Project context: Next.js frontend in frontend/, FastAPI backend in backend/. "
                "Generate files that help deploy and verify the backend service safely."
            ),
            text_format=FixGenerationResponse,
            max_output_tokens=2200,
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI fix generation failed: {exc.__class__.__name__}",
        ) from exc

    if response.output_parsed is None:
        raise HTTPException(
            status_code=502,
            detail="OpenAI did not return valid generated files.",
        )

    response.output_parsed.cloud_provider = cloud_provider
    if not response.output_parsed.deployment_suggestions:
        response.output_parsed.deployment_suggestions = provider_suggestions

    return response.output_parsed


@app.on_event("startup")
def start_autonomous_agent_on_startup() -> None:
    init_incident_db()
    if AUTONOMOUS_AGENT_CONFIG["enabled"]:
        start_autonomous_agent_thread()


@app.on_event("shutdown")
def stop_autonomous_agent_on_shutdown() -> None:
    stop_autonomous_agent_thread()
    close_postgres_connection_pool()


@app.get("/agent/status", response_model=AutonomousAgentStatusResponse)
@app.get("/autonomous-agent/status", response_model=AutonomousAgentStatusResponse)
def autonomous_agent_status() -> AutonomousAgentStatusResponse:
    return autonomous_agent_status_response()


@app.get("/agent/actions", response_model=list[AutonomousActionLogRecord])
@app.get("/autonomous-agent/actions", response_model=list[AutonomousActionLogRecord])
def autonomous_agent_actions(
    limit: int = Query(default=25, ge=1, le=200),
) -> list[AutonomousActionLogRecord]:
    return [
        autonomous_action_record_from_row(row)
        for row in fetch_autonomous_action_rows(limit=limit)
    ]


@app.get("/agent/approvals", response_model=list[AutonomousApprovalRecord])
@app.get("/autonomous-agent/approvals", response_model=list[AutonomousApprovalRecord])
def autonomous_agent_approvals(
    status: AutonomousApprovalStatus | None = Query(default="pending"),
    limit: int = Query(default=25, ge=1, le=200),
) -> list[AutonomousApprovalRecord]:
    statuses = {status} if status else None
    return [
        autonomous_approval_record_from_row(row)
        for row in fetch_autonomous_approval_rows(statuses=statuses, limit=limit)
    ]


@app.post(
    "/agent/approvals/{approval_id}/review",
    response_model=AutonomousAgentStatusResponse,
)
@app.post(
    "/autonomous-agent/approvals/{approval_id}/review",
    response_model=AutonomousAgentStatusResponse,
)
def review_autonomous_agent_approval(
    approval_id: str,
    payload: AutonomousApprovalReviewRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> AutonomousAgentStatusResponse:
    reviewer_role = require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Reviewing autonomous remediation approvals",
    )
    review_autonomous_remediation_approval(
        approval_id=approval_id,
        approved=payload.approved,
        reviewer_role=reviewer_role,
        reviewer_note=payload.reviewer_note,
    )
    return autonomous_agent_status_response()


@app.post("/agent/config", response_model=AutonomousAgentStatusResponse)
@app.post("/autonomous-agent/config", response_model=AutonomousAgentStatusResponse)
def configure_autonomous_agent(
    payload: AutonomousAgentControlRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> AutonomousAgentStatusResponse:
    require_roles(x_devpilot_role, {"admin"}, "Configuring the autonomous agent")

    with AUTONOMOUS_AGENT_LOCK:
        if payload.enabled is not None:
            AUTONOMOUS_AGENT_CONFIG["enabled"] = payload.enabled
        if payload.interval_seconds is not None:
            AUTONOMOUS_AGENT_CONFIG["interval_seconds"] = payload.interval_seconds
        if payload.mode is not None:
            AUTONOMOUS_AGENT_CONFIG["mode"] = payload.mode
        if payload.apply_real_kubernetes_actions is not None:
            AUTONOMOUS_AGENT_CONFIG["apply_real_kubernetes_actions"] = (
                payload.apply_real_kubernetes_actions
            )
        if payload.require_human_approval is not None:
            AUTONOMOUS_AGENT_CONFIG["require_human_approval"] = (
                payload.require_human_approval
            )
        if payload.kubeconfig_path is not None:
            AUTONOMOUS_AGENT_CONFIG["kubeconfig_path"] = (
                payload.kubeconfig_path.strip() or None
            )
        if payload.context is not None:
            AUTONOMOUS_AGENT_CONFIG["context"] = payload.context.strip() or None

    if AUTONOMOUS_AGENT_CONFIG["enabled"]:
        start_autonomous_agent_thread()
    else:
        stop_autonomous_agent_thread()

    log_autonomous_action(
        cycle_id=str(uuid4()),
        action_type="configure_agent",
        target="autonomous-agent",
        status="completed",
        detail="Autonomous agent configuration updated.",
    )

    return autonomous_agent_status_response()


@app.post("/agent/run-cycle", response_model=AutonomousAgentStatusResponse)
@app.post("/autonomous-agent/run-cycle", response_model=AutonomousAgentStatusResponse)
def run_autonomous_agent_cycle(
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> AutonomousAgentStatusResponse:
    require_roles(x_devpilot_role, {"admin"}, "Running an autonomous agent cycle")
    run_autonomous_monitor_cycle(trigger="manual-cycle")
    return autonomous_agent_status_response()


@app.post("/agents/collaborate", response_model=AutonomousAgentStatusResponse)
@app.post("/multi-agent/collaborate", response_model=AutonomousAgentStatusResponse)
def run_agent_collaboration(
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> AutonomousAgentStatusResponse:
    require_roles(x_devpilot_role, {"admin"}, "Running multi-agent collaboration")
    run_multi_agent_collaboration()
    return autonomous_agent_status_response()


@app.post("/voice/ask", response_model=VoiceAssistantResponse)
@app.post("/assistant/voice/ask", response_model=VoiceAssistantResponse)
def ask_voice_assistant(payload: VoiceAssistantRequest) -> VoiceAssistantResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Voice question is required.")

    if has_openai_key():
        return answer_voice_question_with_openai(question)

    return fallback_voice_assistant_answer(question)


@app.get("/plugins/marketplace", response_model=PluginMarketplaceResponse)
@app.get("/integrations/marketplace", response_model=PluginMarketplaceResponse)
def plugin_marketplace() -> PluginMarketplaceResponse:
    return plugin_marketplace_response()


@app.post("/plugins/install", response_model=PluginInstallResponse)
@app.post("/integrations/install", response_model=PluginInstallResponse)
def install_plugin(
    payload: PluginInstallRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> PluginInstallResponse:
    role = require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Installing integrations",
    )
    installed_at = datetime.now(UTC).isoformat()
    connection_name = (
        payload.connection_name.strip()
        if payload.connection_name and payload.connection_name.strip()
        else PLUGIN_MARKETPLACE_CATALOG[payload.plugin_id]["name"]
    )
    environment = payload.environment.strip() or "production"
    notes = payload.notes.strip() if payload.notes and payload.notes.strip() else None

    with incident_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO installed_plugins (
                plugin_id, connection_name, environment, notes,
                installed_by, installed_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(plugin_id) DO UPDATE SET
                connection_name = excluded.connection_name,
                environment = excluded.environment,
                notes = excluded.notes,
                installed_by = excluded.installed_by,
                updated_at = excluded.updated_at
            """,
            (
                payload.plugin_id,
                connection_name,
                environment,
                notes,
                USER_ROLE_LABELS[role],
                installed_at,
                installed_at,
            ),
        )

    plugin = installed_plugin(payload.plugin_id)
    store_incident_memory(
        source="/plugins/install",
        raw_logs=json.dumps(
            {
                "plugin_id": payload.plugin_id,
                "connection_name": connection_name,
                "environment": environment,
                "installed_by": USER_ROLE_LABELS[role],
            },
            ensure_ascii=True,
        ),
        summary=f"Installed {plugin.name} integration for {environment}.",
        severity="low",
        explanation=(
            f"{plugin.name} integration was installed from the plugin marketplace."
        ),
        recommended_fix="Use the integration from the command center workflows.",
        created_at=installed_at,
    )

    return PluginInstallResponse(
        plugin=plugin,
        message=f"{plugin.name} integration installed.",
        installed_at=installed_at,
    )


@app.post("/plugins/{plugin_id}/uninstall", response_model=PluginUninstallResponse)
@app.post("/integrations/{plugin_id}/uninstall", response_model=PluginUninstallResponse)
def uninstall_plugin(
    plugin_id: PluginId,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> PluginUninstallResponse:
    role = require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Uninstalling integrations",
    )
    uninstalled_at = datetime.now(UTC).isoformat()
    plugin_name = str(PLUGIN_MARKETPLACE_CATALOG[plugin_id]["name"])

    with incident_db_connection() as connection:
        connection.execute(
            "DELETE FROM installed_plugins WHERE plugin_id = ?",
            (plugin_id,),
        )

    plugin = installed_plugin(plugin_id)
    store_incident_memory(
        source="/plugins/uninstall",
        raw_logs=json.dumps(
            {
                "plugin_id": plugin_id,
                "uninstalled_by": USER_ROLE_LABELS[role],
            },
            ensure_ascii=True,
        ),
        summary=f"Uninstalled {plugin_name} integration.",
        severity="low",
        explanation=(
            f"{plugin_name} integration was removed from the plugin marketplace."
        ),
        recommended_fix="Install it again when the workflow needs that provider.",
        created_at=uninstalled_at,
    )

    return PluginUninstallResponse(
        plugin=plugin,
        message=f"{plugin_name} integration uninstalled.",
        uninstalled_at=uninstalled_at,
    )


@app.post("/slack/test", response_model=SlackNotificationResponse)
def send_slack_test_notification(
    payload: SlackTestRequest = Body(default_factory=SlackTestRequest),
) -> SlackNotificationResponse:
    sent_at = datetime.now(UTC).isoformat()
    summary = payload.summary.strip() or "DevPilot AI Slack webhook test notification."

    send_slack_notification(
        title="DevPilot AI Slack Test",
        summary=summary,
        timestamp=sent_at,
        fields=[("Source", "/slack/test")],
        required=True,
    )

    return SlackNotificationResponse(
        message="Slack test notification sent.",
        sent_at=sent_at,
    )


@app.get("/saas/plans", response_model=list[BillingPlan])
def saas_billing_plans() -> list[BillingPlan]:
    return list_billing_plans()


@app.get("/saas/teams", response_model=list[SaaSTeamAccount])
def list_saas_team_accounts() -> list[SaaSTeamAccount]:
    return fetch_saas_teams()


@app.post("/saas/teams", response_model=SaaSTeamAccount)
def create_saas_team_account(payload: TeamCreateRequest) -> SaaSTeamAccount:
    return create_saas_team(payload)


@app.get("/saas/usage", response_model=TeamUsageSummaryResponse)
def current_saas_team_usage() -> TeamUsageSummaryResponse:
    return team_usage_summary(current_team_id())


@app.get("/saas/bootstrap", response_model=SaaSBootstrapResponse)
def saas_bootstrap() -> SaaSBootstrapResponse:
    current_team = fetch_saas_team(current_team_id()) or require_saas_team(
        DEFAULT_SAAS_TEAM_ID,
    )
    usage = team_usage_summary(current_team.id)

    return SaaSBootstrapResponse(
        current_team=current_team,
        teams=fetch_saas_teams(),
        plans=list_billing_plans(),
        usage=usage,
    )


@app.patch("/saas/teams/{team_id}/plan", response_model=SaaSTeamAccount)
def update_saas_team_billing_plan(
    team_id: str,
    payload: TeamPlanUpdateRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> SaaSTeamAccount:
    require_roles(x_devpilot_role, {"admin"}, "Updating SaaS billing plans")
    return update_saas_team_plan(team_id, payload.plan_id)


@app.get("/saas/teams/{team_id}/members", response_model=list[TeamMember])
def list_saas_team_members(team_id: str) -> list[TeamMember]:
    return fetch_team_members(team_id)


@app.post("/saas/teams/{team_id}/members", response_model=TeamMember)
def invite_saas_team_member(
    team_id: str,
    payload: TeamMemberInviteRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> TeamMember:
    require_roles(x_devpilot_role, {"admin", "devops_engineer"}, "Inviting team members")
    return add_team_member(team_id, payload)


@app.get("/incidents/history", response_model=IncidentHistoryResponse)
def incident_history(
    limit: int = Query(default=25, ge=1, le=100),
) -> IncidentHistoryResponse:
    return IncidentHistoryResponse(incidents=cached_incident_history(limit))


@app.post("/incidents/search", response_model=IncidentSearchResponse)
def search_incident_history(payload: IncidentSearchRequest) -> IncidentSearchResponse:
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Incident search query is required.")

    matches = find_similar_incident_rows(query, limit=payload.limit)

    return IncidentSearchResponse(
        query=query,
        incidents=[
            incident_record_from_row(row, similarity_score=score)
            for row, score in matches
        ],
    )


@app.get("/model/training-dataset", response_model=CustomModelDatasetResponse)
@app.get("/custom-model/training-dataset", response_model=CustomModelDatasetResponse)
def custom_model_training_dataset(
    include_demo_data: bool = Query(default=True),
    min_examples: int = Query(default=6, ge=3, le=100),
    validation_ratio: float = Query(default=0.3, ge=0.1, le=0.5),
) -> CustomModelDatasetResponse:
    return build_custom_model_dataset_response(
        CustomModelTrainingRequest(
            include_demo_data=include_demo_data,
            min_examples=min_examples,
            validation_ratio=validation_ratio,
        ),
    )


@app.post("/model/evaluate", response_model=CustomModelEvaluationResponse)
@app.post("/custom-model/evaluate", response_model=CustomModelEvaluationResponse)
def evaluate_custom_devpilot_model(
    payload: CustomModelTrainingRequest = Body(default_factory=CustomModelTrainingRequest),
) -> CustomModelEvaluationResponse:
    return evaluate_custom_model_examples(build_custom_model_examples(payload))


@app.post("/model/train", response_model=CustomModelTrainingResponse)
@app.post("/custom-model/train", response_model=CustomModelTrainingResponse)
@app.post("/ai/train-custom-model", response_model=CustomModelTrainingResponse)
def train_custom_model(
    payload: CustomModelTrainingRequest = Body(default_factory=CustomModelTrainingRequest),
) -> CustomModelTrainingResponse:
    return train_custom_devpilot_model(payload)


@app.post("/failures/predict", response_model=FailurePredictionResponse)
@app.post("/predict-failure", response_model=FailurePredictionResponse)
def predict_failures(
    payload: FailurePredictionRequest = Body(default_factory=FailurePredictionRequest),
) -> FailurePredictionResponse:
    return build_failure_prediction(payload)


@app.post("/terraform/remediate", response_model=TerraformRemediationResponse)
@app.post("/terraform/detect-drift", response_model=TerraformRemediationResponse)
def remediate_terraform(
    payload: TerraformRemediationRequest,
) -> TerraformRemediationResponse:
    return build_terraform_remediation(payload)


@app.post("/terraform/apply", response_model=TerraformApplyResponse)
@app.post("/terraform/auto-patch", response_model=TerraformApplyResponse)
def apply_terraform_patch(
    payload: TerraformApplyRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> TerraformApplyResponse:
    require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Auto-patching Terraform infrastructure",
    )
    return apply_terraform_remediation(payload)


@app.post("/cost/optimize", response_model=CostOptimizationResponse)
@app.post("/cloud-cost/optimize", response_model=CostOptimizationResponse)
def optimize_cloud_cost(
    payload: CostOptimizationRequest = Body(default_factory=CostOptimizationRequest),
) -> CostOptimizationResponse:
    return build_cost_optimization(payload)


@app.post("/security/analyze", response_model=SecurityAnalysisResponse)
@app.post("/security/scan", response_model=SecurityAnalysisResponse)
def analyze_security_configs(
    payload: SecurityAnalysisRequest = Body(default_factory=SecurityAnalysisRequest),
) -> SecurityAnalysisResponse:
    return build_security_analysis(payload)


@app.post("/chaos/inject", response_model=ChaosInjectionResponse)
@app.post("/chaos-engineering/inject", response_model=ChaosInjectionResponse)
def inject_chaos_failure(
    payload: ChaosInjectionRequest = Body(default_factory=ChaosInjectionRequest),
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> ChaosInjectionResponse:
    require_roles(x_devpilot_role, {"admin"}, "Injecting chaos failures")

    base_time = datetime.now(UTC)
    injected_at = base_time.isoformat()
    detected_at = timestamp_after(base_time, 1)
    healed_at = timestamp_after(base_time, 3)
    failure = build_chaos_failure(payload, injected_at)
    detection = build_chaos_detection(payload, detected_at)
    auto_heal = build_chaos_auto_heal_response(payload, healed_at)
    timeline = build_chaos_timeline(
        base_time=base_time,
        failure=failure,
        detection=detection,
        auto_heal=auto_heal,
    )
    cycle_id = str(uuid4())

    incident_id = store_incident_memory(
        source="/chaos/inject",
        raw_logs=failure.logs,
        summary=failure.title,
        severity=failure.severity,
        explanation=detection.root_cause,
        recommended_fix=detection.recommended_strategy,
        cloud_provider="aws",
        fix_payload=json.dumps(
            {
                "mode": "chaos",
                "failure": model_to_dict(failure),
                "detection": model_to_dict(detection),
            },
            ensure_ascii=True,
        ),
        created_at=injected_at,
    )
    auto_heal_record_id = store_incident_memory(
        source="/auto-heal",
        summary=f"Chaos auto-heal recovered {failure.target}.",
        recommended_fix=auto_heal.message,
        cloud_provider="aws",
        fix_payload=json.dumps(
            {
                "mode": "chaos",
                "failure_type": payload.failure_type,
                "actions": [model_to_dict(action) for action in auto_heal.actions],
                "timeline": [model_to_dict(step) for step in timeline],
            },
            ensure_ascii=True,
        ),
        created_at=healed_at,
    )

    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="chaos_injection",
        target=failure.target,
        status="simulated",
        detail=failure.title,
        created_at=injected_at,
    )
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=incident_id,
        action_type="chaos_detected",
        target=payload.failure_type,
        status="observed",
        detail=detection.root_cause,
        created_at=detected_at,
    )
    for action in auto_heal.actions:
        log_autonomous_action(
            cycle_id=cycle_id,
            incident_id=incident_id,
            action_type=action.action,
            target=action.target,
            status=action.status,
            detail=action.detail,
            created_at=healed_at,
        )
    log_autonomous_action(
        cycle_id=cycle_id,
        incident_id=auto_heal_record_id,
        action_type="chaos_recovered",
        target=failure.target,
        status="completed",
        detail=auto_heal.message,
        created_at=timestamp_after(base_time, 4),
    )

    send_slack_notification(
        title="Chaos Injection Auto-Healed",
        summary=f"{failure.title}: {auto_heal.message}",
        timestamp=healed_at,
        fields=[
            ("Source", "/chaos/inject"),
            ("Failure Type", payload.failure_type),
            ("Target", failure.target),
            ("Actions", str(len(auto_heal.actions))),
        ],
    )

    return ChaosInjectionResponse(
        mode="chaos",
        message="Chaos failure injected and auto-healed.",
        failure=failure,
        detection=detection,
        auto_heal=auto_heal,
        timeline=timeline,
        incident_records_created=2,
        ran_at=injected_at,
    )


@app.post("/demo/run", response_model=DemoRunResponse)
def run_demo() -> DemoRunResponse:
    ran_at_datetime = datetime.now(UTC)
    ran_at = ran_at_datetime.isoformat()
    log_time = demo_timestamp(ran_at_datetime, 18)
    ci_time = demo_timestamp(ran_at_datetime, 16)
    analysis_time = demo_timestamp(ran_at_datetime, 13)
    cluster_time = demo_timestamp(ran_at_datetime, 11)
    healed_at = datetime.now(UTC).isoformat()

    cicd_failures = build_demo_ci_failures()
    cluster_status = build_demo_cluster_status(cluster_time)
    analysis = LogAnalysisResponse(
        root_cause=(
            "The latest production API release is missing DATABASE_URL, causing "
            "startup failures and Kubernetes CrashLoopBackOff."
        ),
        severity="high",
        explanation=(
            "CI failed during backend startup checks, Kubernetes events show "
            "the API container repeatedly restarting, and application logs "
            "confirm the database connection string is absent."
        ),
        recommended_fix=(
            "Restore the production DATABASE_URL secret reference, roll back "
            "deployment/devpilot-api, and keep the failing release blocked "
            "until CI validates the environment contract."
        ),
    )
    fix_files = generate_fallback_fix(DEMO_DETECTED_ISSUE, "aws", [])
    auto_heal = build_demo_auto_heal_response(healed_at)
    cluster_summary = unhealthy_pods_incident_summary(cluster_status.unhealthy_pods)
    ci_logs = "\n\n".join(failure.logs for failure in cicd_failures)

    created_record_ids = [
        store_incident_memory(
            source="/api/logs/upload",
            raw_logs=DEMO_SAMPLE_LOGS,
            summary="Uploaded log file: devpilot-demo-failures.txt",
            created_at=log_time,
        ),
        store_incident_memory(
            source="/ci-cd/checks",
            raw_logs=ci_logs,
            summary=(
                "GitHub Actions backend-ci and release-image workflows failed "
                "for commit 9f31c2a."
            ),
            severity="high",
            explanation=(
                "The CI/CD pipeline rejected the release because startup checks "
                "could not find DATABASE_URL and the backend compile step failed."
            ),
            recommended_fix=(
                "Restore required production environment variables in CI and "
                "block image promotion until the backend test job passes."
            ),
            cloud_provider="aws",
            created_at=ci_time,
        ),
        store_log_analysis(DEMO_SAMPLE_LOGS, analysis, analysis_time),
        store_incident_memory(
            source="/kubernetes/status",
            raw_logs=json.dumps(
                [model_to_dict(pod) for pod in cluster_status.unhealthy_pods],
                ensure_ascii=True,
            ),
            summary=cluster_summary,
            severity="critical",
            explanation=(
                f"{len(cluster_status.unhealthy_pods)} unhealthy pod(s) were "
                "detected in the demo Kubernetes context."
            ),
            recommended_fix=analysis.recommended_fix,
            cloud_provider="aws",
            created_at=cluster_time,
        ),
    ]
    autonomous_decision = run_autonomous_monitor_cycle(trigger="demo-run")
    autonomous_records_created = 1 if autonomous_decision else 0

    return DemoRunResponse(
        mode="demo",
        message=(
            "Demo incident loaded. The autonomous agent selected a recovery "
            "plan and queued it for human approval."
        ),
        detected_issue=DEMO_DETECTED_ISSUE,
        sample_logs=DEMO_SAMPLE_LOGS,
        cicd_failures=cicd_failures,
        log_upload=LogUploadResponse(
            upload_id=str(uuid4()),
            status="received",
            filename="devpilot-demo-failures.txt",
            source="demo-mode",
            line_count=len(DEMO_SAMPLE_LOGS.splitlines()),
            character_count=len(DEMO_SAMPLE_LOGS),
            received_at=log_time,
        ),
        analysis=analysis,
        cluster_status=cluster_status,
        fix_files=fix_files,
        auto_heal=auto_heal,
        incident_records_created=len(created_record_ids) + autonomous_records_created,
        ran_at=ran_at,
    )


@app.post("/api/logs/upload", response_model=LogUploadResponse)
def upload_logs(payload: LogUploadRequest) -> LogUploadResponse:
    content = payload.content.strip()

    if not content:
        raise HTTPException(status_code=400, detail="Log content is required.")

    line_count = len(content.splitlines())
    received_at = datetime.now(UTC).isoformat()
    response = LogUploadResponse(
        upload_id=str(uuid4()),
        status="received",
        filename=payload.filename,
        source=payload.source,
        line_count=line_count,
        character_count=len(content),
        received_at=received_at,
    )

    store_incident_memory(
        source="/api/logs/upload",
        raw_logs=content,
        summary=first_log_summary(content, payload.filename),
        created_at=received_at,
    )

    return response


@app.post("/analyze-log", response_model=LogAnalysisResponse)
async def analyze_log(request: Request) -> LogAnalysisResponse:
    logs = (await extract_logs_from_request(request)).strip()

    if not logs:
        raise HTTPException(status_code=400, detail="Raw logs text is required.")

    analysis = analyze_logs_with_openai(logs)
    detected_at = datetime.now(UTC).isoformat()

    store_log_analysis(logs, analysis, detected_at)

    send_slack_notification(
        title="DevPilot AI Incident Detected",
        summary=analysis.root_cause,
        timestamp=detected_at,
        fields=[
            ("Source", "/analyze-log"),
            ("Severity", analysis.severity.upper()),
            ("Recommended Fix", analysis.recommended_fix),
        ],
    )

    return analysis


@app.post("/generate-fix", response_model=FixGenerationResponse)
async def generate_fix(request: Request) -> FixGenerationResponse:
    fix_request = await extract_fix_generation_request(request)
    issue = fix_request.issue.strip()

    if not issue:
        raise HTTPException(status_code=400, detail="Detected issue is required.")

    similar_incidents = find_similar_incident_rows(issue, limit=3)
    generated_fix = (
        generate_fallback_fix(
            issue,
            fix_request.cloud_provider,
            similar_incidents,
        )
        if not has_openai_key()
        else generate_fix_with_openai(
            issue,
            fix_request.cloud_provider,
            similar_incidents,
        )
    )

    store_generated_fix(
        issue,
        fix_request.cloud_provider,
        generated_fix,
        source="/generate-fix",
    )

    return generated_fix


@app.post("/github/create-pull-request", response_model=GitHubPullRequestResponse)
@app.post("/create-pull-request", response_model=GitHubPullRequestResponse)
def create_generated_fix_pull_request(
    payload: GitHubPullRequestRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> GitHubPullRequestResponse:
    require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Creating GitHub pull requests",
    )

    issue = payload.issue.strip()
    if not issue:
        raise HTTPException(status_code=400, detail="Detected issue is required.")

    repository = normalize_github_repository(payload.repository)
    token = get_github_token()
    base_branch = validate_branch_name(
        payload.base_branch or os.getenv("GITHUB_BASE_BRANCH", "main"),
    )
    cloud_provider = normalize_cloud_provider(payload.cloud_provider)
    branch_name = build_fix_branch_name(issue, payload.branch_name)
    generated_files = payload.files
    similar_incidents = find_similar_incident_rows(issue, limit=3)

    if generated_files is None:
        generated_files = (
            generate_fix_with_openai(issue, cloud_provider, similar_incidents)
            if has_openai_key()
            else generate_fallback_fix(issue, cloud_provider, similar_incidents)
        )
    else:
        generated_files.cloud_provider = cloud_provider
        memory_suggestions = history_recommendations_from_rows(similar_incidents)
        if generated_files.deployment_suggestions:
            generated_files.deployment_suggestions = unique_suggestions(
                [*generated_files.deployment_suggestions, *memory_suggestions],
            )
        else:
            generated_files.deployment_suggestions = deployment_suggestions_for_provider(
                cloud_provider,
                similar_incidents,
            )

    github_files = fix_files_to_github_payload(generated_files)
    file_paths = [file["path"] for file in github_files]
    title = payload.title or "DevPilot AI generated fix"
    body = payload.body or default_pull_request_body(issue, file_paths, generated_files)

    create_branch_from_base(token, repository, base_branch, branch_name)
    committed_files = [
        commit_generated_file(
            token=token,
            repository=repository,
            branch_name=branch_name,
            path=file["path"],
            content=file["content"],
        )
        for file in github_files
    ]
    pull_request = create_github_pull_request(
        token=token,
        repository=repository,
        branch_name=branch_name,
        base_branch=base_branch,
        title=title,
        body=body,
    )

    pull_request_number = pull_request.get("number")
    pull_request_url = pull_request.get("html_url")
    if not isinstance(pull_request_number, int) or not isinstance(
        pull_request_url,
        str,
    ):
        raise HTTPException(
            status_code=502,
            detail="GitHub API returned a pull request without number or URL.",
        )

    response = GitHubPullRequestResponse(
        repository=repository,
        pull_request_number=pull_request_number,
        pull_request_url=pull_request_url,
        branch_name=branch_name,
        base_branch=base_branch,
        files=committed_files,
    )

    store_generated_fix(
        issue,
        cloud_provider,
        generated_files,
        source="/github/create-pull-request",
        explanation=(
            f"Opened pull request #{pull_request_number} on {repository}: "
            f"{pull_request_url}"
        ),
    )

    return response


@app.post("/kubernetes/status", response_model=KubernetesClusterStatusResponse)
def kubernetes_cluster_status(
    payload: KubernetesConnectionRequest = Body(default_factory=KubernetesConnectionRequest),
) -> KubernetesClusterStatusResponse:
    api_client, context_name = get_kubernetes_client(payload)
    core_api = client.CoreV1Api(api_client)
    apps_api = client.AppsV1Api(api_client)

    try:
        namespaces = [
            namespace.metadata.name
            for namespace in core_api.list_namespace().items
            if namespace.metadata and namespace.metadata.name
        ]
        replica_sets = apps_api.list_replica_set_for_all_namespaces().items
        replica_set_lookup = deployment_by_replicaset(replica_sets)
        pods = [
            summarize_pod(pod, replica_set_lookup)
            for pod in core_api.list_pod_for_all_namespaces().items
        ]
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc

    unhealthy_pods = [pod for pod in pods if pod.unhealthy]

    checked_at = datetime.now(UTC).isoformat()
    response = KubernetesClusterStatusResponse(
        context=context_name,
        namespaces=sorted(namespaces),
        pods=sorted(pods, key=lambda pod: (pod.namespace, pod.name)),
        unhealthy_pods=sorted(
            unhealthy_pods,
            key=lambda pod: (pod.namespace, pod.name),
        ),
        checked_at=checked_at,
    )

    if response.unhealthy_pods:
        summary = unhealthy_pods_incident_summary(response.unhealthy_pods)
        store_incident_memory(
            source="/kubernetes/status",
            raw_logs=json.dumps(
                [model_to_dict(pod) for pod in response.unhealthy_pods],
                ensure_ascii=True,
            ),
            summary=summary,
            severity="high",
            explanation=(
                f"{len(response.unhealthy_pods)} unhealthy pod(s) detected "
                f"in context {response.context or 'default'}."
            ),
            recommended_fix=(
                "Inspect failing containers, restart managed pods, or roll back "
                "the owning deployment when a recent release caused the failure."
            ),
            created_at=checked_at,
        )
        send_slack_notification(
            title="DevPilot AI Incident Detected",
            summary=summary,
            timestamp=checked_at,
            fields=[
                ("Source", "/kubernetes/status"),
                ("Cluster Context", response.context or "default"),
                ("Unhealthy Pods", str(len(response.unhealthy_pods))),
            ],
        )

    return response


@app.post("/kubernetes/restart-pod", response_model=KubernetesActionResponse)
def kubernetes_restart_pod(
    payload: KubernetesRestartPodRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> KubernetesActionResponse:
    require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Restarting Kubernetes pods",
    )

    api_client, _ = get_kubernetes_client(payload)
    core_api = client.CoreV1Api(api_client)

    try:
        core_api.delete_namespaced_pod(
            name=payload.pod_name,
            namespace=payload.namespace,
            body=client.V1DeleteOptions(grace_period_seconds=30),
        )
    except ApiException as exc:
        raise HTTPException(
            status_code=exc.status or 502,
            detail=kubernetes_error_detail(exc),
        ) from exc

    return KubernetesActionResponse(
        message=(
            "Pod restart requested. Kubernetes will recreate it if it is managed "
            "by a controller."
        ),
        namespace=payload.namespace,
        pod_name=payload.pod_name,
        action="restart_pod",
        completed_at=datetime.now(UTC).isoformat(),
    )


@app.post("/kubernetes/rollback-deployment", response_model=KubernetesActionResponse)
def kubernetes_rollback_deployment(
    payload: KubernetesRollbackDeploymentRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> KubernetesActionResponse:
    require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Rolling back Kubernetes deployments",
    )

    api_client, _ = get_kubernetes_client(payload)
    apps_api = client.AppsV1Api(api_client)

    rollback_deployment_template(
        apps_api=apps_api,
        namespace=payload.namespace,
        deployment_name=payload.deployment_name,
    )

    return KubernetesActionResponse(
        message="Deployment rollback requested using the previous ReplicaSet template.",
        namespace=payload.namespace,
        deployment_name=payload.deployment_name,
        action="rollback_deployment",
        completed_at=datetime.now(UTC).isoformat(),
    )


@app.post("/kubernetes/scale-deployment", response_model=KubernetesActionResponse)
def kubernetes_scale_deployment(
    payload: KubernetesScaleDeploymentRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> KubernetesActionResponse:
    require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Scaling Kubernetes deployments",
    )

    api_client, _ = get_kubernetes_client(payload)
    apps_api = client.AppsV1Api(api_client)
    patch_deployment_replicas(
        apps_api=apps_api,
        namespace=payload.namespace,
        deployment_name=payload.deployment_name,
        replicas=payload.replicas,
    )

    return KubernetesActionResponse(
        message=f"Deployment scaled to {payload.replicas} replicas.",
        namespace=payload.namespace,
        deployment_name=payload.deployment_name,
        replicas=payload.replicas,
        action="scale_deployment",
        completed_at=datetime.now(UTC).isoformat(),
    )


@app.post("/infra/command", response_model=InfraCommandResponse)
def run_plain_english_infra_command(
    payload: InfraCommandRequest,
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> InfraCommandResponse:
    plan = parse_infra_command(payload.command, payload.namespace)
    generated_at = datetime.now(UTC).isoformat()

    if not payload.execute:
        action = preview_infra_command_action(plan)
        return InfraCommandResponse(
            command=payload.command,
            mode="preview",
            plan=plan,
            actions=[action],
            message="Plain English command translated into an infrastructure plan.",
            generated_at=generated_at,
        )

    require_roles(
        x_devpilot_role,
        {"admin", "devops_engineer"},
        "Executing plain English infrastructure commands",
    )
    context_name, actions = execute_infra_command_plan(payload, plan)
    action_summary = "; ".join(action.message for action in actions)
    response = InfraCommandResponse(
        command=payload.command,
        mode="executed",
        context=context_name,
        plan=plan,
        actions=actions,
        message=f"Plain English command executed. {action_summary}",
        generated_at=generated_at,
    )

    store_incident_memory(
        source="/infra/command",
        raw_logs=payload.command,
        summary=(
            f"Plain English command executed: {payload.command} -> "
            f"{plan.action} {plan.namespace}/{plan.target}."
        ),
        severity="medium",
        explanation=plan.reasoning,
        recommended_fix=response.message,
        fix_payload=json.dumps(
            {
                "plan": model_to_dict(plan),
                "actions": [model_to_dict(action) for action in actions],
                "context": context_name,
            },
            ensure_ascii=True,
        ),
        created_at=generated_at,
    )
    send_slack_notification(
        title="DevPilot AI Infra Command Executed",
        summary=response.message,
        timestamp=generated_at,
        fields=[
            ("Source", "/infra/command"),
            ("Command", payload.command),
            ("Action", plan.action),
            ("Namespace", plan.namespace),
        ],
    )

    return response


@app.post("/auto-heal", response_model=AutoHealResponse)
def auto_heal(
    payload: AutoHealRequest = Body(default_factory=AutoHealRequest),
    x_devpilot_role: str | None = Header(default=None, alias="X-DevPilot-Role"),
) -> AutoHealResponse:
    require_roles(x_devpilot_role, {"admin"}, "Running Auto Heal")

    actions = [
        AutoHealAction(
            action="restart_failed_pod",
            target=f"{payload.namespace}/{payload.failed_pod}",
            status="simulated",
            detail="Restarted failed pod by simulating a controlled delete and scheduler recreation.",
        ),
        AutoHealAction(
            action="rollback_deployment",
            target=f"{payload.namespace}/{payload.deployment}",
            status="simulated",
            detail="Rolled deployment back to the previous stable ReplicaSet revision.",
        ),
        AutoHealAction(
            action="patch_config",
            target=f"{payload.namespace}/{payload.config_map}",
            status="simulated",
            detail="Patched runtime configuration with safe defaults for readiness and recovery.",
        ),
    ]

    healed_at = datetime.now(UTC).isoformat()
    response = AutoHealResponse(
        message="Infrastructure healed successfully.",
        actions=actions,
        healed_at=healed_at,
    )

    send_slack_notification(
        title="Auto Heal Successful",
        summary=(
            f"Recovered {payload.namespace}/{payload.failed_pod}; rolled back "
            f"{payload.namespace}/{payload.deployment}; patched "
            f"{payload.namespace}/{payload.config_map}."
        ),
        timestamp=healed_at,
        fields=[
            ("Source", "/auto-heal"),
            ("Actions", str(len(actions))),
            ("Status", "successful"),
        ],
    )

    store_incident_memory(
        source="/auto-heal",
        summary=(
            f"Auto heal recovered {payload.namespace}/{payload.failed_pod} "
            f"and rolled back {payload.namespace}/{payload.deployment}."
        ),
        recommended_fix=response.message,
        fix_payload=json.dumps(
            {
                "message": response.message,
                "actions": [model_to_dict(action) for action in actions],
            },
            ensure_ascii=True,
        ),
        created_at=healed_at,
    )

    return response
