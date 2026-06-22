# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript/Node 24 personal-agent sandbox. Core local-agent code lives in `src/`, with the main server entry at `src/server.ts` and root compatibility entry `server.ts`. React chat UI source is in `ui/`; its generated Vite output lands in `public/` and should not be hand-edited. Shared UI components are in `components/ui/`. Tests live in `tests/` and use `*.test.ts` naming.

Admin Portal work is split across `apps/admin-portal/` for the Fastify adapter, `apps/control-plane/src/admin/` for admin auth/session services and routes, and `ui-admin/` for the standalone React admin UI. Admin docs live in `docs/admin-portal.md`, `docs/admin-monitoring.md`, and the Admin Portal section of `docs/control-plane-architecture.md`.

## Build, Test, and Development Commands

- `npm run dev`: start the local agent with `tsx src/server.ts`.
- `npm run dev:ui`: run the chat Vite UI on `127.0.0.1`.
- `npm run build`: compile TypeScript and build the chat UI into `public/`.
- `npm test`: run the root Vitest suite.
- `npm run test:e2e`: run the loopback A2A integration test.
- `npm run typecheck`: check server and UI TypeScript projects.
- `npm run --prefix apps/control-plane test`: run control-plane tests.
- `npm run --prefix apps/admin-portal test`: run admin-portal adapter tests.
- `npm run --prefix ui-admin build`: generate Admin Portal static assets for `apps/admin-portal/public/`.

## Coding Style & Naming Conventions

Use TypeScript ES modules, two-space indentation, and explicit Zod validation at API and configuration boundaries. Prefer descriptive camelCase for variables/functions, PascalCase for React components and classes, and kebab-case for scripts and docs. Keep generated outputs (`public/`, `apps/admin-portal/public/`, `dist/`) out of manual edits.

## Discord Design Reference

When a task explicitly asks for Discord-inspired styling, use `docs/DESIGN-discord.md` as the visual design reference. Treat it as design guidance, not application logic. Follow its core visual tokens: Blurple `#5865f2`, electric green `#35ed7e`, magenta `#ec48bd`, deep indigo `#0a0d3a`, generously rounded cards, bold display typography, and saturated marketing-style layouts. Reserve green for the highest-intent CTA. Do not apply this Discord theme to unrelated product or admin UI unless the user requests it.

## Testing Guidelines

Vitest is the primary framework. Add or update focused tests for behavior changes, especially command policy, sandboxing, networking, secrets handling, authentication, and admin sessions. Prefer dry-run tests for CI; treat VM-dependent and two-laptop tests as optional integration coverage. Name new tests `FeatureName.test.ts`.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit style, such as `feat(control-plane): ...` and `fix(bugs): ...`. Keep commits scoped and imperative. PRs should describe behavior changes, list tests run, link related issues, and include screenshots for UI changes.

## Security & Agent-Specific Instructions

Keep sandbox boundaries intact and never bypass `CommandPolicy` for agent-triggered execution. Do not log raw secrets, bearer tokens, authorization headers, GitHub tokens, npm tokens, or sensitive environment values. For reviews, prioritize P0/P1 findings involving secret leakage, command injection, network policy bypass, or unsafe filesystem writes.
