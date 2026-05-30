from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["APP_ENV"] = "development"
os.environ["AUTONOMOUS_AGENT_ENABLED"] = "false"
os.environ["SESSION_SECRET"] = "devpilot-test-session-secret-with-at-least-32-chars"
os.environ["FRONTEND_ORIGINS"] = "http://127.0.0.1:3000"
for secret_name in (
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "GITHUB_TOKEN",
    "SLACK_WEBHOOK_URL",
    "KUBECONFIG",
    "KUBECONFIG_B64",
    "KUBECONFIG_CONTENT",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "SMTP_FROM_EMAIL",
    "SMTP_USE_TLS",
    "SSO_ENABLED",
    "SSO_PROVIDER_ID",
    "SSO_PROVIDER_NAME",
    "SSO_DISCOVERY_URL",
    "SSO_AUTHORIZATION_URL",
    "SSO_TOKEN_URL",
    "SSO_USERINFO_URL",
    "SSO_CLIENT_ID",
    "SSO_CLIENT_SECRET",
    "SSO_REDIRECT_URI",
    "SSO_ALLOWED_DOMAINS",
    "SSO_DEFAULT_TEAM_NAME",
):
    os.environ.pop(secret_name, None)

import main  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_backend_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("AUTONOMOUS_AGENT_ENABLED", "false")
    monkeypatch.setenv(
        "SESSION_SECRET",
        "devpilot-test-session-secret-with-at-least-32-chars",
    )
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://127.0.0.1:3000")
    monkeypatch.setenv("INCIDENT_DB_PATH", str(tmp_path / "incident-memory.sqlite3"))
    for secret_name in (
        "DATABASE_URL",
        "OPENAI_API_KEY",
        "GITHUB_TOKEN",
        "SLACK_WEBHOOK_URL",
        "KUBECONFIG",
        "KUBECONFIG_B64",
        "KUBECONFIG_CONTENT",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "SMTP_FROM_EMAIL",
        "SMTP_USE_TLS",
        "SSO_ENABLED",
        "SSO_PROVIDER_ID",
        "SSO_PROVIDER_NAME",
        "SSO_DISCOVERY_URL",
        "SSO_AUTHORIZATION_URL",
        "SSO_TOKEN_URL",
        "SSO_USERINFO_URL",
        "SSO_CLIENT_ID",
        "SSO_CLIENT_SECRET",
        "SSO_REDIRECT_URI",
        "SSO_ALLOWED_DOMAINS",
        "SSO_DEFAULT_TEAM_NAME",
    ):
        monkeypatch.delenv(secret_name, raising=False)

    main.AUTONOMOUS_AGENT_CONFIG["enabled"] = False
    main.INCIDENT_DB_INITIALIZED = False
    main.RATE_LIMIT_STATE.clear()
    main.clear_incident_history_cache()

    yield

    main.INCIDENT_DB_INITIALIZED = False
    main.RATE_LIMIT_STATE.clear()
    main.clear_incident_history_cache()


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture
def backend_module():
    return main
