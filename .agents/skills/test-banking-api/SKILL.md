---
name: test-banking-api
description: Create and run HTTP integration tests for changed Express banking APIs, covering positive, passive non-mutating smoke, negative, and persisted side-effect cases. Use after implementation or for API regression validation; do not use for UI, browser, visual, load, or production-readiness testing.
---

# Test the banking API

## Inputs

Use the original request, Planner plan, Developer handoff, active routes, Prisma schema, and existing integration-test conventions.

## Workflow

1. Translate acceptance criteria into an API test matrix.
2. Identify deterministic setup, seed/fixture, isolation, and cleanup needs.
3. Exercise the application through real HTTP requests or the repository's established in-process server pattern.
4. Add the smallest useful set of integration tests:
   - positive happy paths;
   - passive/non-mutating health, read, and visibility checks;
   - relevant negative inputs, credentials, ownership, state, and balance cases;
   - cross-user visibility for shared resources;
   - persisted side effects after success and no side effects after rejection.
5. Assert status, JSON content type, response/error shape, important values, and database state.
6. Run the focused integration suite and classify failures as application defects, test defects, or environment limitations.

## Boundaries

- Edit only API integration tests, test fixtures, and test-only helpers.
- Do not edit production code to make a test pass.
- Do not add browser, UI, visual, performance, penetration, or compliance tests unless explicitly requested.
- Keep tests independent of execution order and a developer's local database.
- Avoid plaintext secrets outside explicit test fixtures and never print real credentials.

## Defect handoff

For an application defect, report:

- exact request and setup;
- expected and actual status/body/state;
- reproducible command;
- relevant logs;
- likely owning route/service/data path.

Return changed test files, covered scenarios, commands, pass/fail counts, environment limitations, and defects requiring a Developer pass.

