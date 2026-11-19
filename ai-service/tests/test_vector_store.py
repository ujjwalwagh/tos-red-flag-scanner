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


def test_batch_chunking_boundaries_and_embedding_limit(monkeypatch):
    """Verify boundaries (1, 99, 100, 101, 111, 250, 500) and ensure no embed_batch call exceeds 100."""
    original_embed_batch = vector_store_service.embedding_service.embed_batch
    observed_batch_sizes = []

    def tracking_embed_batch(texts):
        observed_batch_sizes.append(len(texts))
        assert len(texts) <= 100, f"Batch size {len(texts)} exceeded MAX_BATCH_SIZE (100)!"
        return original_embed_batch(texts)

    monkeypatch.setattr(vector_store_service.embedding_service, "embed_batch", tracking_embed_batch)

    # Test boundary counts: 1, 99, 100, 101, 111, 250, 400, 401, 500, 501, 600, 693, 1000
    for count in [1, 99, 100, 101, 111, 250, 400, 401, 500, 501, 600, 693, 1000]:
        doc_id = f"test-boundary-{count}"
        observed_batch_sizes.clear()
        clauses = [
            {
                "clause_id": f"c_{count}_{i}",
                "text": f"This is test clause text number {i} for boundary validation count {count}.",
                "category": "boundary_test",
                "section": f"Section {i // 10}"
            }
            for i in range(count)
        ]
        res = vector_store_service.index_clauses(doc_id, clauses)
        assert res["status"] == "success"
        assert res["indexed_count"] == count

        # Verify no batch exceeded 100
        assert all(size <= 100 for size in observed_batch_sizes)
        assert sum(observed_batch_sizes) == count

        # Cleanup
        vector_store_service.delete_analysis_store(doc_id)


def test_indexing_integrity_across_batches():
    """Verify that all clause IDs and metadata survive batching without corruption or loss."""
    doc_id = "test-integrity-111"
    clauses = [
        {
            "clause_id": f"clause_{i}",
            "text": f"Policy clause body {i}: You may cancel your subscription at any time." if i == 77 else f"Policy clause body {i}: Standard terms and provisions.",
            "category": "cancellation" if i == 77 else "general",
            "section": "3. Payment; Cancellation" if i == 77 else "General Terms"
        }
        for i in range(111)
    ]

    res = vector_store_service.index_clauses(doc_id, clauses)
    assert res["status"] == "success"
    assert res["indexed_count"] == 111

    # Query for the specific cancellation clause in batch 1 (index 77)
    results = vector_store_service.query(doc_id, "Can I cancel my subscription?", top_k=5)
    assert len(results) > 0
    top_ids = [r["clause_id"] for r in results]
    assert "clause_77" in top_ids

    # Query a clause from batch 2 (index 105)
    query_b2 = vector_store_service.query(doc_id, "Policy clause body 105", top_k=3)
    assert len(query_b2) > 0
    assert query_b2[0]["clause_id"] == "clause_105"
    assert query_b2[0]["section"] == "General Terms"

    vector_store_service.delete_analysis_store(doc_id)


def test_indexing_failure_atomic(monkeypatch):
    """Verify that if any batch fails, indexing does not report success."""
    doc_id = "test-fail-atomic"
    clauses = [
        {"clause_id": f"c_{i}", "text": f"Clause {i} content text."}
        for i in range(150)
    ]

    call_count = 0
    def failing_embed_batch(texts):
        nonlocal call_count
        call_count += 1
        if call_count > 1:
            raise RuntimeError("Simulated embedding service error on second batch")
        return vector_store_service.embedding_service._get_model().encode(texts, convert_to_numpy=True).tolist()

    monkeypatch.setattr(vector_store_service.embedding_service, "embed_batch", failing_embed_batch)

    with pytest.raises(RuntimeError, match="Simulated embedding service error"):
        vector_store_service.index_clauses(doc_id, clauses)


def test_rejection_over_1000_clauses():
    """Verify rejection when clauses collection exceeds MAX_BATCH_CLAUSES (1000)."""
    doc_id = "test-over-1000"
    clauses = [
        {"clause_id": f"c_{i}", "text": f"Clause {i} content."}
        for i in range(1001)
    ]
    with pytest.raises(ValueError, match="exceeds maximum allowed of 1000"):
        vector_store_service.index_clauses(doc_id, clauses)


def test_api_rejection_over_1000_clauses():
    """Verify HTTP POST /ai/vectors/index rejects payload exceeding 1,000 clauses."""
    clauses = [{"clause_id": f"c_{i}", "text": f"Clause {i} text."} for i in range(1001)]
    res = client.post("/ai/vectors/index", json={"document_id": "test-over-1000", "clauses": clauses})
    assert res.status_code in (400, 422)


def test_similarity_score_field_names_and_precision():
    """Phase 7G-D.8: Verify vector retrieval returns normalized similarity fields."""
    doc_id = "test-similarity-fields"
    vector_store_service.index_clauses(doc_id, SAMPLE_CLAUSES)
    try:
        results = vector_store_service.query(doc_id, "subscription cancellation", top_k=2)
        assert len(results) > 0
        top = results[0]
        # All three field naming conventions must be present and hold identical genuine float scores
        assert "similarity" in top
        assert "similarity_score" in top
        assert "similarityScore" in top
        assert isinstance(top["similarity"], float)
        assert top["similarity"] == top["similarity_score"]
        assert top["similarity"] == top["similarityScore"]
        assert -1.0 <= top["similarity"] <= 1.0

        # Also verify HTTP endpoint returns all three fields
        res = client.post("/ai/vectors/query", json={"document_id": doc_id, "query": "subscription", "top_k": 1})
        assert res.status_code == 200
        http_top = res.json()["results"][0]
        assert http_top["similarity"] == http_top["similarity_score"]
        assert http_top["similarity"] == http_top["similarityScore"]
    finally:
        vector_store_service.delete_analysis_store(doc_id)


