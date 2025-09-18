# Testing Agent Playbook

## Playwright Setup
- Tests live in `tests/e2e`. Use the shared fixture exported from `tests/e2e/fixtures.ts`, which seeds ad consent to keep UI stable.
- Honor environment variables: `E2E_BASE_URL`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`. Skip credential flows when secrets are absent (see existing tests).
- Add new fixtures beside the default one only when a scenario demands different browser context state (e.g., no consent seeding).

## Writing Tests
- Target elements with `data-testid` first (`getByTestId`). Fall back to accessible roles/names when it keeps the test expressive.
- Wait for navigation with `page.waitForURL` and use `waitUntil: 'domcontentloaded'` to keep tests fast yet stable.
- Verify both UI and side effects: check toast text, redirected URLs, and presence of dashboard shells.

## Running Locally
- Use `bun run test:e2e` (headless) or `bun run test:e2e:headed`. Ensure the Next.js dev server is running unless you set `PW_SKIP_WEBSERVER=1` and manage it yourself.
- Keep the database seeded with any accounts referenced in tests; prefer scripted seeds over manual SQL.
- For deterministic results, clear relevant tables between tests or rely on isolated test data. Avoid hard-coded IDs that might clash with real data.

## Maintenance
- Update selectors whenever UI structure changes, but prefer adjusting component `data-testid` attributes over brittle DOM traversals.
- Record new trace logs only when debugging; remove `--trace` artifacts from commits.
- If a flaky test surfaces, reproduce locally, document the root cause, and either stabilize the selector/timing or mark it with `test.fixme` temporarily.
