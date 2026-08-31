# Changelog

All notable changes to Cleanup X are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Release-ready project documentation, contribution guidance, security policy, and MIT license.
- GitHub Actions CI for backend lint/tests and frontend unit, build, and Playwright checks.

### Fixed

- Pin the GitHub Actions uv setup to a resolvable immutable release commit.

## [0.1.0] - 2026-08-31

### Added

- Local-first FastAPI and React dashboard for reviewing personal X history.
- OAuth 2.0 Authorization Code with PKCE for a single connected X account.
- Official X API timeline sync, authored-post deletion, and repost removal.
- Protected X archive ZIP import with deduplication and coverage reporting.
- Natural-language policy compilation and strict structured classification through native Ollama or OpenAI-compatible gateways.
- Confidence-based automatic selection with human review and exact-count deletion confirmation.
- Persisted, restart-safe scan, deletion, repost-resolution, and embedding jobs.
- Pause, resume, cancel, retry, rate-limit handling, Server-Sent Events, manifests, and local audit history.
- Semantic archive search with dedicated embedding settings, incremental indexing, keyword/meaning/hybrid modes, and local filters.
- Overview analytics for posting history, content mix, languages, activity rhythm, hashtags, mentions, scans, and cleanup progress.
- Session-oriented inventory with local-only removal controls.
- Centralized settings for X, classifier, embeddings, archive limits, cost estimates, appearance, retention, and deployment status.
- English, Persian, Swedish, Norwegian Bokmål, Danish, and Finnish interface translations with automatic LTR/RTL direction and Vazirmatn for Persian.
- Light and dark themes using the Cleanup X visual identity.
- Deterministic synthetic demo database and strict safeguards against live X operations in demo mode.
- Backend, frontend, localization, and Playwright test suites.

### Security

- Local encryption for OAuth tokens and saved provider credentials.
- CSRF protection, strict same-site cookies, idempotency keys, masked secrets, safe validation errors, frame denial, and MIME sniffing protection.
- Explicit spending guardrails and confirmation gates for paid or destructive operations.
