"""PrismClause NLI Validation Service.

Validates generated Q&A answers against original Terms of Service evidence clauses
using Natural Language Inference (cross-encoder/nli-deberta-v3-base).

IMPORTANT:
NLI validation measures logical entailment of the answer (hypothesis) given the
ToS evidence clauses (premises). It does not guarantee external factual correctness,
nor does it replace legal review.

Architecture:
- Lazy singleton model loading: Importing this module does NOT load or download weights.
- CPU inference by default for minimal memory overhead and broad compatibility.
- Evaluates each evidence clause as a separate premise against the answer hypothesis.
- Dynamically resolves model label mappings to ensure correct index-to-label alignment.
- Conservative decision thresholds prevent false-positive grounding claims.
"""

from __future__ import annotations
import logging
import math
from typing import Any, Dict, List, Optional
import numpy as np
from sentence_transformers import CrossEncoder

from app.config import settings

logger = logging.getLogger("prismclause.nli")

DEFAULT_MODEL_NAME = "cross-encoder/nli-deberta-v3-base"

# Conservative Decision Thresholds for NLI Validation
# ENTAILMENT_THRESHOLD: Minimum entailment probability required to consider the answer supported.
# An answer is NOT considered supported merely because its contradiction score is low.
ENTAILMENT_THRESHOLD = 0.60

# CONTRADICTION_THRESHOLD: Minimum contradiction probability required to classify as contradicted.
CONTRADICTION_THRESHOLD = 0.50

# Input safety limits
MAX_TEXT_LENGTH = 50_000
MAX_BATCH_EVIDENCE = 50
MAX_COMPOSITE_TEXT_LENGTH = 10_000

# Verified default label mapping for cross-encoder/nli-deberta-v3-base:
# Index 0: contradiction, Index 1: entailment, Index 2: neutral
DEFAULT_LABEL_MAPPING: Dict[int, str] = {
    0: "contradiction",
    1: "entailment",
    2: "neutral"
}


class NliServiceError(Exception):
    """Raised when NLI model loading or inference fails."""
    pass


class NliService:
    """Natural Language Inference validation service using cross-encoder/nli-deberta-v3-base."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL_NAME,
        local_files_only: Optional[bool] = None
    ):
        self.model_name = model_name
        self.local_files_only = local_files_only
        self._model: Optional[CrossEncoder] = None
        self._label_mapping: Optional[Dict[int, str]] = None
        self._is_ready: bool = False
        self._warmup_error: Optional[str] = None

    def is_model_loaded(self) -> bool:
        """Checks if the underlying CrossEncoder model is instantiated in memory."""
        return self._model is not None

    def is_ready(self) -> bool:
        """Checks if the NLI service has completed model loading and warm-up."""
        return self._model is not None and self._is_ready

    def is_model_cached_locally(self) -> bool:
        """Checks whether the required model configuration and weight files exist locally.

        Verifies the Hugging Face hub cache for config.json and weights (safetensors or bin).
        """
        try:
            from huggingface_hub import try_to_load_from_cache
            config_path = try_to_load_from_cache(self.model_name, "config.json")
            if not isinstance(config_path, str):
                return False
            has_weights = (
                isinstance(try_to_load_from_cache(self.model_name, "model.safetensors"), str) or
                isinstance(try_to_load_from_cache(self.model_name, "pytorch_model.bin"), str)
            )
            return has_weights
        except Exception:
            return False

    def _resolve_local_files_only(self) -> bool:
        """Resolves local_files_only based on explicit configuration and local cache state.

        - If explicitly True (via constructor or NLI_LOCAL_FILES_ONLY=true):
          Enforces local-only. If model files are missing, raises NliServiceError.
        - If explicitly False:
          Permits network access / remote download.
        - If None (default):
          Auto-detects: uses local_files_only=True if files are cached locally to prevent
          redundant network round-trips, but does NOT force local_files_only=True if files are missing.
        """
        cfg_val = self.local_files_only
        if cfg_val is None:
            cfg_val = settings.NLI_LOCAL_FILES_ONLY

        if cfg_val is True:
            if not self.is_model_cached_locally():
                raise NliServiceError(
                    f"Local-only NLI mode is enabled (NLI_LOCAL_FILES_ONLY=true), "
                    f"but model '{self.model_name}' was not found in the local cache."
                )
            return True

        if cfg_val is False:
            return False

        # Auto-detect: safe offline-first optimization when cached
        return self.is_model_cached_locally()

    def _get_model(self) -> CrossEncoder:
        """Lazy-loads the CrossEncoder model on CPU."""
        if self._model is None:
            try:
                local_only = self._resolve_local_files_only()
                self._model = CrossEncoder(
                    self.model_name,
                    device="cpu",
                    local_files_only=local_only
                )
                self._resolve_label_mapping()
                self._is_ready = True
                self._warmup_error = None
            except Exception as err:
                self._is_ready = False
                self._warmup_error = str(err)
                if isinstance(err, NliServiceError):
                    raise
                raise NliServiceError(f"Failed to load NLI model '{self.model_name}': {err}") from err
        return self._model

    def warm_up(self) -> bool:
        """Pre-warms the CrossEncoder model singleton.

        Loads the model on CPU if not yet loaded and executes a minimal dry-run inference.
        Reuses existing singleton model instance if already loaded.

        Returns:
            bool: True if model is loaded and ready, False if loading failed.
        """
        if self._model is not None:
            self._is_ready = True
            return True

        try:
            model = self._get_model()
            # Perform a minimal dry run to initialize weights, graph, and tokenizer
            model.predict([["Warmup premise.", "Warmup hypothesis."]])
            self._is_ready = True
            self._warmup_error = None
            logger.info("NLI model '%s' successfully warmed up and ready for inference.", self.model_name)
            return True
        except Exception as err:
            self._is_ready = False
            self._warmup_error = str(err)
            logger.error("Failed to warm up NLI model '%s': %s", self.model_name, err)
            return False

    def _resolve_label_mapping(self) -> Dict[int, str]:
        """Resolves the model's actual label ordering from its configuration.

        Falls back to verified DEFAULT_LABEL_MAPPING ({0: 'contradiction', 1: 'entailment', 2: 'neutral'})
        if the model config is unavailable or incomplete.
        """
        if self._label_mapping is not None:
            return self._label_mapping

        mapping = dict(DEFAULT_LABEL_MAPPING)
        model = self._model
        config = None

        if hasattr(model, "config") and hasattr(model.config, "id2label"):
            config = model.config
        elif hasattr(model, "model") and hasattr(model.model, "config") and hasattr(model.model.config, "id2label"):
            config = model.model.config

        if config and getattr(config, "id2label", None):
            raw_id2label = config.id2label
            resolved: Dict[int, str] = {}
            for k, v in raw_id2label.items():
                try:
                    idx = int(k)
                    label_name = str(v).lower().strip()
                    resolved[idx] = label_name
                except (ValueError, TypeError):
                    continue
            if len(resolved) == 3:
                mapping = resolved

        self._label_mapping = mapping
        return self._label_mapping

    def _build_composite_premise(self, clause_metadata: List[Dict[str, Any]]) -> str:
        """Constructs a bounded composite premise string from evidence clauses."""
        parts: List[str] = []
        current_len = 0
        for item in clause_metadata:
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            if current_len + len(text) > MAX_COMPOSITE_TEXT_LENGTH:
                remaining = MAX_COMPOSITE_TEXT_LENGTH - current_len
                if remaining > 50:
                    parts.append(text[:remaining].strip())
                break
            parts.append(text)
            current_len += len(text) + 2
        return "\n\n".join(parts)

    def validate(
        self,
        answer: str,
        evidence_clauses: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Validates an answer hypothesis against one or more evidence premise clauses.

        Args:
            answer: The generated answer / hypothesis to validate.
            evidence_clauses: List of dicts, each with 'text' (str) and optional 'clause_id' (str).

        Returns:
            Dict containing:
                is_supported (bool): True iff evidence conservatively supports the answer.
                status (str): 'supported', 'contradicted', or 'uncertain'.
                label (str): 'entailment', 'contradiction', or 'neutral'.
                scores (dict): {'entailment': float, 'neutral': float, 'contradiction': float}.
                best_clause_id (str | None): Clause ID with the highest entailment score.
                evaluated_clauses_count (int): Total number of clauses evaluated.
                clause_evaluations (list): Per-clause score breakdown.
                composite_evaluation (dict | None): Joint evaluation over combined premise.

        Raises:
            ValueError: If inputs fail validation constraints.
            NliServiceError: If model execution fails.
        """
        if not isinstance(answer, str):
            raise ValueError("Answer must be a string.")

        cleaned_answer = answer.strip()
        if not cleaned_answer:
            raise ValueError("Answer must not be empty or whitespace only.")

        if len(cleaned_answer) > MAX_TEXT_LENGTH:
            raise ValueError(f"Answer exceeds maximum allowed length of {MAX_TEXT_LENGTH} characters.")

        if not isinstance(evidence_clauses, list):
            raise ValueError("Evidence clauses must be a list.")

        if not evidence_clauses:
            raise ValueError("At least one evidence clause must be provided.")

        if len(evidence_clauses) > MAX_BATCH_EVIDENCE:
            raise ValueError(f"Evidence clauses batch exceeds maximum allowed of {MAX_BATCH_EVIDENCE} items.")

        # Prepare premise-hypothesis pairs
        pairs: List[tuple[str, str]] = []
        clause_metadata: List[Dict[str, Any]] = []

        for idx, clause in enumerate(evidence_clauses):
            if not isinstance(clause, dict):
                raise ValueError(f"Evidence clause at index {idx} must be a dictionary.")

            raw_text = clause.get("text")
            if not isinstance(raw_text, str) or not raw_text.strip():
                raise ValueError(f"Evidence clause at index {idx} must have non-empty 'text'.")

            cleaned_text = raw_text.strip()
            if len(cleaned_text) > MAX_TEXT_LENGTH:
                raise ValueError(f"Evidence clause at index {idx} exceeds maximum allowed length of {MAX_TEXT_LENGTH} characters.")

            raw_cid = clause.get("clause_id")
            clause_id = str(raw_cid).strip() if raw_cid is not None and str(raw_cid).strip() else None

            # CrossEncoder expects (premise, hypothesis)
            pairs.append((cleaned_text, cleaned_answer))
            clause_metadata.append({"clause_id": clause_id, "text": cleaned_text})

        # Run inference for individual clauses
        try:
            model = self._get_model()
            label_mapping = self._resolve_label_mapping()
            raw_scores = model.predict(pairs, apply_softmax=True)
        except NliServiceError:
            raise
        except Exception as err:
            raise NliServiceError(f"Inference execution failed: {err}") from err

        # Normalize score array shape (N, 3)
        scores_arr = np.array(raw_scores)
        if len(scores_arr.shape) == 1:
            scores_arr = np.expand_dims(scores_arr, axis=0)

        if scores_arr.shape[1] != 3:
            raise NliServiceError(f"Unexpected model prediction dimension: {scores_arr.shape[1]}, expected 3.")

        # Evaluate each clause individually
        evaluations: List[Dict[str, Any]] = []
        for idx, row in enumerate(scores_arr):
            scores_dict: Dict[str, float] = {}
            for col_idx in range(3):
                label_name = label_mapping.get(col_idx, f"label_{col_idx}")
                val = float(row[col_idx])
                if not math.isfinite(val):
                    raise NliServiceError("Model prediction contains non-finite values.")
                scores_dict[label_name] = round(val, 4)

            # Determine dominant label for this specific clause
            clause_label = max(scores_dict, key=scores_dict.get)  # type: ignore[arg-type]

            evaluations.append({
                "clause_id": clause_metadata[idx]["clause_id"],
                "label": clause_label,
                "scores": {
                    "entailment": scores_dict.get("entailment", 0.0),
                    "neutral": scores_dict.get("neutral", 0.0),
                    "contradiction": scores_dict.get("contradiction", 0.0)
                }
            })

        # Task 2: Composite Multi-Clause Evaluation
        composite_eval: Optional[Dict[str, Any]] = None
        if len(clause_metadata) == 1:
            # Single clause: composite premise is identical to the single clause
            composite_eval = {
                "label": evaluations[0]["label"],
                "scores": dict(evaluations[0]["scores"])
            }
        elif len(clause_metadata) > 1:
            try:
                composite_premise = self._build_composite_premise(clause_metadata)
                if composite_premise:
                    comp_scores_raw = model.predict(
                        [(composite_premise, cleaned_answer)],
                        apply_softmax=True
                    )
                    comp_arr = np.array(comp_scores_raw)
                    if len(comp_arr.shape) == 1:
                        comp_arr = np.expand_dims(comp_arr, axis=0)

                    if comp_arr.shape[1] == 3:
                        comp_dict: Dict[str, float] = {}
                        for col_idx in range(3):
                            label_name = label_mapping.get(col_idx, f"label_{col_idx}")
                            val = float(comp_arr[0][col_idx])
                            if not math.isfinite(val):
                                raise ValueError("Non-finite prediction in composite evaluation.")
                            comp_dict[label_name] = round(val, 4)

                        if len(comp_dict) == 3:
                            comp_label = max(comp_dict, key=comp_dict.get)  # type: ignore[arg-type]
                            composite_eval = {
                                "label": comp_label,
                                "scores": {
                                    "entailment": comp_dict.get("entailment", 0.0),
                                    "neutral": comp_dict.get("neutral", 0.0),
                                    "contradiction": comp_dict.get("contradiction", 0.0)
                                }
                            }
            except Exception:
                # If composite evaluation fails, preserve successful individual evaluations
                # and fail safe to uncertain rather than failing the entire request.
                composite_eval = None

        # Find best supporting clause (clause with highest entailment score)
        best_supporting_clause = max(evaluations, key=lambda e: e["scores"]["entailment"])
        best_entailment = best_supporting_clause["scores"]["entailment"]
        best_contradiction = max(e["scores"]["contradiction"] for e in evaluations)

        comp_entailment = composite_eval["scores"]["entailment"] if composite_eval else 0.0
        comp_contradiction = composite_eval["scores"]["contradiction"] if composite_eval else 0.0

        contradicting_clauses = [
            e for e in evaluations if e["scores"]["contradiction"] >= CONTRADICTION_THRESHOLD
        ]
        has_isolated_contradiction = len(contradicting_clauses) == 1
        is_multi = len(clause_metadata) > 1

        # Phase 5D Composite-Aware Conflict Resolution Decision Logic:
        # 1. Fallback: If composite evaluation failed on multi-clause input, fail safe to uncertain.
        if is_multi and composite_eval is None:
            status = "uncertain"
            overall_label = "neutral"
            is_supported = False

        # 2. Genuine Contradiction in Complete Evidence:
        # Strong composite contradiction (>= 0.50) without qualifying composite entailment.
        elif comp_contradiction >= CONTRADICTION_THRESHOLD and comp_contradiction > comp_entailment:
            # If an individual clause had entailment >= 0.60, conflicting evidence exists -> uncertain.
            # Do not allow unrelated entailment to mark as supported, but acknowledge unresolved conflict.
            if best_entailment >= ENTAILMENT_THRESHOLD:
                status = "uncertain"
                overall_label = "neutral"
                is_supported = False
            else:
                # Phase 7G-D.6: Only classify as contradicted if at least one individual clause
                # has contradiction >= CONTRADICTION_THRESHOLD (or on single-clause input).
                # If all individual clauses are neutral, long composite text artifact is uncertain.
                if best_contradiction >= CONTRADICTION_THRESHOLD or not is_multi:
                    status = "contradicted"
                    overall_label = "contradiction"
                    is_supported = False
                else:
                    status = "uncertain"
                    overall_label = "neutral"
                    is_supported = False

        # 3. Multiple Individual Clauses Contradict:
        # If 2 or more clauses contradict, the conflict is not isolated. Do not mark as supported.
        elif len(contradicting_clauses) > 1:
            if best_entailment >= ENTAILMENT_THRESHOLD or comp_entailment >= ENTAILMENT_THRESHOLD:
                status = "uncertain"
                overall_label = "neutral"
                is_supported = False
            else:
                status = "contradicted"
                overall_label = "contradiction"
                is_supported = False

        # 4. Composite-Aware Resolution of Isolated Individual Contradiction:
        # If an isolated clause contradicts, strong composite entailment (>= 0.60) resolves it
        # IF AND ONLY IF complete evidence does not indicate genuine contradiction (comp_contradiction < 0.50).
        elif best_contradiction >= CONTRADICTION_THRESHOLD:
            if has_isolated_contradiction and comp_entailment >= ENTAILMENT_THRESHOLD and comp_contradiction < CONTRADICTION_THRESHOLD:
                status = "supported"
                overall_label = "entailment"
                is_supported = True
            elif best_entailment >= ENTAILMENT_THRESHOLD:
                status = "uncertain"
                overall_label = "neutral"
                is_supported = False
            else:
                status = "contradicted"
                overall_label = "contradiction"
                is_supported = False

        # 5. Clean Supported (No Contradiction in Individual Clauses or Complete Evidence):
        # Either composite premise entails OR individual clause entails, with no contradiction anywhere.
        elif (comp_entailment >= ENTAILMENT_THRESHOLD and comp_entailment > comp_contradiction) or \
             (best_entailment >= ENTAILMENT_THRESHOLD and best_entailment > best_contradiction):
            status = "supported"
            overall_label = "entailment"
            is_supported = True

        # 6. Default: Ambiguous / neutral / insufficient evidence
        else:
            status = "uncertain"
            overall_label = "neutral"
            is_supported = False

        # Phase 7G-D.6: Ensure returned status, label, scores, and best_clause_id refer to a consistent evaluation
        if status == "contradicted":
            # When contradicted, return the most contradictory clause so scores and ID match the contradicted status
            best_contradicting_clause = max(evaluations, key=lambda e: e["scores"]["contradiction"])
            chosen_scores = best_contradicting_clause["scores"]
            chosen_clause_id = best_contradicting_clause.get("clause_id")
        elif status == "supported":
            chosen_scores = best_supporting_clause["scores"]
            chosen_clause_id = best_supporting_clause.get("clause_id")
        else:
            # When uncertain / neutral, return best supporting clause evaluation
            chosen_scores = best_supporting_clause["scores"]
            chosen_clause_id = best_supporting_clause.get("clause_id")

        return {
            "is_supported": is_supported,
            "status": status,
            "label": overall_label,
            "scores": chosen_scores,
            "best_clause_id": chosen_clause_id,
            "evaluated_clauses_count": len(evaluations),
            "clause_evaluations": evaluations,
            "composite_evaluation": composite_eval
        }


# Singleton service instance with lazy model loading
nli_service = NliService()

__all__ = [
    "NliService",
    "NliServiceError",
    "nli_service",
    "DEFAULT_MODEL_NAME",
    "ENTAILMENT_THRESHOLD",
    "CONTRADICTION_THRESHOLD",
    "DEFAULT_LABEL_MAPPING",
    "MAX_COMPOSITE_TEXT_LENGTH"
]
