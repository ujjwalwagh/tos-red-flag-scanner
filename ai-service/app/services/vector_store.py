"""PrismClause ChromaDB Vector Store Service (Phase 9.2B).

Manages document-scoped vector collections, semantic indexing, and similarity retrieval.
Enforces zero-retention privacy: collections are isolated per document session and explicitly deletable.
Reuses the existing singleton EmbeddingService for all embedding transformations.
"""

from __future__ import annotations
import math
import re
from typing import Any, Dict, List, Optional
import chromadb
from chromadb.api import ClientAPI

from app.config import settings
from app.services.embedding_service import embedding_service, EmbeddingService, MAX_BATCH_SIZE

MAX_DOCUMENT_ID_LENGTH = 64
MAX_CLAUSE_TEXT_LENGTH = 50000
MAX_BATCH_CLAUSES = 1000
MAX_TOP_K = 50
DEFAULT_TOP_K = 3


def sanitize_collection_name(document_id: str) -> str:
    """Sanitize document_id to conform to ChromaDB collection naming rules (3-63 chars, [a-zA-Z0-9_-])."""
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", document_id.strip()).strip("_-")
    if not cleaned:
        cleaned = "doc"
    name = f"doc_{cleaned}"
    if len(name) > 63:
        name = name[:63].rstrip("_-")
    if len(name) < 3:
        name = f"{name}___"[:3]
    return name


class VectorStoreService:
    def __init__(
        self,
        client: Optional[ClientAPI] = None,
        embed_service: Optional[EmbeddingService] = None
    ):
        self.embedding_service = embed_service or embedding_service
        if client is not None:
            self._client = client
        elif settings.CHROMA_PERSIST_DIRECTORY:
            self._client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIRECTORY)
        else:
            self._client = chromadb.EphemeralClient()

    @property
    def client(self) -> ClientAPI:
        return self._client

    def _validate_document_id(self, document_id: str) -> str:
        if not isinstance(document_id, str):
            raise ValueError("document_id must be a string.")
        cleaned = document_id.strip()
        if not cleaned:
            raise ValueError("document_id must not be empty or whitespace only.")
        if len(cleaned) > MAX_DOCUMENT_ID_LENGTH:
            raise ValueError(f"document_id exceeds maximum length of {MAX_DOCUMENT_ID_LENGTH} characters.")
        return cleaned

    def create_analysis_store(self, document_id: str) -> Any:
        """Create or get a document-scoped collection with cosine distance metric."""
        valid_id = self._validate_document_id(document_id)
        collection_name = sanitize_collection_name(valid_id)
        return self._client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )

    def index_clauses(self, document_id: str, clauses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate embeddings and index a list of clauses for a document session."""
        valid_id = self._validate_document_id(document_id)

        if not isinstance(clauses, list):
            raise ValueError("clauses must be a list.")
        if not clauses:
            raise ValueError("clauses list must not be empty.")
        if len(clauses) > MAX_BATCH_CLAUSES:
            raise ValueError(f"clauses batch exceeds maximum allowed of {MAX_BATCH_CLAUSES} items.")

        ids: List[str] = []
        texts: List[str] = []
        metadatas: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()

        for idx, clause in enumerate(clauses):
            if not isinstance(clause, dict):
                raise ValueError(f"Clause at index {idx} must be a dictionary.")

            clause_id = clause.get("clause_id")
            if not clause_id or not isinstance(clause_id, str) or not clause_id.strip():
                raise ValueError(f"Clause at index {idx} is missing a valid non-empty 'clause_id'.")
            cleaned_cid = clause_id.strip()

            if cleaned_cid in seen_ids:
                raise ValueError(f"Duplicate clause_id '{cleaned_cid}' detected in input.")
            seen_ids.add(cleaned_cid)

            text = clause.get("text")
            if not text or not isinstance(text, str) or not text.strip():
                raise ValueError(f"Clause '{cleaned_cid}' has empty or invalid text.")
            cleaned_text = text.strip()
            if len(cleaned_text) > MAX_CLAUSE_TEXT_LENGTH:
                raise ValueError(f"Clause '{cleaned_cid}' text exceeds maximum allowed length.")

            category = clause.get("category", "general")
            category_str = str(category).strip()[:100] if category else "general"

            section = clause.get("section", "")
            section_str = str(section).strip()[:200] if section else ""

            ids.append(cleaned_cid)
            texts.append(cleaned_text)
            metadatas.append({
                "document_id": valid_id,
                "clause_id": cleaned_cid,
                "category": category_str,
                "section": section_str,
                "order": idx
            })

        # Reuse existing singleton embedding engine with safe chunked batching (MAX_BATCH_SIZE = 100)
        embeddings: List[List[float]] = []
        embedding_batch_limit = min(MAX_BATCH_SIZE, 100)
        for i in range(0, len(texts), embedding_batch_limit):
            chunk = texts[i:i + embedding_batch_limit]
            chunk_embeddings = self.embedding_service.embed_batch(chunk)
            embeddings.extend(chunk_embeddings)

        # Store in document-scoped collection
        collection = self.create_analysis_store(valid_id)
        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas
        )

        return {
            "document_id": valid_id,
            "indexed_count": len(ids),
            "status": "success"
        }

    def query(self, document_id: str, query_text: str, top_k: int = DEFAULT_TOP_K) -> List[Dict[str, Any]]:
        """Perform semantic similarity retrieval against a document's vector store."""
        valid_id = self._validate_document_id(document_id)

        if not isinstance(query_text, str) or not query_text.strip():
            raise ValueError("Query text must not be empty or whitespace only.")
        cleaned_query = query_text.strip()
        if len(cleaned_query) > MAX_CLAUSE_TEXT_LENGTH:
            raise ValueError("Query text exceeds maximum allowed length.")

        if not isinstance(top_k, int) or top_k < 1 or top_k > MAX_TOP_K:
            raise ValueError(f"top_k must be an integer between 1 and {MAX_TOP_K}.")

        collection_name = sanitize_collection_name(valid_id)
        try:
            collection = self._client.get_collection(name=collection_name)
        except Exception:
            # Collection does not exist or already cleaned up
            return []

        total_docs = collection.count()
        if total_docs == 0:
            return []

        n_results = min(top_k, total_docs)
        query_vector = self.embedding_service.embed_text(cleaned_query)

        raw_results = collection.query(
            query_embeddings=[query_vector],
            n_results=n_results,
            include=["documents", "metadatas", "distances"]
        )

        formatted_results: List[Dict[str, Any]] = []
        if raw_results and raw_results.get("ids") and raw_results["ids"][0]:
            r_ids = raw_results["ids"][0]
            r_docs = raw_results["documents"][0] if raw_results.get("documents") else []
            r_metas = raw_results["metadatas"][0] if raw_results.get("metadatas") else []
            r_dists = raw_results["distances"][0] if raw_results.get("distances") else []

            for cid, doc, meta, dist in zip(r_ids, r_docs, r_metas, r_dists):
                # Under cosine distance: distance = 1 - cosine_similarity
                # Therefore: similarity = 1 - distance
                distance_val = float(dist)
                similarity_val = round(max(-1.0, min(1.0, 1.0 - distance_val)), 4)

                formatted_results.append({
                    "clause_id": meta.get("clause_id", cid),
                    "text": doc,
                    "category": meta.get("category", "general"),
                    "section": meta.get("section", ""),
                    "order": meta.get("order", 0),
                    "similarity": similarity_val,
                    "similarity_score": similarity_val,
                    "similarityScore": similarity_val,
                    "distance": round(distance_val, 4)
                })

        return formatted_results

    def delete_analysis_store(self, document_id: str) -> bool:
        """Delete document-scoped collection to enforce zero data retention."""
        valid_id = self._validate_document_id(document_id)
        collection_name = sanitize_collection_name(valid_id)
        try:
            self._client.delete_collection(name=collection_name)
            return True
        except Exception:
            return False

    def has_analysis_store(self, document_id: str) -> bool:
        """Check if an analysis collection exists for a given document."""
        valid_id = self._validate_document_id(document_id)
        collection_name = sanitize_collection_name(valid_id)
        try:
            col = self._client.get_collection(name=collection_name)
            return col.count() > 0
        except Exception:
            return False


# Default singleton instance
vector_store_service = VectorStoreService()
