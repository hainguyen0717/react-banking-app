# Repository agent workflow

This repository is a small banking application used to exercise test tools. Build complete, deterministic demo behavior, but do not expand requests into production banking architecture or compliance work.

## Current architecture

- `frontend/` is a React 18, TypeScript, Vite application.
- The active backend is CommonJS Express: `backend/src/server.js` creates the server, `backend/src/createApp.js` defines routes, and `backend/src/services/customerService.js` owns authentication data access.
- Prisma and SQLite are defined under `backend/prisma/`.
- A separate TypeScript backend and OpenAPI document also exist under `backend/src/`, but npm currently starts `src/server.js`. Trace the executable path before changing backend behavior and do not update only disconnected code.
- Backend API integration tests live under `backend/tests/integration/`; frontend component tests live beside components.

## Required workflow for application updates

For application feature requests, behavior changes, and bug fixes, coordinate the project agents sequentially. These stages depend on one another, so do not run them in parallel.

1. Spawn `planner` with the user's full request. Ask it to inspect the current implementation and return an implementation-ready plan. It must not edit files.
2. Review the plan for blocking questions. Make reasonable assumptions for non-blocking details and continue without an approval pause unless the user requested plan-only work.
3. Spawn `developer` with the original request and the Planner's complete plan. It owns production code, database changes, unit/component tests, contracts, and documentation.
4. After implementation, spawn `test` with the original request, plan, and Developer summary. It owns API integration tests and API-level validation; UI automation is out of scope.
5. If `test` finds an application defect, send the evidence back to `developer`, then have `test` rerun or extend the affected API checks. Repeat until the requested behavior passes or a genuine external blocker remains.
6. The parent agent reviews the combined patch, runs proportionate final checks, and reports the outcome, assumptions, test evidence, and any remaining limitations.

If the user asks only for a plan, stop after the Planner result. If the user asks only for diagnosis, review, documentation, or a narrowly scoped non-application edit, use only the roles that materially help.

## Project skills

Each specialist must read and follow its repo-scoped skill before taking task actions:

- Planner: `$plan-banking-change` at `.agents/skills/plan-banking-change/SKILL.md`
- Developer: `$implement-banking-change` at `.agents/skills/implement-banking-change/SKILL.md`
- Test: `$test-banking-api` at `.agents/skills/test-banking-api/SKILL.md`

Keep role identity in the custom-agent TOML files and reusable procedures in these skills. Update both only when their contracts genuinely change.

## Hooks

Project hooks live in `.codex/hooks.json` and are enabled in `.codex/config.toml`.

- `SubagentStart` injects the correct repo skill for `planner`, `developer`, and `test`.
- `PreToolUse` blocks a narrow set of commands that can discard work or reset/delete the SQLite database.

Codex requires review and trust for new or changed project hooks. Inspect and trust them through `/hooks`; do not bypass hook trust for routine work.

Validate hook behavior with `python3 -m unittest discover -s .codex/hooks/tests` after changing hook code or configuration.

## Role boundaries

### Planner

- Read-only.
- Maps requirements across data, backend, frontend, contracts, documentation, and tests.
- Supplies file-level steps, acceptance criteria, assumptions, and exclusions.

### Developer

- Implements backend and frontend changes.
- Updates Prisma schema/migrations/seed data and API/OpenAPI/JSON documentation when relevant.
- Adds focused unit and component tests.
- Ensures every new or modified rendered frontend element has a unique, stable automation locator, normally `data-testid`, while preserving semantic and accessible selectors.
- Uses stable record IDs for repeated-element locators and never array indexes or mutable display text.

### Test

- Creates and runs API integration tests using HTTP calls.
- Covers positive behavior, passive/non-mutating smoke behavior, and relevant negative cases.
- Verifies response contracts and database side effects, including multi-user visibility where applicable.
- Does not create UI automation or edit production code. Application defects go back to Developer.

## Scope and quality bar

- Prefer simple, explicit code that is easy for automation tools to exercise.
- Implement only the abstractions needed by the requested scenarios.
- Keep fixtures deterministic and tests independent of execution order.
- Do not expose password hashes, commit credentials, or skip ownership rules required by a scenario.
- Preserve unrelated worktree changes.
- Update documentation and machine-readable contracts when behavior changes.
- Report pre-existing build or environment failures separately from regressions caused by the change.

## Common verification commands

- Backend integration tests: `cd backend && npm test`
- Frontend component tests: `cd frontend && npm test -- --run`
- Frontend build: `cd frontend && npm run build`
- Prisma client generation after schema changes: `cd backend && npm run prisma:generate`
- Apply development migrations: `cd backend && npm run prisma:migrate:dev -- --name <change-name>`
