from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any

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
