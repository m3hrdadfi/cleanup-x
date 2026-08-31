# Security policy

Cleanup X handles OAuth credentials, personal archive content, model-provider keys, and irreversible deletion requests. Security reports are welcome and should be handled privately.

## Supported versions

Cleanup X is currently pre-1.0. Security fixes are applied to the latest release and the current default branch only.

| Version | Supported |
| --- | --- |
| Latest `0.1.x` release | Yes |
| Default branch | Yes |
| Older snapshots and forks | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

1. Use the repository host’s private security-advisory feature when available.
2. If private advisories are unavailable, contact the maintainers privately through the account or organization that publishes this repository and request a secure reporting channel.
3. Include the affected version or commit, operating system, configuration, reproduction steps, impact, and any suggested mitigation.
4. Remove OAuth tokens, API keys, post text, archive contents, database files, and other personal data from logs or examples.

The maintainers should acknowledge a complete report within seven days, provide a preliminary assessment when reproducible, and coordinate disclosure after a fix or mitigation is available. Timelines may vary because the project is maintained on a best-effort basis.

## Security scope

High-priority reports include:

- bypassing exact-count confirmation or triggering deletion outside a confirmed job;
- performing live X operations while demo mode is enabled;
- leaking OAuth tokens, X client secrets, provider keys, archive text, manifests, or embeddings;
- CSRF, authorization, idempotency, or redirect-validation weaknesses;
- unsafe archive extraction, ZIP traversal, decompression abuse, or JavaScript execution;
- cross-account deletion or confused-deputy behavior;
- prompt-injection paths that turn post content into model or application instructions;
- persistent script injection through imported posts, model output, or audit data;
- incorrect endpoint selection that deletes an authored post or repost other than the reviewed item.

Issues that generally fall outside the project’s security boundary include provider outages, X pricing changes, model-quality disagreements, incomplete archives, and attacks requiring an already-compromised local account with unrestricted access to the project directory. Responsible reports about defense-in-depth improvements are still welcome.

## Operational security

- Bind the local version to `127.0.0.1`; it is not designed for public Internet exposure or multi-user deployment.
- Run one backend worker so persisted in-process jobs are not duplicated.
- Keep `.env`, `data/`, `exports/`, database backups, and screenshots containing real posts private.
- Back up `data/.encryption-key` with the database. Losing it makes stored encrypted credentials unreadable; exposing it with the database defeats credential encryption.
- Prefer a dedicated `APP_ENCRYPTION_KEY` supplied through a protected secret store for long-lived installations.
- Use least-privilege X OAuth scopes and verify the displayed account before syncing or deleting.
- Keep automatic X credit recharge disabled until spending behavior is understood.
- Treat remote LLM and embedding services as third parties that may receive and retain post or query text.
- Do not enable `APP_DEMO_MODE` against a real database.
- Review generated manifests before deletion and keep audit/export files only as long as needed.
- Apply dependency updates, database migrations, and security releases promptly.

## Secrets in reports and logs

Cleanup X masks configured secrets in settings responses and avoids reflecting credential payloads in validation errors. Contributors must preserve that behavior. Tests, screenshots, bug reports, and fixtures must use synthetic IDs, posts, tokens, and keys.

If a real credential is exposed, revoke or rotate it at its provider immediately; deleting it from Git history or an issue is not sufficient.
