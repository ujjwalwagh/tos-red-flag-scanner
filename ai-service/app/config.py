import os
from typing import Optional

class Settings:
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    CHROMA_PERSIST_DIRECTORY: Optional[str] = os.getenv("CHROMA_PERSIST_DIRECTORY", None)

settings = Settings()
