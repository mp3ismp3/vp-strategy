# Contributing

Thank you for improving VP Strategy. By contributing, you agree that your
contribution is licensed under the repository's MIT License.

## Development workflow

1. Read `AGENTS.md` and `docs/CODEX_ARCHITECTURE.md`.
2. Create a focused `feat/*`, `fix/*`, `refactor/*`, or `chore/*` branch from
   the latest `main`.
3. Add a failing test before changing production behavior.
4. Keep analysis JSON schemas, strategy boundaries, and synchronous Python
   execution compatible.
5. Update the root README for fixes and features. Update the architecture
   document when a boundary or production module changes.
6. Run the checks selected by the repository workflow plus the relevant full
   suite. Never call live market, payment, or notification services from tests.
7. Submit a pull request to `main`. Do not push development commits to `main`.

For frontend work, use `npm ci`, `npm test`, `npm run lint`, and
`npm run build` from `services/frontend`. Never commit `.env*`, runtime state,
market data, credentials, customer data, or provider webhook payloads.

## Pull requests

Keep one concern per commit. Explain the behavior change, security impact,
tests run, migration or rollout requirements, and any residual risks. API
contract changes must update `services/frontend/openapi.yaml` and
`docs/API.md` in the same pull request.
