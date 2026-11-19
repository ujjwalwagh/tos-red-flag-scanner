"""Internal Service Authentication Middleware & Verification (Phase 8C.3E).

Provides server-to-server token-based authentication protecting communication
between the Node.js Express backend and the Python FastAPI AI microservice.

Features:
- Constant-time token verification (secrets.compare_digest) to prevent timing attacks.
- Supports single token (INTERNAL_AI_SERVICE_TOKEN) or rotation lists (INTERNAL_AI_SERVICE_TOKENS).
- Public health probe endpoints (/health) remain unauthenticated.
- Protects dense embedding (/ai/embed), vector operations (/ai/vectors/*), and NLI validation (/ai/nli/*).
- Fail-closed invariant: When authentication is enabled but no server token is configured,
  protected routes are immediately rejected with HTTP 401.
- Zero credential exposure: Tokens are never logged, echoed in error payloads, or returned in HTTP headers.
- Zero-config local development compatibility: When INTERNAL_AI_SERVICE_TOKEN is unset,
  service permits unauthenticated loopback requests without breaking developer workflows.
"""

import logging
import secrets
from typing import List, Optional, Set, Tuple
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from fastapi import status

from app.config import settings

logger = logging.getLogger("prismclause.ai.security")

# Canonical header name for internal server-to-server token
INTERNAL_TOKEN_HEADER = "X-Internal-Token"

# Routes that are publicly accessible without authentication
PUBLIC_PATHS: Set[str] = {
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc"
}

# Prefixes that represent protected internal AI operations
PROTECTED_PREFIXES: Tuple[str, ...] = (
    "/ai/",
    "/ai"
)


def verify_token_constant_time(provided: Optional[str], valid_tokens: List[str]) -> bool:
    """Verifies a provided token against a list of acceptable tokens in constant time.

    Uses secrets.compare_digest to defend against timing attacks. Handles None,
    non-string types, empty strings, and unequal string lengths safely.

    Args:
        provided: The token string provided by the caller in the X-Internal-Token header.
        valid_tokens: List of authorized token strings from server configuration.

    Returns:
        True if the provided token matches any valid token; otherwise False.
    """
    if not provided or not isinstance(provided, str):
        return False

    cleaned_provided = provided.strip()
    if not cleaned_provided or not valid_tokens:
        return False

    # Perform constant-time comparisons across all configured valid tokens.
    # Accumulate result without short-circuiting to minimize positional timing differences.
    match_found = False
    for expected in valid_tokens:
        if isinstance(expected, str) and expected.strip():
            if secrets.compare_digest(cleaned_provided, expected.strip()):
                match_found = True

    return match_found


def is_path_protected(path: str) -> bool:
    """Determines whether a given request path requires internal authentication.

    Args:
        path: The URL path component of the incoming HTTP request.

    Returns:
        True if the path requires authentication, False if it is public.
    """
    normalized = path.rstrip("/") or "/"
    if normalized in PUBLIC_PATHS:
        return False

    for prefix in PROTECTED_PREFIXES:
        if normalized == prefix.rstrip("/") or normalized.startswith(prefix.rstrip("/") + "/"):
            return True

    return False


class InternalTokenAuthMiddleware(BaseHTTPMiddleware):
    """FastAPI/Starlette middleware enforcing internal service token authentication."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Preflight OPTIONS requests and public paths are always permitted
        if request.method == "OPTIONS" or not is_path_protected(request.url.path):
            return await call_next(request)

        # In zero-config development mode (when auth is not explicitly enabled and no token set),
        # allow requests to preserve standard local developer workflows.
        if not settings.ENABLE_INTERNAL_AUTH:
            return await call_next(request)

        valid_tokens = settings.INTERNAL_AI_SERVICE_TOKENS

        # Fail-closed check: Authentication is enabled, but no valid tokens configured on server
        if not valid_tokens:
            logger.error(
                "Internal service authentication is ENABLED, but INTERNAL_AI_SERVICE_TOKEN "
                "is not configured on the server. Rejecting request to '%s' (fail closed).",
                request.url.path
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Unauthorized: internal service token not configured on server"}
            )

        # Extract header case-insensitively
        provided_header = request.headers.get(INTERNAL_TOKEN_HEADER.lower())
        if not provided_header or not provided_header.strip():
            logger.warning(
                "Internal authentication rejected for path '%s': missing '%s' header.",
                request.url.path,
                INTERNAL_TOKEN_HEADER
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Unauthorized: missing internal service token"}
            )

        # Constant-time comparison
        if not verify_token_constant_time(provided_header, valid_tokens):
            logger.warning(
                "Internal authentication rejected for path '%s': invalid token presented.",
                request.url.path
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Unauthorized: invalid internal service token"}
            )

        return await call_next(request)
