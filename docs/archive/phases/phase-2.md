# Phase 2: Document Ingestion & PDF Processing

## Objectives
- In-memory PDF upload and buffer validation (%PDF- magic byte verification, 10MB file limit).
- Page-by-page text extraction preserving exact page numbering and structural relationships.
- Detection of scanned image pages lacking text layers (requiring OCR notice).
- Text normalization pipeline:
  - Unicode NFKC canonical composition
  - Smart quote and dash standardization
  - Line-break hyphen reconstruction
  - Soft wrap unwrapping while preserving paragraph boundaries
- Deterministic clause segmentation based on section numbering, headings, and legal structural markers.
- `/api/documents/ingest` endpoint.
