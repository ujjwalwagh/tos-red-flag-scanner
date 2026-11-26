# Phase 1: MVP Scanner & Security Guardrails

## Objectives
- Safe URL fetching with comprehensive SSRF protection (blocking loopback, link-local, and RFC1918 private IPv4/IPv6 addresses).
- Readability analysis scoring (Flesch-Kincaid & legalese term density metrics).
- Express HTTP server with Helmet security headers, rate limiting, and structured logging.
- Initial `/api/scan` endpoint.
