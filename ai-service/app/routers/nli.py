"""PrismClause NLI Validation Router.

Exposes natural language inference validation endpoint for verifying generated
Q&A answers against original Terms of Service evidence clauses.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.nli_service import (
    nli_service,
    NliServiceError,
    MAX_TEXT_LENGTH,
    MAX_BATCH_EVIDENCE
)

router = APIRouter(prefix="/ai/nli", tags=["nli"])


class ClauseInput(BaseModel):
    """Input representation of an individual evidence clause."""
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH, description="Evidence clause text content")
    clause_id: Optional[str] = Field(default=None, max_length=128, description="Optional unique clause identifier")

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Clause text must not be empty or whitespace only.")
        return cleaned


class NliValidationRequest(BaseModel):
    """Request payload for NLI answer validation."""
    answer: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH, description="The answer / hypothesis to validate")
    evidence: List[ClauseInput] = Field(..., min_length=1, max_length=MAX_BATCH_EVIDENCE, description="One or more evidence premise clauses")

    @field_validator("answer")
    @classmethod
    def validate_answer(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Answer must not be empty or whitespace only.")
        return cleaned


class ScoreBreakdown(BaseModel):
    """Probability scores for NLI classification."""
    entailment: float = Field(..., ge=0.0, le=1.0, description="Entailment probability score")
    neutral: float = Field(..., ge=0.0, le=1.0, description="Neutral probability score")
    contradiction: float = Field(..., ge=0.0, le=1.0, description="Contradiction probability score")


class ClauseEvaluation(BaseModel):
    """Detailed evaluation result for an individual clause."""
    clause_id: Optional[str] = Field(default=None, description="Clause identifier if provided")
    label: str = Field(..., description="Dominant classification label for this clause")
    scores: ScoreBreakdown = Field(..., description="Probability breakdown for this clause")


class CompositeEvaluation(BaseModel):
    """Evaluation result for multiple clauses combined as a joint premise."""
    label: str = Field(..., description="Classification label for the composite premise")
    scores: ScoreBreakdown = Field(..., description="Probability breakdown for the composite premise")


class NliValidationResponse(BaseModel):
    """Conservative NLI validation outcome response."""
    is_supported: bool = Field(..., description="True if answer is conservatively supported by evidence")
    status: str = Field(..., description="Outcome status: 'supported', 'contradicted', or 'uncertain'")
    label: str = Field(..., description="Overall classification label: 'entailment', 'contradiction', or 'neutral'")
    scores: ScoreBreakdown = Field(..., description="Scores for the best supporting clause")
    best_clause_id: Optional[str] = Field(default=None, description="Clause identifier with highest entailment")
    evaluated_clauses_count: int = Field(..., ge=1, description="Number of evidence clauses evaluated")
    clause_evaluations: Optional[List[ClauseEvaluation]] = Field(default=None, description="Detailed evaluations per clause")
    composite_evaluation: Optional[CompositeEvaluation] = Field(default=None, description="Joint evaluation over combined evidence clauses")


@router.get("/status")
def get_nli_status():
    """Returns current NLI service readiness, model caching, and configuration info."""
    return {
        "status": "ready" if nli_service.is_ready() else "degraded",
        "model_name": nli_service.model_name,
        "model_loaded": nli_service.is_model_loaded(),
        "is_ready": nli_service.is_ready(),
        "is_cached_locally": nli_service.is_model_cached_locally(),
        "warmup_error": getattr(nli_service, "_warmup_error", None)
    }


@router.post(
    "/validate",
    response_model=NliValidationResponse,
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "NLI validation result"},
        400: {"description": "Invalid input parameters"},
        500: {"description": "Model loading or inference execution failure"}
    }
)
def validate_nli_endpoint(payload: NliValidationRequest):
    """Validates an answer against supplied ToS evidence clauses using DeBERTa-v3 NLI."""
    try:
        evidence_dicts = [
            {"text": c.text, "clause_id": c.clause_id}
            for c in payload.evidence
        ]
        result = nli_service.validate(
            answer=payload.answer,
            evidence_clauses=evidence_dicts
        )
        return result
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err)
        )
    except NliServiceError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while performing NLI validation."
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during validation."
        )
