import os
from typing import Optional, List

try:
    from dotenv import load_dotenv
    # Load from local ai-service/.env first, then root .env if present
    load_dotenv()
    _root_env = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    if os.path.exists(_root_env):
        load_dotenv(_root_env)
except ImportError:
    pass

class Settings:
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    CHROMA_PERSIST_DIRECTORY: Optional[str] = os.getenv("CHROMA_PERSIST_DIRECTORY", None)

    @property
    def NLI_LOCAL_FILES_ONLY(self) -> Optional[bool]:
        """Controls whether DeBERTa NLI requires local files only without network lookups.

        Returns:
            True: Enforce local-only loading. Fail if model files are not in local cache.
            False: Allow downloading or checking remote Hugging Face repositories.
            None: Auto-detect (use local_files_only if model files exist in local cache).
        """
        val = os.getenv("NLI_LOCAL_FILES_ONLY")
        if val is None or val.strip() == "":
            return None
        return val.strip().lower() in ("true", "1", "yes")

    @property
    def NLI_WARMUP_ON_STARTUP(self) -> bool:
        """Controls whether the NLI model is pre-warmed during FastAPI application lifespan.

        Defaults to True. Set to false/0 in test environments to test cold-start or disable warm-up.
        """
        val = os.getenv("NLI_WARMUP_ON_STARTUP")
        if val is None or val.strip() == "":
            return True
        return val.strip().lower() not in ("false", "0", "no")

    @property
    def INTERNAL_AI_SERVICE_TOKENS(self) -> List[str]:
        """List of valid internal service tokens for request verification.

        Supports multi-token rotation via comma-separated INTERNAL_AI_SERVICE_TOKENS
        or single token via INTERNAL_AI_SERVICE_TOKEN.
        """
        raw = os.getenv("INTERNAL_AI_SERVICE_TOKENS") or os.getenv("INTERNAL_AI_SERVICE_TOKEN") or ""
        return [t.strip() for t in raw.split(",") if t.strip()]

    @property
    def INTERNAL_AI_SERVICE_TOKEN(self) -> Optional[str]:
        """Primary internal service token."""
        tokens = self.INTERNAL_AI_SERVICE_TOKENS
        return tokens[0] if tokens else None

    @property
    def ENABLE_INTERNAL_AUTH(self) -> bool:
        """Controls whether internal token authentication is enforced on protected routes.

        If explicitly set (e.g. ENABLE_INTERNAL_AUTH=true/false), honors the setting.
        If unset, defaults to True if INTERNAL_AI_SERVICE_TOKEN is populated, or False
        if unset (preserving zero-config local development).
        """
        val = os.getenv("ENABLE_INTERNAL_AUTH")
        if val is not None and val.strip() != "":
            return val.strip().lower() in ("true", "1", "yes")
        return len(self.INTERNAL_AI_SERVICE_TOKENS) > 0

settings = Settings()
