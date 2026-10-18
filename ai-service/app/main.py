from typing import Optional, List
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from app.config import settings
from app.services.embedding_service import embedding_service, EMBEDDING_DIMENSION
from app.routers.vectors import router as vectors_router

app = FastAPI(
    title="PrismClause AI Service",
    description="Isolated AI/NLP Microservice for PrismClause",
    version="0.1.0"
)

app.include_router(vectors_router)

class EmbedRequest(BaseModel):
    text: Optional[str] = Field(default=None, description="Single text string to embed")
    texts: Optional[List[str]] = Field(default=None, description="Batch of text strings to embed")

@app.get("/health")
def health_check():
    return {"status": "ok"}

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
