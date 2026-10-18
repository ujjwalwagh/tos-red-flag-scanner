"""Unit and integration tests for ChromaDB vector store and /ai/vectors API (Phase 9.2B).

Verifies document-scoped collection lifecycle, semantic retrieval, top-k ranking,
multi-document isolation, validation, and zero-retention cleanup.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.vector_store import vector_store_service, VectorStoreService

client = TestClient(app)

TEST_DOC_1 = "test-doc-alpha"
TEST_DOC_2 = "test-doc-beta"

SAMPLE_CLAUSES = [
    {
        "clause_id": "c_priv",
        "text": "We may share your personal information with service providers.",
        "category": "privacy",
        "section": "Data Sharing"
    },
    {
        "clause_id": "c_pay",
        "text": "Your subscription renews automatically every month unless cancelled.",
        "category": "payment",
        "section": "Billing"
    },
    {
        "clause_id": "c_canc",
        "text": "You may cancel your subscription at any time through account settings.",
        "category": "cancellation",
        "section": "Account Termination"
    },
    {
        "clause_id": "c_arb",
        "text": "Disputes must be resolved through binding individual arbitration.",
        "category": "arbitration",
        "section": "Dispute Resolution"
    }
]


@pytest.fixture(autouse=True)
def clean_test_collections():
    """Ensure test collections are cleanly removed before and after each test."""
    vector_store_service.delete_analysis_store(TEST_DOC_1)
    vector_store_service.delete_analysis_store(TEST_DOC_2)
    yield
    vector_store_service.delete_analysis_store(TEST_DOC_1)
    vector_store_service.delete_analysis_store(TEST_DOC_2)


def test_create_analysis_store_and_index():
    """Verify document-scoped collection creation, embedding generation, and indexing."""
    result = vector_store_service.index_clauses(TEST_DOC_1, SAMPLE_CLAUSES)
    assert result["status"] == "success"
    assert result["document_id"] == TEST_DOC_1
    assert result["indexed_count"] == len(SAMPLE_CLAUSES)
    assert vector_store_service.has_analysis_store(TEST_DOC_1) is True


def test_semantic_retrieval_and_ranking():
    """Verify semantic similarity retrieval ranks the privacy clause above unrelated clauses."""
    vector_store_service.index_clauses(TEST_DOC_1, SAMPLE_CLAUSES)

    query = "Who can receive my personal data?"
    results = vector_store_service.query(TEST_DOC_1, query, top_k=4)

    assert len(results) == 4
    # The privacy clause must rank #1
    top_result = results[0]
    assert top_result["clause_id"] == "c_priv"
    assert top_result["category"] == "privacy"
    assert "personal information" in top_result["text"].lower()

    # Similarity must be higher than payment/arbitration clauses
    assert top_result["similarity"] > results[1]["similarity"]
    assert top_result["similarity"] > results[2]["similarity"]
    assert top_result["similarity"] > results[3]["similarity"]

    # Validate result fields
    for r in results:
        assert "clause_id" in r
        assert "text" in r
        assert "category" in r
        assert "similarity" in r
        assert "distance" in r
        assert -1.0 <= r["similarity"] <= 1.0


def test_top_k_limiting():
    """Verify top_k parameter strictly caps the returned result count."""
    vector_store_service.index_clauses(TEST_DOC_1, SAMPLE_CLAUSES)

    results_2 = vector_store_service.query(TEST_DOC_1, "subscription billing", top_k=2)
    assert len(results_2) == 2

    results_1 = vector_store_service.query(TEST_DOC_1, "subscription billing", top_k=1)
    assert len(results_1) == 1


def test_document_isolation():
    """Verify different document IDs remain strictly isolated."""
    doc1_clauses = [
        {"clause_id": "d1_c1", "text": "Doc 1 confidentiality clause.", "category": "confidentiality"}
    ]
    doc2_clauses = [
        {"clause_id": "d2_c1", "text": "Doc 2 liability waiver clause.", "category": "liability"}
    ]

    vector_store_service.index_clauses(TEST_DOC_1, doc1_clauses)
    vector_store_service.index_clauses(TEST_DOC_2, doc2_clauses)

    res_doc1 = vector_store_service.query(TEST_DOC_1, "confidentiality", top_k=5)
    assert len(res_doc1) == 1
    assert res_doc1[0]["clause_id"] == "d1_c1"

    res_doc2 = vector_store_service.query(TEST_DOC_2, "confidentiality", top_k=5)
    assert len(res_doc2) == 1
    assert res_doc2[0]["clause_id"] == "d2_c1"


def test_zero_retention_cleanup_lifecycle():
    """Verify explicit cleanup deletes the document collection and subsequent queries return empty."""
    vector_store_service.index_clauses(TEST_DOC_1, SAMPLE_CLAUSES)
    assert vector_store_service.has_analysis_store(TEST_DOC_1) is True

    deleted = vector_store_service.delete_analysis_store(TEST_DOC_1)
    assert deleted is True
    assert vector_store_service.has_analysis_store(TEST_DOC_1) is False

    # Query after cleanup must return empty results
    results_after = vector_store_service.query(TEST_DOC_1, "personal data", top_k=3)
    assert results_after == []

    # Idempotent cleanup should not fail
    deleted_again = vector_store_service.delete_analysis_store(TEST_DOC_1)
    assert deleted_again is False


def test_api_index_and_query_endpoints():
    """Verify HTTP POST /ai/vectors/index and POST /ai/vectors/query work end-to-end."""
    index_payload = {
        "document_id": TEST_DOC_1,
        "clauses": SAMPLE_CLAUSES
    }
    res_index = client.post("/ai/vectors/index", json=index_payload)
    assert res_index.status_code == 200
    data_index = res_index.json()
    assert data_index["status"] == "success"
    assert data_index["indexed_count"] == 4

    query_payload = {
        "document_id": TEST_DOC_1,
        "query": "Who can receive my personal data?",
        "top_k": 2
    }
    res_query = client.post("/ai/vectors/query", json=query_payload)
    assert res_query.status_code == 200
    data_query = res_query.json()
    assert "results" in data_query
    assert len(data_query["results"]) == 2
    assert data_query["results"][0]["clause_id"] == "c_priv"

    # Test HTTP DELETE cleanup
    res_del = client.delete(f"/ai/vectors/{TEST_DOC_1}")
    assert res_del.status_code == 200
    assert res_del.json()["deleted"] is True

    # Confirm query after delete returns empty
    res_query_empty = client.post("/ai/vectors/query", json=query_payload)
    assert res_query_empty.status_code == 200
    assert res_query_empty.json()["results"] == []


def test_api_cleanup_post_endpoint():
    """Verify HTTP POST /ai/vectors/cleanup works as an alternative cleanup endpoint."""
    vector_store_service.index_clauses(TEST_DOC_1, SAMPLE_CLAUSES[:2])
    res = client.post("/ai/vectors/cleanup", json={"document_id": TEST_DOC_1})
    assert res.status_code == 200
    assert res.json()["deleted"] is True


def test_validation_empty_clauses():
    """Verify rejection when clauses list is empty."""
    res = client.post("/ai/vectors/index", json={"document_id": TEST_DOC_1, "clauses": []})
    assert res.status_code in (400, 422)


def test_validation_empty_query():
    """Verify rejection when query text is empty or whitespace only."""
    res_empty = client.post("/ai/vectors/query", json={"document_id": TEST_DOC_1, "query": "", "top_k": 3})
    assert res_empty.status_code in (400, 422)

    res_ws = client.post("/ai/vectors/query", json={"document_id": TEST_DOC_1, "query": "   ", "top_k": 3})
    assert res_ws.status_code in (400, 422)


def test_validation_invalid_top_k():
    """Verify rejection when top_k is zero, negative, or excessive."""
    res_zero = client.post("/ai/vectors/query", json={"document_id": TEST_DOC_1, "query": "test", "top_k": 0})
    assert res_zero.status_code in (400, 422)

    res_excess = client.post("/ai/vectors/query", json={"document_id": TEST_DOC_1, "query": "test", "top_k": 1000})
    assert res_excess.status_code in (400, 422)


def test_validation_missing_clause_id():
    """Verify rejection when a clause lacks a clause_id."""
    invalid_clauses = [{"text": "Valid text but no clause ID"}]
    res = client.post("/ai/vectors/index", json={"document_id": TEST_DOC_1, "clauses": invalid_clauses})
    assert res.status_code in (400, 422)


def test_validation_duplicate_clause_id():
    """Verify rejection when duplicate clause_ids are provided in the same batch."""
    dup_clauses = [
        {"clause_id": "same_id", "text": "First clause"},
        {"clause_id": "same_id", "text": "Second clause"}
    ]
    res = client.post("/ai/vectors/index", json={"document_id": TEST_DOC_1, "clauses": dup_clauses})
    assert res.status_code == 400
    assert "duplicate" in res.json().get("detail", "").lower()
