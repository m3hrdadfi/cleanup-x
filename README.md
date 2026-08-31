<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/public/branding/dark-logo.png">
    <img src="frontend/public/branding/light-logo.png" alt="Cleanup X" width="360">
  </picture>

  <p><strong>A local-first, audit-driven console for reviewing and removing your own X history.</strong></p>

  <p>Python 3.12 · FastAPI · SQLite · React · TypeScript · Ollama</p>
</div>

Cleanup X imports your newest accessible X timeline and your downloaded X archive, classifies posts with a model you control, and turns reviewed selections into resumable deletion jobs. It handles authored posts, replies, quote posts, and reposts without scraping or browser automation.

> [!CAUTION]
> Deleting content from X is permanent. Cleanup X always scans first, creates a manifest, and requires an exact-count confirmation before deletion. Review every selection before proceeding.

## Why Cleanup X

- **Local-first inventory** — application state, audit records, manifests, settings, and cached results stay in local SQLite.
- **Archive-aware coverage** — combine the newest API-accessible timeline with an original X archive ZIP for older history.
- **Natural-language review** — describe content to find, such as posts about a topic in one or more languages.
- **Bring your own model** — use native Ollama or an OpenAI-compatible chat and embedding gateway.
- **Safe deletion jobs** — exact-count confirmation, cost guardrails, rate-limit checkpoints, pause/resume/cancel, and retryable failures.
- **Semantic archive search** — search local post text by meaning, keywords, or a hybrid of both.
- **Evidence and recovery** — export JSON/CSV manifests and inspect an append-only local audit trail.
- **International dashboard** — English, Persian, Swedish, Norwegian Bokmål, Danish, and Finnish, with automatic LTR/RTL layout.
- **Synthetic demo mode** — showcase the product without real posts, X credentials, or live X mutations.

## Safety boundaries

Cleanup X operates only on the X account connected through OAuth 2.0. It uses official X APIs and never scrapes the website.

- Importing, compiling a policy, classifying, indexing, searching, and browsing results never call an X deletion endpoint.
- Authored posts use `DELETE /2/tweets/{id}`; reposts use `DELETE /2/users/{id}/retweets/{source_tweet_id}`.
- Invalid, missing, timed-out, or ambiguous classifications remain unselected.
- Post text is passed to models as untrusted data and cannot override the classifier system prompt.
- X API and hosted-model prices are estimates. The provider dashboards remain the source of truth.
- “Complete history” means the union of accessible API records and the supplied archive, with gaps reported explicitly.

This project is not affiliated with, endorsed by, or sponsored by X Corp.

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+
- An X developer app with OAuth 2.0 Read and Write access for live sync/deletion
- Ollama or an OpenAI-compatible provider for classification
- An embedding model only if semantic search is required

## Quick start

Install backend and frontend dependencies:

```bash
cp .env.example .env
uv sync
uv run alembic upgrade head
cd frontend
npm install
cd ..
```

Start the API on the project’s default safe port:

```bash
uv run fastapi dev --host 127.0.0.1 --port 8787
```

In another terminal, start the dashboard:

```bash
cd frontend
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite development server proxies `/api` to `http://127.0.0.1:8787` by default.

## First-run checklist

1. Open **Settings → X app credentials** and configure or connect the intended X account.
2. Open **Settings → LLM provider**, save the provider URL, key, and model, then run the ping/pong connection test.
3. Upload the unmodified X archive ZIP under **Settings → Archive**.
4. Optionally sync the newest accessible timeline from X.
5. Inspect **Overview** and **Content inventory** before creating a scan.
6. Run a small trial scan, review the compiled policy, and inspect every selected example.
7. Download the manifest and type the exact selection count only when ready to delete.

## X developer setup

1. Sign in to the [X Developer Console](https://console.x.com) and create an app for personal account management.
2. Enable OAuth 2.0, configure the app as a Web App, and grant Read and Write permissions.
3. Register the exact callback URL `http://127.0.0.1:8787/api/auth/x/callback`.
4. Use `http://127.0.0.1:5173` as the website URL if requested.
5. Save the Client ID and Client Secret as `APP_X_CLIENT_ID` and `APP_X_CLIENT_SECRET`, or enter them under **Settings → X app credentials**.
6. Purchase only the API credits you intend to use, disable automatic recharge initially, and set a conservative local guardrail.
7. Restart FastAPI after changing `.env`, then connect X and verify the displayed account.

Cleanup X requests `tweet.read`, `tweet.write`, `users.read`, and `offline.access`. X’s normal user timeline API exposes at most the newest 3,200 items, so API-only inventory must not be treated as complete historical coverage.

## Archive coverage

Request an archive from **X → Settings and privacy → Your account → Download an archive of your data**. Upload the original ZIP under **Settings → Archive**.

The importer:

- reads supported `tweets.js` and partitioned tweet files as data without executing JavaScript;
- rejects unsafe ZIP paths, excessive member counts, suspicious compression ratios, and oversized decompressed content;
- imports text, timestamps, media references, and content types;
- deduplicates archive and API records by post ID;
- reports archive-only records, duplicates, inaccessible content, and reposts without a resolvable source ID;
- removes the temporary uploaded ZIP after processing.

Archive import has no X API read cost. Deleting archive-discovered content still uses X write endpoints, and unresolved reposts may require paid post lookups before they can be unreposted.

## Model providers

### Classification

Configure either:

- **Native Ollama** — for example `http://127.0.0.1:11434` with `qwen2.5:7b`.
- **OpenAI-compatible** — enter the complete API prefix exactly as required by the provider, including `/v1` when necessary.

The app discovers models only after the URL and any required API key are supplied. The connection test verifies model access and structured classification output. Vision is optional and enabled only when the selected model reports support; video analysis is outside the current scope.

### Semantic archive search

Archive search is separate from classification and deletion. It ranks locally available text by normalized cosine similarity, literal keywords, or reciprocal-rank fusion.

1. Configure a dedicated multilingual embedding model under **Settings → Embedding provider**.
2. Save and test it. The test validates vector count, dimensions, and finite nonzero values.
3. Open **Archive search**, approve sending pending post text to the configured provider, and build the incremental index.
4. Search naturally and filter by content type, recorded language, date range, and result count.

Native Ollama uses `/api/embed` and `/api/tags`. Compatible providers receive `/embeddings` and `/models` appended to the exact configured base URL. Query/document prefixes should be set only when the model requires them.

Indexing is checkpointed, idempotent, and incremental. Changed or recorded-deleted posts are excluded from retrieval. Images and video are not embedded. Similarity is not deletion confidence, and search results are never automatically selected for deletion.

> [!IMPORTANT]
> Hosted providers may retain or charge for post and query text. The X spending guardrail does not cap model-provider bills.

## Cleanup workflow

```text
Archive/API import → Policy preview → Classification → Human review
                   → Manifest → Exact-count confirmation → Deletion job → Audit/export
```

1. Enter a cleanup instruction, date range, content types, threshold, and optional post limit. `0` scans every eligible local record.
2. Confirm the compiled policy. Nothing is deleted during compilation or classification.
3. Review matches, uncertain results, failures, and unresolved reposts; deselect mistakes.
4. Download the JSON or CSV manifest.
5. Type the exact selected count and acknowledge that deletion is irreversible.
6. Monitor the persisted job. Pause, resume, or cancel remaining calls as needed.

Jobs checkpoint progress across restarts, honor X rate-limit reset headers, treat already-missing posts as complete, pause for expired authentication, and record permanent failures per item. Cancel prevents future calls but cannot restore completed deletions.

Completed and cancelled jobs remain in **Deletion history**. They can be reopened to export the original manifest, rerun the policy against remaining inventory, or retry actionable failed/unprocessed items. Successful deletions are never copied into a retry job.

## Local inventory removal

**Remove locally** hides a scan session or one item inside a session. It does not delete from X, erase the source post, remove audit evidence, or securely wipe the database. Item removal affects only that session, deselects the item, and excludes it from new manifests. Active scan/deletion jobs must finish or be cancelled first.

## Synthetic demo mode

Create a deterministic database containing 240 clearly synthetic multilingual posts, three scans, simulated deletion records, and audit events:

```bash
uv run python -m app.demo_seed
```

Run the demo API on a separate port:

```bash
APP_DEMO_MODE=true \
APP_DATABASE_URL="sqlite:///./data/cleanup-x-demo.db" \
APP_API_URL="http://127.0.0.1:8788" \
uv run fastapi dev --host 127.0.0.1 --port 8788
```

Run the frontend against it:

```bash
cd frontend
VITE_DEMO_MODE=true \
VITE_API_PROXY_TARGET=http://127.0.0.1:8788 \
npm run dev
```

Demo mode blocks X OAuth, sync, deletion, repost hydration, low-level X requests, and automatic X-job resumption. Locally initiated model calls are still possible and may incur provider charges.

Reset only the demo database with:

```bash
uv run python -m app.demo_seed --replace
```

The seeder refuses the configured live database and filenames without `demo`; replacement also creates a timestamped backup. Never enable demo mode against `data/cleanup-x.db`.

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Dashboard | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn-style components | Setup, inventory, scanning, deletion, search, settings, and audit UI |
| Client state | TanStack Query and TanStack Table | Server state, caching, compact data views |
| API | FastAPI, Pydantic, HTTPX | Typed local API, OAuth, X/model integrations, SSE job events |
| Persistence | SQLAlchemy 2, Alembic, SQLite WAL | Posts, scans, jobs, settings, tokens, embeddings, and audit events |
| Jobs | Persisted in-process runner | Restart-safe sync, classification, indexing, repost resolution, and deletion |
| Localization | react-i18next | Six bundled languages, automatic direction, localized formatting |

The backend binds to `127.0.0.1` by default. This first version is single-user and designed to run with one backend worker.

## Configuration

Copy `.env.example` and treat it as the authoritative list of backend environment variables. Saved dashboard overrides take precedence for X, LLM, embedding, archive-limit, and cost-estimate settings; secret values are masked and encrypted locally. The two `VITE_*` development variables are supplied when starting the frontend.

| Group | Variables |
| --- | --- |
| Runtime | `APP_ENV`, `APP_DEMO_MODE`, `APP_DATABASE_URL`, `APP_FRONTEND_URL`, `APP_API_URL` |
| Encryption | `APP_ENCRYPTION_KEY` |
| X OAuth | `APP_X_CLIENT_ID`, `APP_X_CLIENT_SECRET`, `APP_X_CALLBACK_URL` |
| Archive limits | `APP_MAX_ARCHIVE_MB`, `APP_MAX_ARCHIVE_FILES` |
| Cost estimates | `APP_API_BUDGET_USD`, `APP_DELETE_UNIT_COST_USD`, `APP_OWNED_READ_UNIT_COST_USD`, `APP_POST_LOOKUP_UNIT_COST_USD` |
| Classifier | `APP_LLM_PROVIDER`, `APP_LLM_BASE_URL`, `APP_LLM_MODEL`, `APP_LLM_API_KEY`, `APP_LLM_TIMEOUT_SECONDS`, `APP_LLM_BATCH_SIZE`, `APP_LLM_VISION_ENABLED` |
| Embeddings | `APP_EMBEDDING_PROVIDER`, `APP_EMBEDDING_BASE_URL`, `APP_EMBEDDING_MODEL`, `APP_EMBEDDING_API_KEY`, `APP_EMBEDDING_TIMEOUT_SECONDS`, `APP_EMBEDDING_BATCH_SIZE`, `APP_EMBEDDING_QUERY_PREFIX`, `APP_EMBEDDING_DOCUMENT_PREFIX` |
| Frontend development | `VITE_API_PROXY_TARGET`, `VITE_DEMO_MODE` |

If `APP_ENCRYPTION_KEY` is blank, Cleanup X creates `data/.encryption-key` with owner-only permissions. Back it up with the database: losing the key makes stored OAuth and provider credentials unreadable. For explicit key management, configure a Fernet key before connecting accounts.

The dashboard does not rewrite `.env`. Deployment settings such as database URL and listening URLs require an environment edit and backend restart.

## Data and privacy

- OAuth tokens and saved provider keys are encrypted before storage.
- SQLite databases, archive text, manifests, audit records, and embedding vectors are not whole-database encrypted; protect the project directory and backups.
- The application sends data only to X and the model endpoints you configure.
- Query text is not saved by Cleanup X, though a remote provider may retain it.
- The default CSRF cookie uses `SameSite=Strict`; mutating API calls require the matching token and idempotency keys where applicable.
- API responses include `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`.

See [SECURITY.md](SECURITY.md) for reporting and operational guidance.

## Development

Run backend checks:

```bash
uv run ruff check .
uv run pytest -q
```

Run frontend checks:

```bash
cd frontend
npm test
npm run build
```

Run end-to-end tests:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

Automated tests mock X deletion calls. Use disposable X content for any optional live smoke test.

Project layout:

```text
backend/app/               FastAPI application and integrations
backend/tests/             Backend unit and integration tests
backend/alembic/versions/  Database migrations
frontend/src/              React dashboard
frontend/src/locales/      Typed translations and contributor guide
frontend/tests/            Playwright flows
data/                      Local databases and generated encryption key
exports/                   Generated manifests and reports
```

For contribution standards, localization requirements, and pull-request checks, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project documents

- [Changelog](CHANGELOG.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [MIT License](LICENSE)
- [Localization guide](frontend/src/locales/README.md)

## Support this project

Cleanup X is an independent, self-hosted project maintained in the open. If it's useful to you, consider sponsoring its development:

<p align="left">
  <a href="https://github.com/sponsors/m3hrdadfi">
    <img src="https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub">
  </a>
</p>

Sponsorships fund ongoing development, provider-adapter coverage, and production-hardening work (backups, secrets rotation tooling, broader test coverage). Every bit helps, and every sponsor is genuinely appreciated.


## License

Cleanup X is available under the [MIT License](LICENSE).
