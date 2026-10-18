import math
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.embedding_service import (
    embedding_service,
    EMBEDDING_DIMENSION,
    MAX_TEXT_LENGTH,
    MAX_BATCH_SIZE
)

client = TestClient(app)


def test_embed_single_string_endpoint():
    """Verify POST /ai/embed successfully embeds a single string with dimension 384."""
    payload = {"text": "We may share your information with service providers."}
    response = client.post("/ai/embed", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "embedding" in data
    assert data["dimension"] == EMBEDDING_DIMENSION
    embedding = data["embedding"]
    assert isinstance(embedding, list)
    assert len(embedding) == EMBEDDING_DIMENSION
    assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in embedding)


def test_embed_batch_endpoint():
    """Verify POST /ai/embed successfully embeds a batch of strings."""
    payload = {
        "texts": [
            "We may collect personal data when you use our service.",
            "You agree to resolve disputes through binding individual arbitration."
        ]
    }
    response = client.post("/ai/embed", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "embeddings" in data
    assert data["count"] == 2
    assert data["dimension"] == EMBEDDING_DIMENSION
    assert len(data["embeddings"]) == 2
    for vec in data["embeddings"]:
        assert len(vec) == EMBEDDING_DIMENSION
        assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in vec)


def test_embed_determinism():
    """Verify that identical input strings produce equivalent embeddings."""
    text = "Terms of service are subject to modification at our discretion."
    res1 = client.post("/ai/embed", json={"text": text})
    res2 = client.post("/ai/embed", json={"text": text})
    assert res1.status_code == 200
    assert res2.status_code == 200
    vec1 = res1.json()["embedding"]
    vec2 = res2.json()["embedding"]
    assert len(vec1) == len(vec2) == EMBEDDING_DIMENSION
    for v1, v2 in zip(vec1, vec2):
        assert pytest.approx(v1, rel=1e-5, abs=1e-6) == v2


def test_embed_rejects_empty_and_whitespace():
    """Verify POST /ai/embed rejects empty string and whitespace-only text with HTTP 400."""
    res_empty = client.post("/ai/embed", json={"text": ""})
    assert res_empty.status_code == 400
    assert "empty" in res_empty.json().get("detail", "").lower()

    res_ws = client.post("/ai/embed", json={"text": "   \n\t  "})
    assert res_ws.status_code == 400
    assert "whitespace" in res_ws.json().get("detail", "").lower()


def test_embed_rejects_missing_payload():
    """Verify POST /ai/embed rejects requests where neither text nor texts is provided."""
    response = client.post("/ai/embed", json={})
    assert response.status_code == 400
    assert "either 'text' (single) or 'texts' (batch)" in response.json().get("detail", "").lower()


def test_embed_rejects_both_text_and_texts():
    """Verify POST /ai/embed rejects requests where both text and texts are supplied."""
    payload = {
        "text": "Single clause",
        "texts": ["Batch clause 1", "Batch clause 2"]
    }
    response = client.post("/ai/embed", json=payload)
    assert response.status_code == 400
    assert "not both" in response.json().get("detail", "").lower()


def test_embed_rejects_oversized_single_text():
    """Verify POST /ai/embed rejects single text exceeding MAX_TEXT_LENGTH."""
    oversized = "a" * (MAX_TEXT_LENGTH + 1)
    response = client.post("/ai/embed", json={"text": oversized})
    assert response.status_code == 400
    assert "exceeds maximum allowed length" in response.json().get("detail", "").lower()


def test_embed_rejects_oversized_batch_size():
    """Verify POST /ai/embed rejects batch exceeding MAX_BATCH_SIZE."""
    batch = ["Clause test"] * (MAX_BATCH_SIZE + 1)
    response = client.post("/ai/embed", json={"texts": batch})
    assert response.status_code == 400
    assert "batch size exceeds maximum" in response.json().get("detail", "").lower()


def test_embed_rejects_empty_or_whitespace_in_batch():
    """Verify POST /ai/embed rejects batches containing empty or whitespace items."""
    response = client.post("/ai/embed", json={"texts": ["Valid clause", "   "]})
    assert response.status_code == 400
    assert "whitespace" in response.json().get("detail", "").lower()


def test_embedding_service_unit_methods():
    """Direct unit testing of the EmbeddingService class instance."""
    vec = embedding_service.embed_text("Unit test sample clause")
    assert len(vec) == EMBEDDING_DIMENSION
    assert all(math.isfinite(v) for v in vec)

    batch_vecs = embedding_service.embed_batch(["Clause A", "Clause B"])
    assert len(batch_vecs) == 2
    assert len(batch_vecs[0]) == EMBEDDING_DIMENSION
    assert len(batch_vecs[1]) == EMBEDDING_DIMENSION

    with pytest.raises(ValueError, match="must be a string"):
        embedding_service.embed_text(12345)  # type: ignore

    with pytest.raises(ValueError, match="must be a list"):
        embedding_service.embed_batch("not a list")  # type: ignore

    with pytest.raises(ValueError, match="must not be empty"):
        embedding_service.embed_batch([])
