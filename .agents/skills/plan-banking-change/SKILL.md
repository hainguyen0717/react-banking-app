---
name: plan-banking-change
description: Turn a React banking-app feature, bug fix, API, database, or UI request into an implementation-ready full-stack plan. Use before coding application changes; do not use for implementation, API test execution, or unrelated documentation-only edits.
---

# Plan a banking change

## Inputs

Use the original request, the Business Analyst's MVP brief when provided, and the current repository state. Treat the brief as product scope rather than technical design, and treat documentation as supporting evidence rather than proof of the active runtime.

## Workflow

1. Before any planning, read `docs/CURRENT_FUNCTIONS_AND_APIS.md` completely. Compare the original request and Business Analyst brief with that inventory and classify each requested capability as already implemented, partially implemented, or new. Do not plan duplicate behavior; verify apparent documentation conflicts against executable code.
2. Inspect the worktree and trace the executable paths that own the requested behavior.
3. State the goal, acceptance criteria, and explicit assumptions. Surface only decisions that materially change behavior.
   Preserve the Business Analyst's two-to-three-capability MVP boundary unless executable constraints require a smaller scope; place additional ideas in exclusions rather than silently expanding them.
4. Map data changes: Prisma models, relations, constraints, migration, seed data, and lifecycle.
5. Map backend changes: active routes, services, validation, authorization/ownership, response shapes, error cases, and health effects.
6. Map frontend changes: routes, components, state, API calls, loading/empty/error states, styles, and stable `data-testid` locators.
7. Map contract and documentation changes: OpenAPI or JSON schema, examples, and READMEs.
8. Separate Developer-owned unit/component tests from Test-agent-owned HTTP integration scenarios.
9. Order the work by dependency and list exact likely files or clearly identified new files.
10. Keep the solution proportional to a deterministic test-tool demo. Exclude production-only infrastructure unless the request requires it.

## Authentication planning gate

When a request adds or changes a non-public API, explicitly plan:

- public versus protected operations and authentication middleware placement;
- session creation, renewal, expiry, revocation, logout, and safe persistence;
- actor identity derived from verified server context, never client path/body identity;
- method-level and resource ownership authorization with distinct `401` and `403` outcomes;
- cookie attributes, credentialed CORS, and CSRF/trusted-origin controls for mutations;
- secret/token handling across database fields, responses, URLs, DOM/Web Storage, fixtures, and logs;
- focused unit/component coverage and Test-agent HTTP scenarios for authentication and authorization.

Skip this expansion for documentation-only, styling-only, and public-only changes unless they alter an existing security contract.

## Repository constraints

- Confirm which backend is active before planning. npm currently runs the CommonJS Express/Prisma path; TypeScript backend files may be disconnected.
- Use Prisma with SQLite for persistent domain data.
- Require unique stable automation locators for every new or modified rendered frontend element. For repeated records, derive locators from stable record IDs, never array indexes or mutable display text.
- Include ownership and shared-visibility rules when behavior spans customers, accounts, or transactions.
- Treat any client-provided customer identifier as untrusted unless the active security design explicitly verifies it against the authenticated actor.

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
