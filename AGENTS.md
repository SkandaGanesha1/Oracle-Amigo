# Agent Instructions

- Keep sandbox safety boundaries intact.
- Never bypass `CommandPolicy` for agent-triggered execution.
- Never log raw secrets, authorization headers, bearer tokens, GitHub tokens, npm tokens, or sensitive env values.
- Add or update tests for any new policy behavior.
- Prefer dry-run tests in CI.
- Treat VM-dependent tests as optional integration tests.
- For code review, flag P0/P1 issues involving secret leakage, command injection, network policy bypass, or unsafe filesystem writes.
- Static UI work is split by ownership: UI-serving tests and README/AGENTS docs may be updated here, while `src/server.ts` and `public/` assets are owned by the main implementation agent unless explicitly reassigned.
