"""Unit and integration tests for Internal Service Authentication (Phase 8C.3E).

Verifies:
- Constant-time token comparison with equal and unequal token lengths.
- Path protection resolution (public /health vs protected /ai/* operations).
- Header enforcement, missing header handling, and invalid token rejection (HTTP 401).
- Fail-closed behavior when authentication is enabled but no server token is configured.
- Zero-downtime multi-token rotation (INTERNAL_AI_SERVICE_TOKENS).
- Public health endpoint (/health) remains accessible without headers.
- Zero-config development mode (unauthenticated requests allowed when auth disabled).
"""

import os
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.security.auth import (
    verify_token_constant_time,
    is_path_protected,
    INTERNAL_TOKEN_HEADER,
    PUBLIC_PATHS
)

client = TestClient(app)

TEST_TOKEN_A = "tos_internal_secret_token_alpha_12345"
TEST_TOKEN_B = "tos_internal_secret_token_beta_67890"


# ==============================================================================
# 1. Constant-Time Verification Logic Tests
# ==============================================================================

def test_verify_token_valid():
    """Verify exact token match returns True."""
    assert verify_token_constant_time(TEST_TOKEN_A, [TEST_TOKEN_A]) is True


def test_verify_token_invalid():
    """Verify mismatched token returns False."""
    assert verify_token_constant_time("wrong_token", [TEST_TOKEN_A]) is False


def test_verify_token_unequal_lengths():
    """Verify tokens with different lengths safely return False without error."""
    assert verify_token_constant_time("short", [TEST_TOKEN_A]) is False
    assert verify_token_constant_time(TEST_TOKEN_A + "_extra", [TEST_TOKEN_A]) is False


def test_verify_token_empty_and_none():
    """Verify None, empty string, and whitespace return False."""
    assert verify_token_constant_time(None, [TEST_TOKEN_A]) is False
    assert verify_token_constant_time("", [TEST_TOKEN_A]) is False
    assert verify_token_constant_time("   ", [TEST_TOKEN_A]) is False
    assert verify_token_constant_time(TEST_TOKEN_A, []) is False


def test_verify_token_rotation_multi_tokens():
    """Verify any configured token in the rotation list is accepted."""
    tokens = [TEST_TOKEN_A, TEST_TOKEN_B]
    assert verify_token_constant_time(TEST_TOKEN_A, tokens) is True
    assert verify_token_constant_time(TEST_TOKEN_B, tokens) is True
    assert verify_token_constant_time("unknown_token", tokens) is False


# ==============================================================================
# 2. Path Protection Classification Tests
# ==============================================================================

def test_public_health_path_not_protected():
    """Verify /health and its variations are classified as public."""
    assert is_path_protected("/health") is False
    assert is_path_protected("/health/") is False


def test_openapi_docs_not_protected():
    """Verify FastAPI docs and openapi endpoints are not protected."""
    assert is_path_protected("/docs") is False
    assert is_path_protected("/openapi.json") is False
    assert is_path_protected("/redoc") is False


def test_ai_operations_are_protected():
    """Verify embedding, vector, and NLI endpoints are classified as protected."""
    assert is_path_protected("/ai/embed") is True
    assert is_path_protected("/ai/vectors/index") is True
    assert is_path_protected("/ai/vectors/query") is True
    assert is_path_protected("/ai/vectors/doc_sample_123") is True
    assert is_path_protected("/ai/nli/validate") is True
    assert is_path_protected("/ai/nli/status") is True


# ==============================================================================
# 3. Integration Tests: Zero-Config Local Development Mode
# ==============================================================================

def test_dev_mode_allows_requests_without_token():
    """Verify when auth is disabled (default dev mode), requests succeed without token."""
    with patch.dict(os.environ, {"ENABLE_INTERNAL_AUTH": "false", "INTERNAL_AI_SERVICE_TOKEN": ""}, clear=False):
        # Health probe succeeds
        res_h = client.get("/health")
        assert res_h.status_code == 200

        # Embedding endpoint succeeds without header
        res_e = client.post("/ai/embed", json={"text": "Test embedding string"})
        assert res_e.status_code == 200
        assert "embedding" in res_e.json()


# ==============================================================================
# 4. Integration Tests: Protected Routes with Authentication Enabled
# ==============================================================================

def test_protected_routes_require_token_when_auth_enabled():
    """Verify protected routes reject requests without X-Internal-Token with HTTP 401."""
    env_vars = {
        "ENABLE_INTERNAL_AUTH": "true",
        "INTERNAL_AI_SERVICE_TOKEN": TEST_TOKEN_A,
        "INTERNAL_AI_SERVICE_TOKENS": ""
    }
    with patch.dict(os.environ, env_vars, clear=False):

        # 1. Public health check MUST succeed without any header
        res_health = client.get("/health")
        assert res_health.status_code == 200
        assert res_health.json()["status"] == "ok"

        # 2. Embedding endpoint rejects missing header
        res_emb_missing = client.post("/ai/embed", json={"text": "Test clause"})
        assert res_emb_missing.status_code == 401
        assert "missing internal service token" in res_emb_missing.json()["detail"].lower()

        # 3. Embedding endpoint rejects invalid header
        res_emb_invalid = client.post(
            "/ai/embed",
            json={"text": "Test clause"},
            headers={INTERNAL_TOKEN_HEADER: "wrong_token_123"}
        )
        assert res_emb_invalid.status_code == 401
        assert "invalid internal service token" in res_emb_invalid.json()["detail"].lower()

        # 4. Embedding endpoint rejects unequal length token
        res_emb_unequal = client.post(
            "/ai/embed",
            json={"text": "Test clause"},
            headers={INTERNAL_TOKEN_HEADER: "short"}
        )
        assert res_emb_unequal.status_code == 401

        # 5. Embedding endpoint succeeds with valid token
        res_emb_valid = client.post(
            "/ai/embed",
            json={"text": "Test clause"},
            headers={INTERNAL_TOKEN_HEADER: TEST_TOKEN_A}
        )
        assert res_emb_valid.status_code == 200
        assert "embedding" in res_emb_valid.json()

        # 6. Vector query endpoint rejects missing header
        res_vec_missing = client.post(
            "/ai/vectors/query",
            json={"document_id": "test_doc", "query": "cancellation policy"}
        )
        assert res_vec_missing.status_code == 401

        # 7. Vector query endpoint succeeds with valid token
        res_vec_valid = client.post(
            "/ai/vectors/query",
            json={"document_id": "test_doc", "query": "cancellation policy"},
            headers={INTERNAL_TOKEN_HEADER: TEST_TOKEN_A}
        )
        assert res_vec_valid.status_code == 200

        # 8. NLI validate endpoint rejects missing header
        res_nli_missing = client.post(
            "/ai/nli/validate",
            json={
                "answer": "Users can cancel anytime.",
                "evidence": [{"text": "You may cancel your account at any time in user settings."}]
            }
        )
        assert res_nli_missing.status_code == 401

        # 9. NLI validate endpoint succeeds with valid token
        res_nli_valid = client.post(
            "/ai/nli/validate",
            json={
                "answer": "Users can cancel anytime.",
                "evidence": [{"text": "You may cancel your account at any time in user settings."}]
            },
            headers={INTERNAL_TOKEN_HEADER: TEST_TOKEN_A}
        )
        assert res_nli_valid.status_code == 200
        assert "is_supported" in res_nli_valid.json()

        # 10. Case-insensitive header check (lower-case x-internal-token)
        res_lower = client.post(
            "/ai/embed",
            json={"text": "Test clause"},
            headers={"x-internal-token": TEST_TOKEN_A}
        )
        assert res_lower.status_code == 200


# ==============================================================================
# 5. Integration Tests: Multi-Token Rotation
# ==============================================================================

def test_multi_token_rotation_accepts_both_keys():
    """Verify zero-downtime rotation accepts old and new tokens concurrently."""
    env_vars = {
        "ENABLE_INTERNAL_AUTH": "true",
        "INTERNAL_AI_SERVICE_TOKENS": f"{TEST_TOKEN_A},{TEST_TOKEN_B}",
        "INTERNAL_AI_SERVICE_TOKEN": ""
    }
    with patch.dict(os.environ, env_vars, clear=False):

        # Token A (new) works
        res_a = client.post(
            "/ai/embed",
            json={"text": "Rotation check"},
            headers={INTERNAL_TOKEN_HEADER: TEST_TOKEN_A}
        )
        assert res_a.status_code == 200

        # Token B (old) works
        res_b = client.post(
            "/ai/embed",
            json={"text": "Rotation check"},
            headers={INTERNAL_TOKEN_HEADER: TEST_TOKEN_B}
        )
        assert res_b.status_code == 200

        # Third token is rejected
        res_c = client.post(
            "/ai/embed",
            json={"text": "Rotation check"},
            headers={INTERNAL_TOKEN_HEADER: "unauthorized_token"}
        )
        assert res_c.status_code == 401


# ==============================================================================
# 6. Integration Tests: Fail-Closed Behavior
# ==============================================================================

def test_fail_closed_when_auth_enabled_but_no_server_token():
    """Verify that when ENABLE_INTERNAL_AUTH=True but server has no tokens, routes fail closed."""
    env_vars = {
        "ENABLE_INTERNAL_AUTH": "true",
        "INTERNAL_AI_SERVICE_TOKEN": "",
        "INTERNAL_AI_SERVICE_TOKENS": ""
    }
    with patch.dict(os.environ, env_vars, clear=False):

        # Health probe remains accessible
        res_h = client.get("/health")
        assert res_h.status_code == 200

        # Protected routes must fail closed with 401 even if client sends a token
        res_emb = client.post(
            "/ai/embed",
            json={"text": "Should fail closed"},
            headers={INTERNAL_TOKEN_HEADER: "any_token"}
        )
        assert res_emb.status_code == 401
        assert "not configured" in res_emb.json()["detail"].lower()
