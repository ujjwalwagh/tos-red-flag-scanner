"""PrismClause Semantic Embedding Service (Phase 9.2A).

Generates 384-dimensional dense semantic vectors using sentence-transformers (all-MiniLM-L6-v2).
Zero-retention: All operations execute strictly in-memory without persistent disk caching.
"""

from __future__ import annotations
import math
from typing import List, Union
from sentence_transformers import SentenceTransformer

DEFAULT_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
MAX_TEXT_LENGTH = 50000  # 50,000 character safety ceiling
MAX_BATCH_SIZE = 100     # Maximum items per batch request


class EmbeddingService:
    def __init__(self, model_name: str = DEFAULT_MODEL_NAME):
        self.model_name = model_name
        self._model: SentenceTransformer | None = None

    def _get_model(self) -> SentenceTransformer:
        if self._model is None:
            self._model = SentenceTransformer(self.model_name)
        return self._model

    def embed_text(self, text: str) -> list[float]:
        """Generate a 384-dimensional dense embedding vector for a single text string."""
        if not isinstance(text, str):
            raise ValueError("Input text must be a string.")

        cleaned = text.strip()
        if not cleaned:
            raise ValueError("Input text must not be empty or whitespace only.")

        if len(cleaned) > MAX_TEXT_LENGTH:
            raise ValueError(f"Input text exceeds maximum allowed length of {MAX_TEXT_LENGTH} characters.")

        model = self._get_model()
        vector = model.encode(cleaned, convert_to_numpy=True)
        vec_list = [float(v) for v in vector.tolist()]

        if len(vec_list) != EMBEDDING_DIMENSION:
            raise ValueError(f"Unexpected embedding dimension: {len(vec_list)}, expected {EMBEDDING_DIMENSION}")

        for val in vec_list:
            if not math.isfinite(val):
                raise ValueError("Embedding contains non-finite values.")

        return vec_list

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate 384-dimensional dense embedding vectors for a batch of strings."""
        if not isinstance(texts, list):
            raise ValueError("Input texts must be a list of strings.")

        if not texts:
            raise ValueError("Batch texts list must not be empty.")

        if len(texts) > MAX_BATCH_SIZE:
            raise ValueError(f"Batch size exceeds maximum allowed of {MAX_BATCH_SIZE} items.")

        cleaned_texts: list[str] = []
        for idx, item in enumerate(texts):
            if not isinstance(item, str):
                raise ValueError(f"Item at index {idx} is not a string.")
            cleaned = item.strip()
            if not cleaned:
                raise ValueError(f"Item at index {idx} is empty or whitespace only.")
            if len(cleaned) > MAX_TEXT_LENGTH:
                raise ValueError(f"Item at index {idx} exceeds maximum allowed length of {MAX_TEXT_LENGTH} characters.")
            cleaned_texts.append(cleaned)

        model = self._get_model()
        vectors = model.encode(cleaned_texts, convert_to_numpy=True)

        results: list[list[float]] = []
        for vec in vectors:
            vec_list = [float(v) for v in vec.tolist()]
            if len(vec_list) != EMBEDDING_DIMENSION:
                raise ValueError(f"Unexpected embedding dimension: {len(vec_list)}, expected {EMBEDDING_DIMENSION}")
            for val in vec_list:
                if not math.isfinite(val):
                    raise ValueError("Embedding contains non-finite values.")
            results.append(vec_list)

        return results


# Default singleton instance for application routes
embedding_service = EmbeddingService()
