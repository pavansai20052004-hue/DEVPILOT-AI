from __future__ import annotations

import base64
import warnings
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient


ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "CorrectHorseBatteryStaple!"


def bootstrap_admin(client: TestClient) -> tuple[dict[str, Any], dict[str, str]]:
    response = client.post(
        "/auth/bootstrap",
        json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
            "full_name": "Contract Admin",
            "team_name": "Contract Tests",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    csrf_token = payload.get("csrf_token")
    assert isinstance(csrf_token, str) and csrf_token
    return payload, {"X-CSRF-Token": csrf_token}


def test_health_and_readiness_contracts(client: TestClient) -> None:
    root_response = client.get("/")
    assert root_response.status_code == 200
    assert root_response.json()["status"] == "ok"
    assert root_response.json()["health"] == "/health"

    health_response = client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json() == {
        "status": "ok",
        "service": "devpilot-ai-api",
        "version": "0.1.0",
        "environment": "development",
    }

    ready_response = client.get("/ready")
    assert ready_response.status_code == 200
    assert ready_response.json() == {
        "status": "ready",
        "service": "devpilot-ai-api",
        "storage": "sqlite",
    }


def test_auth_bootstrap_login_and_session_contract(client: TestClient) -> None:
    bootstrap_payload, headers = bootstrap_admin(client)
    assert bootstrap_payload["authenticated"] is True
    assert bootstrap_payload["bootstrap_required"] is False
    assert bootstrap_payload["user"]["email"] == ADMIN_EMAIL
    assert bootstrap_payload["role"] == "admin"

    session_response = client.get("/auth/session")
    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True

    logout_response = client.post("/auth/logout", headers=headers)
    assert logout_response.status_code == 200

    login_response = client.post(
        "/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert login_response.status_code == 200
    login_payload = login_response.json()
    assert login_payload["authenticated"] is True
    assert login_payload["role"] == "admin"
    assert login_payload["csrf_token"]


def test_auth_bootstrap_replay_returns_clean_conflict(client: TestClient) -> None:
    bootstrap_admin(client)
    replay_response = client.post(
        "/auth/bootstrap",
        json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
            "full_name": "Contract Admin",
            "team_name": "Contract Tests",
        },
    )
    assert replay_response.status_code == 409, replay_response.text
    assert replay_response.json()["detail"] == (
        "DevPilot has already been bootstrapped. Use sign in instead."
    )


def test_signup_creates_separate_user_and_workspace(client: TestClient) -> None:
    bootstrap_admin(client)

    response = client.post(
        "/auth/signup",
        json={
            "email": "founder@example.com",
            "password": "AnotherCorrectHorse!",
            "full_name": "Founder User",
            "team_name": "Founder Workspace",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["user"]["email"] == "founder@example.com"
    assert payload["current_team"]["name"] == "Founder Workspace"
    assert payload["current_team"]["owner_email"] == "founder@example.com"
    assert payload["role"] == "admin"

    existing_response = client.post(
        "/auth/signup",
        json={
            "email": "founder@example.com",
            "password": "AnotherCorrectHorse!",
            "team_name": "Duplicate Workspace",
        },
    )
    assert existing_response.status_code == 409


def test_password_reset_flow_uses_single_use_token(client: TestClient) -> None:
    bootstrap_admin(client)
    signup_response = client.post(
        "/auth/signup",
        json={
            "email": "reset-me@example.com",
            "password": "OldCorrectHorsePass!",
            "team_name": "Reset Workspace",
        },
    )
    assert signup_response.status_code == 200, signup_response.text

    reset_response = client.post(
        "/auth/password-reset/request",
        json={"email": "reset-me@example.com"},
    )
    assert reset_response.status_code == 200, reset_response.text
    reset_payload = reset_response.json()
    assert reset_payload["message"] == (
        "If that email is registered, password reset instructions are on the way."
    )
    assert reset_payload["reset_token"]

    confirm_response = client.post(
        "/auth/password-reset/confirm",
        json={
            "token": reset_payload["reset_token"],
            "password": "NewCorrectHorsePass!",
        },
    )
    assert confirm_response.status_code == 200, confirm_response.text

    old_login_response = client.post(
        "/auth/login",
        json={"email": "reset-me@example.com", "password": "OldCorrectHorsePass!"},
    )
    assert old_login_response.status_code == 401

    new_login_response = client.post(
        "/auth/login",
        json={"email": "reset-me@example.com", "password": "NewCorrectHorsePass!"},
    )
    assert new_login_response.status_code == 200, new_login_response.text

    replay_response = client.post(
        "/auth/password-reset/confirm",
        json={
            "token": reset_payload["reset_token"],
            "password": "AnotherCorrectHorsePass!",
        },
    )
    assert replay_response.status_code == 400


def test_password_reset_request_is_generic_for_unknown_email(client: TestClient) -> None:
    bootstrap_admin(client)

    response = client.post(
        "/auth/password-reset/request",
        json={"email": "missing@example.com"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["message"] == (
        "If that email is registered, password reset instructions are on the way."
    )
    assert payload["reset_token"] is None


def configure_test_sso(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SSO_ENABLED", "true")
    monkeypatch.setenv("SSO_PROVIDER_ID", "test-idp")
    monkeypatch.setenv("SSO_PROVIDER_NAME", "Test Company SSO")
    monkeypatch.setenv("SSO_AUTHORIZATION_URL", "http://localhost:9000/authorize")
    monkeypatch.setenv("SSO_TOKEN_URL", "http://localhost:9000/token")
    monkeypatch.setenv("SSO_USERINFO_URL", "http://localhost:9000/userinfo")
    monkeypatch.setenv("SSO_CLIENT_ID", "devpilot-client")
    monkeypatch.setenv("SSO_CLIENT_SECRET", "devpilot-secret")
    monkeypatch.setenv("SSO_ALLOWED_DOMAINS", "example.com")
    monkeypatch.setenv("SSO_DEFAULT_TEAM_NAME", "Example SSO Workspace")


def test_sso_config_is_hidden_until_oidc_is_configured(client: TestClient) -> None:
    response = client.get("/auth/sso/config")

    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "configured": False,
        "provider_name": "Company SSO",
        "login_url": None,
    }


def test_sso_start_redirects_to_oidc_provider(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_test_sso(monkeypatch)

    response = client.get("/auth/sso/start", follow_redirects=False)

    assert response.status_code == 302
    location = response.headers["location"]
    parsed = urlsplit(location)
    params = parse_qs(parsed.query)
    assert location.startswith("http://localhost:9000/authorize?")
    assert params["response_type"] == ["code"]
    assert params["client_id"] == ["devpilot-client"]
    assert params["scope"] == ["openid email profile"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["state"][0]
    assert params["nonce"][0]
    assert params["code_challenge"][0]


def test_sso_callback_creates_separate_account_workspace_and_session(
    client: TestClient,
    backend_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_test_sso(monkeypatch)
    start_response = client.get("/auth/sso/start", follow_redirects=False)
    state = parse_qs(urlsplit(start_response.headers["location"]).query)["state"][0]

    def fake_exchange_sso_code_for_token(**kwargs: Any) -> dict[str, Any]:
        assert kwargs["code"] == "provider-code"
        assert kwargs["code_verifier"]
        return {"access_token": "provider-access-token"}

    def fake_fetch_sso_userinfo(**kwargs: Any) -> dict[str, Any]:
        assert kwargs["access_token"] == "provider-access-token"
        return {
            "sub": "idp-user-123",
            "email": "founder@example.com",
            "email_verified": True,
            "name": "SSO Founder",
        }

    monkeypatch.setattr(
        backend_module,
        "exchange_sso_code_for_token",
        fake_exchange_sso_code_for_token,
    )
    monkeypatch.setattr(backend_module, "fetch_sso_userinfo", fake_fetch_sso_userinfo)

    callback_response = client.get(
        f"/auth/sso/callback?code=provider-code&state={state}",
        follow_redirects=False,
    )

    assert callback_response.status_code == 302
    assert callback_response.headers["location"].endswith("/dashboard?sso=success")
    assert "devpilot_session=" in callback_response.headers["set-cookie"]

    session_response = client.get("/auth/session")
    assert session_response.status_code == 200
    session_payload = session_response.json()
    assert session_payload["authenticated"] is True
    assert session_payload["user"]["email"] == "founder@example.com"
    assert session_payload["user"]["full_name"] == "SSO Founder"
    assert session_payload["current_team"]["name"] == "Example SSO Workspace"
    assert session_payload["role"] == "admin"


def test_agent_collaboration_assigns_specialist_readiness_agents(
    client: TestClient,
) -> None:
    _, headers = bootstrap_admin(client)

    response = client.post("/agents/collaborate", headers=headers, json={})

    assert response.status_code == 200, response.text
    payload = response.json()
    agent_names = {agent["name"] for agent in payload["agents"]}
    assert {
        "Bug Sentinel Agent",
        "Frontend Guardian Agent",
        "Backend Guardian Agent",
        "Database Guardian Agent",
        "Full UI Monitor Agent",
        "Release Auditor Agent",
    }.issubset(agent_names)

    action_types = {action["action_type"] for action in payload["recent_actions"]}
    assert {
        "scan_error_backlog",
        "audit_frontend_routes",
        "validate_backend_contracts",
        "verify_database_storage",
        "monitor_ui_sections",
        "audit_pending_work",
    }.issubset(action_types)

    completed_handoffs = {
        (handoff["from_agent"], handoff["to_agent"])
        for handoff in payload["handoffs"]
        if handoff["status"] == "completed"
    }
    assert ("Bug Sentinel Agent", "Frontend Guardian Agent") in completed_handoffs
    assert ("Backend Guardian Agent", "Database Guardian Agent") in completed_handoffs
    assert ("Full UI Monitor Agent", "Release Auditor Agent") in completed_handoffs


def test_fallback_ai_contracts_without_openai(client: TestClient) -> None:
    _, headers = bootstrap_admin(client)

    fix_response = client.post(
        "/generate-fix",
        headers=headers,
        json={
            "issue": "Production API is crash-looping because DATABASE_URL is missing.",
            "cloud_provider": "aws",
        },
    )
    assert fix_response.status_code == 200, fix_response.text
    fix_payload = fix_response.json()
    assert fix_payload["cloud_provider"] == "aws"
    assert "FROM " in fix_payload["dockerfile"]
    assert fix_payload["deployment_suggestions"]

    voice_response = client.post(
        "/voice/ask",
        headers=headers,
        json={"question": "Why did deployment fail?"},
    )
    assert voice_response.status_code == 200, voice_response.text
    voice_payload = voice_response.json()
    assert voice_payload["question"] == "Why did deployment fail?"
    assert voice_payload["answer"]
    assert 0 <= voice_payload["confidence"] <= 1


def test_protected_role_failure_is_clean(
    client: TestClient,
    backend_module: Any,
) -> None:
    session_payload, headers = bootstrap_admin(client)
    team_id = session_payload["current_team"]["id"]
    with backend_module.incident_db_connection() as connection:
        connection.execute(
            """
            UPDATE saas_team_members
            SET role = ?
            WHERE team_id = ? AND email = ?
            """,
            ("viewer", team_id, ADMIN_EMAIL),
        )

    response = client.post("/auto-heal", headers=headers, json={})
    assert response.status_code == 403
    assert response.json()["detail"] == "Running Auto Heal requires one of these roles: Admin."


def test_middleware_error_responses_include_cors_headers(client: TestClient) -> None:
    origin = "http://127.0.0.1:3000"
    response = client.get("/incidents/history", headers={"Origin": origin})

    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.json()["detail"] == "Authentication is required."


def test_quota_errors_include_cors_headers(client: TestClient) -> None:
    session_payload, headers = bootstrap_admin(client)
    origin = "http://127.0.0.1:3000"
    request_headers = {
        **headers,
        "Origin": origin,
        "X-DevPilot-Team-ID": session_payload["current_team"]["id"],
    }

    for _ in range(5):
        response = client.post("/auto-heal", headers=request_headers, json={})
        assert response.status_code == 200, response.text

    quota_response = client.post("/auto-heal", headers=request_headers, json={})

    assert quota_response.status_code == 402
    assert quota_response.headers["access-control-allow-origin"] == origin
    assert quota_response.headers["access-control-allow-credentials"] == "true"
    assert quota_response.json()["metric"] == "auto_heal_actions"


def test_missing_external_credentials_return_clean_errors(
    client: TestClient,
    tmp_path: Path,
) -> None:
    _, headers = bootstrap_admin(client)

    github_response = client.post(
        "/github/create-pull-request",
        headers=headers,
        json={
            "issue": "Production API needs a generated remediation PR.",
            "repository": "owner/repo",
            "base_branch": "main",
        },
    )
    assert github_response.status_code == 500
    assert "GITHUB_TOKEN is not configured" in github_response.json()["detail"]

    slack_response = client.post(
        "/slack/test",
        headers=headers,
        json={"summary": "Contract test notification."},
    )
    assert slack_response.status_code == 500
    assert "SLACK_WEBHOOK_URL is not configured" in slack_response.json()["detail"]

    kubernetes_response = client.post(
        "/kubernetes/status",
        headers=headers,
        json={"kubeconfig_path": str(tmp_path / "missing-kubeconfig.yaml")},
    )
    assert kubernetes_response.status_code == 400
    assert "Kubeconfig file was not found" in kubernetes_response.json()["detail"]


def test_kubeconfig_base64_env_is_materialized_for_live_render_secret(
    backend_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kubeconfig = "\n".join(
        [
            "apiVersion: v1",
            "kind: Config",
            "clusters: []",
            "contexts: []",
            "users: []",
            "",
        ],
    )
    encoded_kubeconfig = base64.b64encode(kubeconfig.encode("utf-8")).decode(
        "ascii",
    )

    monkeypatch.setenv("KUBECONFIG_B64", encoded_kubeconfig)

    resolved_path = backend_module.resolve_kubeconfig_path(None)

    assert resolved_path is not None
    resolved_file = Path(resolved_path)
    assert resolved_file.exists()
    assert resolved_file.parent.name == "devpilot-ai"
    assert resolved_file.read_text(encoding="utf-8") == kubeconfig


def test_kubeconfig_content_env_accepts_escaped_newlines(
    backend_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kubeconfig = (
        "apiVersion: v1\\n"
        "kind: Config\\n"
        "clusters: []\\n"
        "contexts: []\\n"
        "users: []"
    )

    monkeypatch.setenv("KUBECONFIG_CONTENT", kubeconfig)

    resolved_path = backend_module.resolve_kubeconfig_path(None)

    assert resolved_path is not None
    assert Path(resolved_path).read_text(encoding="utf-8").endswith("users: []\n")


def test_invalid_kubeconfig_base64_env_returns_clean_error(
    backend_module: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KUBECONFIG_B64", "not base64")

    with pytest.raises(backend_module.HTTPException) as raised_error:
        backend_module.resolve_kubeconfig_path(None)

    assert raised_error.value.status_code == 400
    assert "KUBECONFIG_B64" in raised_error.value.detail


def test_openapi_generation_has_no_duplicate_operation_warnings(
    backend_module: Any,
) -> None:
    backend_module.app.openapi_schema = None
    with warnings.catch_warnings(record=True) as captured_warnings:
        warnings.simplefilter("always")
        schema = backend_module.app.openapi()

    duplicate_warnings = [
        warning
        for warning in captured_warnings
        if "duplicate" in str(warning.message).lower()
        and "operation" in str(warning.message).lower()
    ]
    assert duplicate_warnings == []

    operation_ids = [
        operation["operationId"]
        for path_item in schema["paths"].values()
        for operation in path_item.values()
        if isinstance(operation, dict) and "operationId" in operation
    ]
    assert len(operation_ids) == len(set(operation_ids))
