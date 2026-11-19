"""Tests for PrismClause NLI Validation Service and Router.

Verifies request validation, conservative decision thresholds, label ordering,
mocked CrossEncoder inference, error shielding, and lazy model loading.
All tests use in-process mocks and NEVER download weights or make external API calls.
"""

from unittest.mock import MagicMock, patch
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.nli_service import (
    NliService,
    NliServiceError,
    nli_service,
    ENTAILMENT_THRESHOLD,
    CONTRADICTION_THRESHOLD,
    DEFAULT_LABEL_MAPPING,
    DEFAULT_MODEL_NAME
)

client = TestClient(app)


# Mock CrossEncoder helper
class MockCrossEncoder:
    def __init__(self, predictions=None, id2label=None):
        self.predictions = predictions if predictions is not None else np.array([[0.05, 0.90, 0.05]])
        self.config = MagicMock()
        self.config.id2label = id2label or {0: "contradiction", 1: "entailment", 2: "neutral"}

    def predict(self, pairs, apply_softmax=True):
        if callable(self.predictions):
            return self.predictions(pairs)
        return self.predictions


@pytest.fixture(autouse=True)
def reset_singleton():
    """Ensure singleton model state is reset between tests."""
    original_model = nli_service._model
    original_mapping = nli_service._label_mapping
    nli_service._model = None
    nli_service._label_mapping = None
    yield
    nli_service._model = original_model
    nli_service._label_mapping = original_mapping


# 1. No model download / loading during module import
def test_no_model_download_during_module_import():
    """Verify importing NLI service or main does not instantiate the underlying CrossEncoder."""
    fresh_service = NliService()
    assert fresh_service._model is None
    assert fresh_service.model_name == DEFAULT_MODEL_NAME
    assert nli_service._model is None


# 2. Request validation for missing or empty answer
def test_request_validation_missing_or_empty_answer():
    """Verify endpoint rejects missing, empty, or whitespace-only answer."""
    # Missing answer field
    res_missing = client.post("/ai/nli/validate", json={
        "evidence": [{"text": "You can cancel anytime in settings.", "clause_id": "c1"}]
    })
    assert res_missing.status_code in (400, 422)

    # Empty string answer
    res_empty = client.post("/ai/nli/validate", json={
        "answer": "",
        "evidence": [{"text": "You can cancel anytime in settings.", "clause_id": "c1"}]
    })
    assert res_empty.status_code in (400, 422)

    # Whitespace-only answer
    res_ws = client.post("/ai/nli/validate", json={
        "answer": "   \n\t  ",
        "evidence": [{"text": "You can cancel anytime in settings.", "clause_id": "c1"}]
    })
    assert res_ws.status_code in (400, 422)


# 3. Request validation for missing or empty evidence
def test_request_validation_missing_or_empty_evidence():
    """Verify endpoint rejects missing, empty, or whitespace-only evidence clauses."""
    # Missing evidence field
    res_missing = client.post("/ai/nli/validate", json={
        "answer": "You can cancel anytime."
    })
    assert res_missing.status_code in (400, 422)

    # Empty evidence list
    res_empty_list = client.post("/ai/nli/validate", json={
        "answer": "You can cancel anytime.",
        "evidence": []
    })
    assert res_empty_list.status_code in (400, 422)

    # Clause with empty text
    res_empty_text = client.post("/ai/nli/validate", json={
        "answer": "You can cancel anytime.",
        "evidence": [{"text": "", "clause_id": "c1"}]
    })
    assert res_empty_text.status_code in (400, 422)

    # Clause with whitespace-only text
    res_ws_text = client.post("/ai/nli/validate", json={
        "answer": "You can cancel anytime.",
        "evidence": [{"text": "   ", "clause_id": "c1"}]
    })
    assert res_ws_text.status_code in (400, 422)


# 4. Successful validation using mocked CrossEncoder (Supported / Entailment)
def test_successful_validation_supported():
    """Verify supported answer returns is_supported=True, status='supported', and label='entailment'."""
    # Mock output: [contradiction=0.03, entailment=0.92, neutral=0.05]
    mock_model = MockCrossEncoder(predictions=np.array([[0.03, 0.92, 0.05]]))
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You may cancel your subscription at any time in account settings.",
        "evidence": [
            {
                "clause_id": "c_cancel_1",
                "text": "Subscriptions may be cancelled at any time by navigating to your Account page."
            }
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is True
    assert data["status"] == "supported"
    assert data["label"] == "entailment"
    assert data["best_clause_id"] == "c_cancel_1"
    assert data["evaluated_clauses_count"] == 1
    assert data["scores"]["entailment"] == pytest.approx(0.92, abs=1e-3)
    assert data["scores"]["contradiction"] == pytest.approx(0.03, abs=1e-3)
    assert data["scores"]["neutral"] == pytest.approx(0.05, abs=1e-3)


# 5. Correct interpretation of model label ordering
def test_correct_interpretation_of_label_ordering():
    """Verify that model config id2label correctly maps indices to contradiction, entailment, neutral."""
    # Verified cross-encoder/nli-deberta-v3-base ordering:
    # 0 -> contradiction, 1 -> entailment, 2 -> neutral
    mock_model = MockCrossEncoder(
        predictions=np.array([[0.10, 0.85, 0.05]]),
        id2label={0: "CONTRADICTION", 1: "ENTAILMENT", 2: "NEUTRAL"}
    )
    nli_service._model = mock_model

    result = nli_service.validate(
        answer="You can cancel anytime.",
        evidence_clauses=[{"text": "Cancel anytime in settings.", "clause_id": "c1"}]
    )

    assert result["scores"]["contradiction"] == pytest.approx(0.10)
    assert result["scores"]["entailment"] == pytest.approx(0.85)
    assert result["scores"]["neutral"] == pytest.approx(0.05)
    assert result["label"] == "entailment"
    assert result["is_supported"] is True


def test_dynamic_label_mapping_adaptation():
    """Verify _resolve_label_mapping dynamically adapts if an alternate label ordering is passed."""
    # Alternate mock ordering: 0 -> entailment, 1 -> neutral, 2 -> contradiction
    alt_model = MockCrossEncoder(
        predictions=np.array([[0.88, 0.08, 0.04]]),
        id2label={0: "entailment", 1: "neutral", 2: "contradiction"}
    )
    service = NliService()
    service._model = alt_model
    mapping = service._resolve_label_mapping()

    assert mapping[0] == "entailment"
    assert mapping[1] == "neutral"
    assert mapping[2] == "contradiction"

    res = service.validate(
        answer="Subscriptions renew monthly.",
        evidence_clauses=[{"text": "Your plan renews every 30 days.", "clause_id": "c_renew"}]
    )
    assert res["scores"]["entailment"] == pytest.approx(0.88)
    assert res["scores"]["neutral"] == pytest.approx(0.08)
    assert res["scores"]["contradiction"] == pytest.approx(0.04)
    assert res["is_supported"] is True


# 6. Contradiction handling
def test_contradiction_handling():
    """Verify contradicted answer returns is_supported=False, status='contradicted', label='contradiction'."""
    # Mock output: [contradiction=0.88, entailment=0.04, neutral=0.08]
    mock_model = MockCrossEncoder(predictions=np.array([[0.88, 0.04, 0.08]]))
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You can get a full refund within 30 days of cancellation.",
        "evidence": [
            {
                "clause_id": "c_no_refund",
                "text": "All subscription fees are strictly non-refundable under all circumstances."
            }
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is False
    assert data["status"] == "contradicted"
    assert data["label"] == "contradiction"
    assert data["scores"]["contradiction"] == pytest.approx(0.88, abs=1e-3)
    assert data["scores"]["entailment"] == pytest.approx(0.04, abs=1e-3)


# 7. Neutral / uncertain handling
def test_neutral_and_uncertain_handling():
    """Verify ungrounded/ambiguous answer returns is_supported=False, status='uncertain', label='neutral'."""
    # Mock output: [contradiction=0.15, entailment=0.30, neutral=0.55]
    mock_model = MockCrossEncoder(predictions=np.array([[0.15, 0.30, 0.55]]))
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "We will send an SMS reminder 3 days before renewal.",
        "evidence": [
            {
                "clause_id": "c_terms",
                "text": "Subscriptions renew automatically each month until terminated."
            }
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is False
    assert data["status"] == "uncertain"
    assert data["label"] == "neutral"


# 8. Conservative threshold: Low contradiction does NOT imply supported
def test_conservative_threshold_low_contradiction_not_supported():
    """Verify an answer with low contradiction is NOT supported unless entailment exceeds threshold."""
    # Mock output: contradiction=0.05 (very low), entailment=0.48 (< 0.60 threshold), neutral=0.47
    mock_model = MockCrossEncoder(predictions=np.array([[0.05, 0.48, 0.47]]))
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "The trial period can be extended upon request.",
        "evidence": [
            {"clause_id": "c_trial", "text": "Free trial lasts for 14 days."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    # Even though contradiction is only 0.05, entailment (0.48) is below 0.60
    assert data["is_supported"] is False
    assert data["status"] == "uncertain"
    assert data["label"] == "neutral"


# 9. Multiple evidence clauses & best supporting clause selection
def test_multiple_evidence_clauses_selection():
    """Verify multi-clause validation picks the clause with highest entailment as best_clause_id."""
    # Clause 1: [contradiction=0.10, entailment=0.35, neutral=0.55]
    # Clause 2: [contradiction=0.02, entailment=0.94, neutral=0.04] (strong support)
    predictions = np.array([
        [0.10, 0.35, 0.55],
        [0.02, 0.94, 0.04]
    ])
    mock_model = MockCrossEncoder(predictions=predictions)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "To cancel, visit account settings and click Cancel Subscription.",
        "evidence": [
            {"clause_id": "clause_intro", "text": "Welcome to our streaming service."},
            {"clause_id": "clause_cancellation", "text": "You can cancel your subscription in account settings."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is True
    assert data["status"] == "supported"
    assert data["best_clause_id"] == "clause_cancellation"
    assert data["evaluated_clauses_count"] == 2
    assert data["scores"]["entailment"] == pytest.approx(0.94, abs=1e-3)
    assert len(data["clause_evaluations"]) == 2
    assert data["clause_evaluations"][1]["clause_id"] == "clause_cancellation"


# 10. Model loading or inference failure handling
def test_model_loading_and_inference_failure_handling():
    """Verify model loading and execution failures return clean HTTP 500 without stack traces."""
    # Failure during inference
    mock_failing_model = MagicMock()
    mock_failing_model.predict.side_effect = RuntimeError("CUDA out of memory or device error")
    mock_failing_model.config.id2label = {0: "contradiction", 1: "entailment", 2: "neutral"}
    nli_service._model = mock_failing_model

    payload = {
        "answer": "Sample answer",
        "evidence": [{"clause_id": "c1", "text": "Sample evidence"}]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 500
    data = res.json()
    assert "detail" in data
    # Error detail should be sanitized and safe
    assert "CUDA" not in data["detail"]
    assert "NLI validation" in data["detail"]


# 11. Unit tests on NliService input validation
def test_nli_service_unit_validation_constraints():
    """Verify unit-level validation on answer and evidence inputs."""
    service = NliService()

    # Non-string answer
    with pytest.raises(ValueError, match="Answer must be a string"):
        service.validate(answer=123, evidence_clauses=[{"text": "valid"}])  # type: ignore

    # Empty answer
    with pytest.raises(ValueError, match="Answer must not be empty"):
        service.validate(answer="   ", evidence_clauses=[{"text": "valid"}])

    # Non-list evidence
    with pytest.raises(ValueError, match="Evidence clauses must be a list"):
        service.validate(answer="valid", evidence_clauses="invalid")  # type: ignore

    # Empty evidence list
    with pytest.raises(ValueError, match="At least one evidence clause"):
        service.validate(answer="valid", evidence_clauses=[])

    # Clause without text
    with pytest.raises(ValueError, match="must have non-empty 'text'"):
        service.validate(answer="valid", evidence_clauses=[{"clause_id": "c1"}])


# 12. Conflict detection: strong entailment + strong contradiction must NOT return supported
def test_conflict_detection_strong_entailment_and_contradiction():
    """Verify that when evidence contains both strong entailment and strong contradiction,
    it returns status='uncertain' (conflict) rather than falsely marking supported."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.02, 0.92, 0.06],  # Clause 1: Entailment
                [0.88, 0.03, 0.09]   # Clause 2: Contradiction
            ])
        return np.array([[0.75, 0.20, 0.05]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You can cancel your subscription at any time and get a full refund.",
        "evidence": [
            {
                "clause_id": "c_cancel_ok",
                "text": "Subscriptions may be cancelled at any time through account settings."
            },
            {
                "clause_id": "c_no_refund",
                "text": "All subscription payments are strictly non-refundable."
            }
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    # Must NOT be marked supported despite 0.92 entailment on clause 1
    assert data["is_supported"] is False
    assert data["status"] == "uncertain"
    assert data["label"] == "neutral"
    # Both evaluations must be retained
    assert len(data["clause_evaluations"]) == 2
    assert data["clause_evaluations"][0]["clause_id"] == "c_cancel_ok"
    assert data["clause_evaluations"][0]["label"] == "entailment"
    assert data["clause_evaluations"][1]["clause_id"] == "c_no_refund"
    assert data["clause_evaluations"][1]["label"] == "contradiction"


# 13. Strong entailment + neutral clause remains supported
def test_strong_entailment_plus_neutral_clause_remains_supported():
    """Verify that a benign neutral clause does not prevent a strongly supported claim from being supported."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.03, 0.94, 0.03],  # Clause 1: Entailment
                [0.05, 0.10, 0.85]   # Clause 2: Neutral
            ])
        return np.array([[0.04, 0.91, 0.05]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You can cancel anytime in settings.",
        "evidence": [
            {"clause_id": "c1", "text": "Users can cancel their plan anytime in account settings."},
            {"clause_id": "c2", "text": "We may update this policy periodically."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is True
    assert data["status"] == "supported"
    assert data["label"] == "entailment"
    assert data["best_clause_id"] == "c1"


# 14. Strong contradiction without entailment preserves contradiction status
def test_strong_contradiction_without_entailment_preserved():
    """Verify that pure contradiction without competing entailment remains contradicted."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.85, 0.05, 0.10],  # Contradiction
                [0.10, 0.10, 0.80]   # Neutral
            ])
        return np.array([[0.82, 0.06, 0.12]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "Users can share accounts across multiple households.",
        "evidence": [
            {"clause_id": "c_no_share", "text": "Account sharing outside your household is strictly prohibited."},
            {"clause_id": "c_general", "text": "Subscription fees are billed monthly."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is False
    assert data["status"] == "contradicted"
    assert data["label"] == "contradiction"


# 15. Composite multi-clause joint entailment
def test_composite_multi_clause_joint_entailment():
    """Verify that when individual clauses are neutral, but the composite premise
    jointly entails the claim, the answer is validated as supported."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            # Individual clauses alone are neutral
            return np.array([
                [0.05, 0.35, 0.60],  # Clause 1: Neutral
                [0.05, 0.40, 0.55]   # Clause 2: Neutral
            ])
        # Composite premise jointly entails the answer!
        return np.array([[0.03, 0.88, 0.09]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You must cancel by November 2nd to avoid being billed on January 1st.",
        "evidence": [
            {"clause_id": "c_billing_date", "text": "Annual plans renew and are billed on January 1st."},
            {"clause_id": "c_notice_window", "text": "Cancellations must be received 60 days before the renewal date."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is True
    assert data["status"] == "supported"
    assert data["label"] == "entailment"
    assert "composite_evaluation" in data
    assert data["composite_evaluation"]["label"] == "entailment"
    assert data["composite_evaluation"]["scores"]["entailment"] == pytest.approx(0.88, abs=1e-3)


# 16. Composite evaluation failure fails safely to uncertain
def test_composite_evaluation_failure_fails_safely():
    """Verify that if composite evaluation raises an exception, individual evaluations
    are preserved and the overall status fails safe to uncertain."""
    call_count = 0
    def mock_predict(pairs, apply_softmax=True):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # Individual evaluations succeed
            return np.array([
                [0.05, 0.70, 0.25],
                [0.05, 0.65, 0.30]
            ])
        # Composite evaluation throws unexpected exception
        raise RuntimeError("Composite premise inference failed")

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "Some answer",
        "evidence": [
            {"clause_id": "c1", "text": "Clause 1 text"},
            {"clause_id": "c2", "text": "Clause 2 text"}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is False
    assert data["status"] == "uncertain"
    assert data["composite_evaluation"] is None
    # Individual evaluations must still be preserved
    assert len(data["clause_evaluations"]) == 2
    assert data["clause_evaluations"][0]["clause_id"] == "c1"


# 17. Original clause IDs preserved in multi-clause evaluation
def test_original_clause_ids_strictly_preserved():
    """Verify that user-provided clause IDs are preserved unaltered across evaluations."""
    mock_model = MockCrossEncoder(predictions=np.array([[0.1, 0.8, 0.1], [0.1, 0.2, 0.7]]))
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You can cancel in settings.",
        "evidence": [
            {"clause_id": "CUSTOM_UNIQUE_ID_101", "text": "Cancel anytime."},
            {"clause_id": "CUSTOM_UNIQUE_ID_202", "text": "No refunds."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    ids = [e["clause_id"] for e in data["clause_evaluations"]]
    assert ids == ["CUSTOM_UNIQUE_ID_101", "CUSTOM_UNIQUE_ID_202"]


# 18. Phase 5D: Composite-aware resolution of isolated individual contradiction
def test_composite_aware_resolution_isolated_contradiction():
    """Verify that an isolated contradiction (e.g. general rule vs exception) is resolved
    when the composite evaluation demonstrates strong entailment and low contradiction."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.95, 0.01, 0.04],  # Clause 1: Isolated contradiction
                [0.01, 0.98, 0.01]   # Clause 2: Strong entailment
            ])
        # Composite premise: strong entailment, near-zero contradiction
        return np.array([[0.005, 0.990, 0.005]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "No, all subscription payments are strictly non-refundable after processing.",
        "evidence": [
            {"clause_id": "c_cancel", "text": "Customers may cancel subscriptions through account settings."},
            {"clause_id": "c_refund", "text": "All subscription payments are non-refundable after payment has been processed."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is True
    assert data["status"] == "supported"
    assert data["label"] == "entailment"
    assert data["composite_evaluation"]["label"] == "entailment"
    assert data["composite_evaluation"]["scores"]["entailment"] == pytest.approx(0.99, abs=1e-2)
    # Individual evaluations preserved
    assert len(data["clause_evaluations"]) == 2
    assert data["clause_evaluations"][0]["label"] == "contradiction"
    assert data["clause_evaluations"][1]["label"] == "entailment"


# 19. Phase 5D: Multiple contradicting clauses cannot be resolved by composite entailment
def test_composite_aware_multiple_contradicting_clauses_not_resolved():
    """Verify that when 2 or more clauses contradict, the answer is NOT marked supported."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 3:
            return np.array([
                [0.85, 0.05, 0.10],  # Clause 1: Contradiction
                [0.90, 0.02, 0.08],  # Clause 2: Contradiction
                [0.05, 0.92, 0.03]   # Clause 3: Entailment
            ])
        # Composite premise tries to claim entailment
        return np.array([[0.05, 0.90, 0.05]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "Some controversial answer claiming multiple permissions.",
        "evidence": [
            {"clause_id": "c1", "text": "Prohibition 1 text."},
            {"clause_id": "c2", "text": "Prohibition 2 text."},
            {"clause_id": "c3", "text": "Permission text."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    assert data["is_supported"] is False
    assert data["status"] == "uncertain"
    assert data["label"] == "neutral"


# 20. Phase 5D: High individual entailment does NOT mark supported if composite contradiction is high
def test_high_individual_entailment_overridden_by_composite_contradiction():
    """Verify that an individual entailment score cannot hide a clear composite contradiction."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.05, 0.95, 0.00],  # Clause 1: High entailment
                [0.85, 0.05, 0.10]   # Clause 2: Contradiction
            ])
        # Composite premise clearly contradicts the overall claim
        return np.array([[0.88, 0.04, 0.08]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._resolve_label_mapping()

    payload = {
        "answer": "You can share content and redistribute it commercially without authorization.",
        "evidence": [
            {"clause_id": "c1", "text": "Users may share content."},
            {"clause_id": "c2", "text": "Commercial redistribution is prohibited without authorization."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()

    # Must be uncertain because of competing individual entailment, but NEVER supported!
    assert data["is_supported"] is False
    assert data["status"] == "uncertain"
    assert data["label"] == "neutral"


# 21. Phase 7G-C: Successful model warm-up
def test_successful_model_warm_up():
    """Verify warm_up loads CrossEncoder, executes dummy prediction, and marks service ready."""
    mock_model = MockCrossEncoder()
    with patch("app.services.nli_service.CrossEncoder", return_value=mock_model):
        fresh_service = NliService()
        assert fresh_service.is_model_loaded() is False
        assert fresh_service.is_ready() is False

        success = fresh_service.warm_up()

        assert success is True
        assert fresh_service.is_model_loaded() is True
        assert fresh_service.is_ready() is True
        assert fresh_service._model is mock_model


# 22. Phase 7G-C: Model loaded only once (warm-up idempotency)
def test_model_loaded_only_once():
    """Verify subsequent warm_up calls reuse the existing instance and do not reload."""
    mock_model = MockCrossEncoder()
    fresh_service = NliService()
    fresh_service._model = mock_model
    fresh_service._resolve_label_mapping()

    with patch("app.services.nli_service.CrossEncoder") as mock_cls:
        success = fresh_service.warm_up()
        assert success is True
        assert fresh_service._model is mock_model
        # Constructor should NOT have been called again
        mock_cls.assert_not_called()


# 23. Phase 7G-C: Startup continues when model warm-up fails
def test_startup_continues_when_warmup_fails():
    """Verify warm_up handles model loading errors gracefully without raising unhandled exceptions."""
    fresh_service = NliService()
    with patch.object(fresh_service, "_get_model", side_effect=NliServiceError("Network offline")):
        success = fresh_service.warm_up()
        assert success is False
        assert fresh_service.is_model_loaded() is False
        assert fresh_service.is_ready() is False
        assert "Network offline" in str(fresh_service._warmup_error)


# 24. Phase 7G-C: Local-only mode with cached model
def test_local_only_mode_with_cached_model():
    """Verify local_files_only=True succeeds when required files are confirmed in local cache."""
    service = NliService(local_files_only=True)
    with patch.object(service, "is_model_cached_locally", return_value=True):
        assert service._resolve_local_files_only() is True


# 25. Phase 7G-C: Local-only mode with missing model raises clear error
def test_local_only_mode_with_missing_model_fails_clearly():
    """Verify local_files_only=True raises NliServiceError with actionable message when files are missing."""
    service = NliService(local_files_only=True)
    with patch.object(service, "is_model_cached_locally", return_value=False):
        with pytest.raises(NliServiceError) as exc_info:
            service._resolve_local_files_only()
        assert "Local-only NLI mode is enabled" in str(exc_info.value)
        assert "not found in the local cache" in str(exc_info.value)


# 26. Phase 7G-C: NLI inference after successful warm-up
def test_nli_inference_after_successful_warmup():
    """Verify endpoint serves inference correctly using the pre-warmed model."""
    mock_model = MockCrossEncoder(predictions=np.array([[0.05, 0.92, 0.03]]))
    with patch("app.services.nli_service.CrossEncoder", return_value=mock_model):
        warmed = nli_service.warm_up()
        assert warmed is True

        payload = {
            "answer": "Users may cancel their account anytime in settings.",
            "evidence": [{"clause_id": "c_cancel", "text": "You may cancel your account at any time in user settings."}]
        }
        res = client.post("/ai/nli/validate", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["is_supported"] is True
        assert data["status"] == "supported"
        assert data["label"] == "entailment"


# 27. Phase 7G-C: Health and NLI status endpoints distinguish model readiness
def test_health_and_status_endpoints_distinguish_model_readiness():
    """Verify /health and /ai/nli/status report model_loaded accurately."""
    # Before loading
    nli_service._model = None
    nli_service._is_ready = False
    res_cold = client.get("/health")
    assert res_cold.status_code == 200
    assert res_cold.json()["status"] == "ok"
    assert res_cold.json()["model_loaded"] is False

    status_cold = client.get("/ai/nli/status")
    assert status_cold.status_code == 200
    assert status_cold.json()["status"] == "degraded"
    assert status_cold.json()["model_loaded"] is False

    # After simulated warm-up
    nli_service._model = MockCrossEncoder()
    nli_service._is_ready = True
    res_warm = client.get("/health")
    assert res_warm.status_code == 200
    assert res_warm.json()["status"] == "ok"
    assert res_warm.json()["model_loaded"] is True

    status_warm = client.get("/ai/nli/status")
    assert status_warm.status_code == 200
    assert status_warm.json()["status"] == "ready"
    assert status_warm.json()["model_loaded"] is True


# 28. Phase 7G-C: FastAPI lifespan executes warm-up and continues on failure
def test_fastapi_lifespan_warmup_and_failure_shield():
    """Verify FastAPI lifespan triggers warm-up and shields failures during startup."""
    mock_model = MockCrossEncoder()

    # Success case
    with patch("app.services.nli_service.CrossEncoder", return_value=mock_model):
        with TestClient(app) as test_client:
            res = test_client.get("/health")
            assert res.status_code == 200
            assert res.json()["status"] == "ok"
            assert res.json()["model_loaded"] is True

    # Failure case: lifespan shields failure and service still starts
    with patch.object(nli_service, "warm_up", side_effect=Exception("Simulated GPU/RAM error")):
        nli_service._model = None
        with TestClient(app) as test_client:
            res = test_client.get("/health")
            assert res.status_code == 200
            assert res.json()["status"] == "ok"
            assert res.json()["model_loaded"] is False


# 29. Phase 7G-D.6: Contradicted status guarantees contradiction score >= 0.50 and points to contradicting clause
def test_contradicted_status_score_and_clause_consistency():
    """Verify that when status is contradicted, scores reflect the contradiction and clause ID is aligned."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.01, 0.01, 0.98],  # clause 1: [con=0.01, ent=0.01, neu=0.98]
                [0.88, 0.02, 0.10]   # clause 2: [con=0.88, ent=0.02, neu=0.10]
            ])
        # Composite premise
        return np.array([[0.85, 0.05, 0.10]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._label_mapping = {0: "contradiction", 1: "entailment", 2: "neutral"}

    payload = {
        "answer": "Users receive an unconditional instant full cash refund.",
        "evidence": [
            {"clause_id": "c_general", "text": "These terms govern your use of the service."},
            {"clause_id": "c_no_refund", "text": "All subscription payments are strictly non-refundable."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "contradicted"
    assert data["label"] == "contradiction"
    assert data["is_supported"] is False
    assert data["scores"]["contradiction"] >= 0.50
    assert data["scores"]["contradiction"] == 0.88
    assert data["best_clause_id"] == "c_no_refund"


# 30. Phase 7G-D.6: Neutral multi-clause evidence fails safe to uncertain and does not classify as contradicted
def test_neutral_multi_clause_does_not_classify_as_contradicted():
    """Verify that when individual clauses are neutral, long composite text artifact fails safe to uncertain."""
    def mock_predict(pairs, apply_softmax=True):
        if len(pairs) == 2:
            return np.array([
                [0.01, 0.01, 0.98],
                [0.02, 0.02, 0.96]
            ])
        # Composite premise: artifact produces [con=0.60, ent=0.05, neu=0.35]
        return np.array([[0.60, 0.05, 0.35]])

    mock_model = MockCrossEncoder(predictions=mock_predict)
    nli_service._model = mock_model
    nli_service._label_mapping = {0: "contradiction", 1: "entailment", 2: "neutral"}

    payload = {
        "answer": "The provided Terms of Service evidence does not contain enough information to answer whether you can cancel your subscription.",
        "evidence": [
            {"clause_id": "clause_138", "text": "Spotify may terminate the Agreements or suspend your access."},
            {"clause_id": "clause_49", "text": "You may use the Spotify Service only for personal, non-commercial purposes."}
        ]
    }

    res = client.post("/ai/nli/validate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "uncertain"
    assert data["label"] == "neutral"
    assert data["is_supported"] is False

