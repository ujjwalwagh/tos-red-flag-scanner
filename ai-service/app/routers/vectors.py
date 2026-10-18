"""PrismClause Vector Store Router (Phase 9.2B).

Exposes semantic indexing, similarity search, and session cleanup endpoints.
Delegates all vector logic to VectorStoreService and EmbeddingService.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.vector_store import (
    vector_store_service,
    MAX_DOCUMENT_ID_LENGTH,
    MAX_CLAUSE_TEXT_LENGTH,
    MAX_BATCH_CLAUSES,
    MAX_TOP_K,
    DEFAULT_TOP_K
)

router = APIRouter(prefix="/ai/vectors", tags=["vectors"])


class ClausePayload(BaseModel):
    clause_id: str = Field(..., min_length=1, max_length=128, description="Unique clause identifier")
    text: str = Field(..., min_length=1, max_length=MAX_CLAUSE_TEXT_LENGTH, description="Clause text content")
    category: Optional[str] = Field(default="general", max_length=100, description="Risk or topical category")
    section: Optional[str] = Field(default="", max_length=200, description="Section heading or title")


class IndexRequest(BaseModel):
    document_id: str = Field(..., min_length=1, max_length=MAX_DOCUMENT_ID_LENGTH, description="Document or session ID")
    clauses: List[ClausePayload] = Field(..., min_length=1, max_length=MAX_BATCH_CLAUSES, description="Clauses to index")


class QueryRequest(BaseModel):
    document_id: str = Field(..., min_length=1, max_length=MAX_DOCUMENT_ID_LENGTH, description="Document or session ID")
    query: str = Field(..., min_length=1, max_length=MAX_CLAUSE_TEXT_LENGTH, description="Search query string")
    top_k: int = Field(default=DEFAULT_TOP_K, ge=1, le=MAX_TOP_K, description="Number of results to retrieve")


class CleanupRequest(BaseModel):
    document_id: str = Field(..., min_length=1, max_length=MAX_DOCUMENT_ID_LENGTH, description="Document or session ID")


@router.post(
    "/index",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Clauses successfully indexed into document store"},
        400: {"description": "Invalid input parameters"},
        500: {"description": "Internal vector store error"}
    }
)
def index_clauses_endpoint(payload: IndexRequest):
    try:
        clauses_data = [c.model_dump() for c in payload.clauses]
        result = vector_store_service.index_clauses(payload.document_id, clauses_data)
        return result
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while indexing clauses."
        )


@router.post(
    "/query",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Top-K semantically relevant clauses"},
        400: {"description": "Invalid search parameters"},
        500: {"description": "Internal retrieval error"}
    }
)
def query_clauses_endpoint(payload: QueryRequest):
    try:
        results = vector_store_service.query(
            document_id=payload.document_id,
            query_text=payload.query,
            top_k=payload.top_k
        )
        return {"results": results}
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while querying vector store."
        )


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Document vector store cleanup complete"},
        400: {"description": "Invalid document identifier"}
    }
)
def delete_document_endpoint(document_id: str):
    try:
        deleted = vector_store_service.delete_analysis_store(document_id)
        return {
            "document_id": document_id,
            "deleted": deleted,
            "status": "deleted" if deleted else "not_found"
        }
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.post(
    "/cleanup",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Document vector store cleanup complete"},
        400: {"description": "Invalid document identifier"}
    }
)
def cleanup_document_endpoint(payload: CleanupRequest):
    try:
        deleted = vector_store_service.delete_analysis_store(payload.document_id)
        return {
            "document_id": payload.document_id,
            "deleted": deleted,
            "status": "deleted" if deleted else "not_found"
        }
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
