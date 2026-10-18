import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_app_imports_successfully():
    """Verify FastAPI application instance exists and imports cleanly."""
    assert app is not None
    assert app.title == "PrismClause AI Service"

def test_health_endpoint():
    """Verify GET /health returns HTTP 200 with JSON status == 'ok'."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("application/json")
    data = response.json()
    assert isinstance(data, dict)
    assert data.get("status") == "ok"
