import asyncio
from contextlib import asynccontextmanager
import logging
from typing import Optional, List
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from app.config import settings
from app.services.embedding_service import embedding_service, EMBEDDING_DIMENSION
from app.services.nli_service import nli_service
from app.routers.vectors import router as vectors_router
from app.routers.nli import router as nli_router
from app.security.auth import InternalTokenAuthMiddleware

logger = logging.getLogger("prismclause.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI.

    Performs safe NLI model warm-up on CPU before the service reports ready.
    If warm-up times out or encounters an error, the exception is caught, logged,
    and the service starts cleanly in degraded mode to preserve Gemini Q&A availability.
    """
    if settings.NLI_WARMUP_ON_STARTUP:
        try:
            logger.info("Pre-warming NLI model '%s' on CPU...", nli_service.model_name)
            # Bound warm-up duration to 25 seconds to prevent indefinite startup hangs
            warmed = await asyncio.wait_for(
                asyncio.to_thread(nli_service.warm_up),
                timeout=25.0
            )
            if warmed:
                logger.info("NLI model '%s' successfully warmed up.", nli_service.model_name)
            else:
                logger.warning("NLI model warm-up completed without ready state (degraded mode).")
        except asyncio.TimeoutError:
            logger.error("NLI model warm-up timed out after 25s; continuing startup in degraded mode.")
        except Exception as err:
            logger.error("NLI model warm-up failed: %s; continuing startup in degraded mode.", err)

    yield


app = FastAPI(
    title="PrismClause AI Service",
    description="Isolated AI/NLP Microservice for PrismClause",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(InternalTokenAuthMiddleware)

app.include_router(vectors_router)
app.include_router(nli_router)

class EmbedRequest(BaseModel):
    text: Optional[str] = Field(default=None, description="Single text string to embed")
    texts: Optional[List[str]] = Field(default=None, description="Batch of text strings to embed")

@app.get("/health")
def health_check():
    model_loaded = nli_service.is_model_loaded()
    return {
        "status": "ok",
        "model_loaded": model_loaded,
        "nli_status": "ready" if model_loaded else "cold_or_unavailable"
    }

@app.post(
    "/ai/embed",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Successful embedding generation"},
        400: {"description": "Invalid input text or parameters"},
        500: {"description": "Internal model execution failure"}
    }
)
def generate_embedding(payload: EmbedRequest):
    # Enforce mutual exclusivity and presence
    if payload.text is None and payload.texts is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'text' (single) or 'texts' (batch) must be provided."
        )

    if payload.text is not None and payload.texts is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either 'text' (single) or 'texts' (batch), not both."
        )

    try:
        if payload.text is not None:
            embedding = embedding_service.embed_text(payload.text)
            return {
                "embedding": embedding,
                "dimension": EMBEDDING_DIMENSION
            }
        else:
            embeddings = embedding_service.embed_batch(payload.texts)
            return {
                "embeddings": embeddings,
                "dimension": EMBEDDING_DIMENSION,
                "count": len(embeddings)
            }
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err)
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while generating embeddings."
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=False)
