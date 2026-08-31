# Contributing to Cleanup X

Thank you for helping improve Cleanup X. Contributions should preserve its local-first design, explicit consent boundaries, and auditability.

## Before you start

- Search existing issues and pull requests before proposing overlapping work.
- Discuss large changes—new providers, schema redesigns, deployment modes, or destructive workflows—before implementation.
- Never include real X archives, posts, IDs, OAuth tokens, provider keys, database files, manifests, or screenshots containing personal content.
- Keep changes focused. Do not combine unrelated refactors with a feature or fix.

## Development setup

Requirements:

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+

Install the project:

```bash
cp .env.example .env
uv sync
uv run alembic upgrade head
cd frontend
npm install
cd ..
```

Run the backend:

```bash
uv run fastapi dev --host 127.0.0.1 --port 8787
```

Run the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Use the synthetic demo database for screenshots, manual testing, and reproducible examples:

```bash
uv run python -m app.demo_seed
APP_DEMO_MODE=true \
APP_DATABASE_URL="sqlite:///./data/cleanup-x-demo.db" \
APP_API_URL="http://127.0.0.1:8788" \
uv run fastapi dev --host 127.0.0.1 --port 8788
```

Then start the frontend with `VITE_DEMO_MODE=true` and `VITE_API_PROXY_TARGET=http://127.0.0.1:8788`.

## Project conventions

### Backend

- Use typed Python 3.12, FastAPI request/response schemas, SQLAlchemy 2 patterns, and `httpx` for HTTP clients.
- Keep external calls behind explicit service/client boundaries so tests can mock them.
- Persist checkpoints before and after irreversible or billable operations.
- Require CSRF protection for mutations and idempotency keys for retryable job creation.
- Never log or return raw credentials, OAuth tokens, archive contents, or unnecessary post text.
- Add an Alembic migration for durable schema changes. Keep startup compatibility in mind, but do not rely only on `create_all` for released migrations.
- Preserve the single-user, single-worker assumptions unless a proposal explicitly redesigns them.

### Frontend

- Use TypeScript, React, TanStack Query for server state, and existing components/tokens before introducing dependencies.
- Keep the interface keyboard accessible, responsive, and usable in light/dark modes.
- Use logical CSS properties so layouts work in LTR and RTL.
- Do not use color as the only status signal.
- Avoid motion; the current visual system intentionally has no transition-heavy behavior.
- All app-owned interface text must use localization keys.

### Localization

The dashboard requires complete typed locale files. When adding or changing interface text:

1. Update `frontend/src/locales/en.ts` and every bundled locale.
2. Preserve interpolation variables and plural categories.
3. Keep user posts, prompts, policies, IDs, and model output in their original language.
4. Run localization coverage tests.

See [frontend/src/locales/README.md](frontend/src/locales/README.md) for the full translation workflow.

## Safety requirements

Changes touching X, classification, manifests, or deletion must demonstrate that:

- import, sync, policy compilation, classification, indexing, and search cannot call deletion endpoints;
- `0.849` remains below a `0.85` automatic-selection threshold and `0.85` is included;
- invalid or incomplete model output is non-deletable;
- authored posts and reposts use their correct endpoints and identifiers;
- exact-count confirmation and a valid manifest are required before deletion;
- rate limits, authentication expiry, missing posts, retries, cancellation, and restart recovery are handled explicitly;
- demo mode cannot reach live X OAuth, read, lookup, or write operations;
- cost estimates are labeled estimates and checked against the configured guardrail;
- imported or model-generated text is treated as untrusted data.

Do not perform live X deletion in automated tests. Optional live smoke tests must use disposable content on an account controlled by the tester.

## Tests and quality checks

Run before opening a pull request:

```bash
uv run ruff check .
uv run pytest -q

cd frontend
npm test
npm run build
npm run test:e2e
```

Install Playwright’s browser once with `npx playwright install chromium`.

Add or update tests in proportion to risk:

- backend unit/integration tests for validation, persistence, job restart, provider failures, and API behavior;
- frontend tests for loading, empty, error, paused, rate-limited, LTR, RTL, and translated states;
- Playwright flows for destructive confirmations and critical navigation;
- hostile archive fixtures for parser security changes;
- deterministic fake servers for model-provider adapters.

## Database changes

Create a migration with:

```bash
uv run alembic revision -m "describe the change"
```

Review the generated file, test upgrading a temporary database, and ensure existing data is preserved. Avoid destructive migrations unless the migration includes an explicit recovery or backup strategy.

## Documentation changes

Update documentation whenever behavior, configuration, routes, costs, provider requirements, or safety boundaries change:

- `README.md` for user-facing setup and operation;
- `CHANGELOG.md` under **Unreleased** for notable changes;
- `.env.example` for environment variables;
- `SECURITY.md` for security assumptions or reporting changes;
- locale documentation for translation workflow changes.

Use synthetic data in screenshots and examples.

## Pull requests

A pull request should include:

- a concise problem statement and the chosen approach;
- screenshots for visible UI changes, using synthetic demo data;
- migration notes for schema changes;
- configuration and upgrade notes when applicable;
- tests added or updated;
- confirmation that no secrets or personal X data are included;
- a changelog entry for user-visible changes.

Reviewers may request smaller commits or additional safety tests for destructive, billable, authentication, or privacy-sensitive changes.

## Reporting security issues

Do not disclose vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the project’s [MIT License](LICENSE).
