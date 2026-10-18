# Phase 4: AI & Semantic Analysis Layer

## Objectives
- Provider-agnostic AI layer running on top of Phase 2 segmentation and Phase 3 rule findings.
- NVIDIA NIM API integration (`meta/llama-3.1-70b-instruct`) with configurable fallback.
- `NullProvider` pattern ensuring zero network calls and complete graceful degradation when no API key is provided.
- JSON response schema validation and sanitization.
- Result merging: preserves deterministic rule verification while enriching plain-English translations and uncovering nuanced semantic risks.
