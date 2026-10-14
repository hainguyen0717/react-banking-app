---
name: plan-banking-change
description: Turn a React banking-app feature, bug fix, API, database, or UI request into an implementation-ready full-stack plan. Use before coding application changes; do not use for implementation, API test execution, or unrelated documentation-only edits.
---

# Plan a banking change

## Inputs

Use the original request and the current repository state. Treat documentation as supporting evidence, not proof of the active runtime.

## Workflow

1. Inspect the worktree and trace the executable paths that own the requested behavior.
2. State the goal, acceptance criteria, and explicit assumptions. Surface only decisions that materially change behavior.
3. Map data changes: Prisma models, relations, constraints, migration, seed data, and lifecycle.
4. Map backend changes: active routes, services, validation, authorization/ownership, response shapes, error cases, and health effects.
5. Map frontend changes: routes, components, state, API calls, loading/empty/error states, styles, and stable `data-testid` locators.
6. Map contract and documentation changes: OpenAPI or JSON schema, examples, and READMEs.
7. Separate Developer-owned unit/component tests from Test-agent-owned HTTP integration scenarios.
8. Order the work by dependency and list exact likely files or clearly identified new files.
9. Keep the solution proportional to a deterministic test-tool demo. Exclude production-only infrastructure unless the request requires it.

## Repository constraints

- Confirm which backend is active before planning. npm currently runs the CommonJS Express/Prisma path; TypeScript backend files may be disconnected.
- Use Prisma with SQLite for persistent domain data.
- Require unique stable automation locators for every new or modified rendered frontend element. For repeated records, derive locators from stable record IDs, never array indexes or mutable display text.
- Include ownership and shared-visibility rules when behavior spans customers, accounts, or transactions.

## Output

Return these sections:

1. Goal and assumptions
2. Current flow affected
3. Data and migration changes
4. Backend changes
5. Frontend changes and locators
6. Contracts and documentation
7. Unit/component tests
8. API integration scenarios
9. Ordered implementation steps
10. Acceptance criteria and exclusions

Do not edit files.

