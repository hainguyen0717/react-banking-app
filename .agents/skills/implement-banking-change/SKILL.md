---
name: implement-banking-change
description: Implement an approved full-stack change in this React, Express, Prisma, and SQLite banking demo, including migrations, contracts, documentation, unit tests, and stable frontend locators. Use after planning; do not use for plan-only requests or API-only integration validation.
---

# Implement a banking change

## Inputs

Use the original request, the Planner's complete plan, and the current worktree. Preserve unrelated changes.

## Workflow

1. Verify the plan against executable code and note any necessary adjustment.
2. Implement the smallest complete vertical slice in dependency order:
   - Prisma schema, migration, and deterministic seed support;
   - active backend service, validation, ownership rules, routes, and error contract;
   - frontend API integration, state, routes, components, styles, and user-visible states;
   - API/OpenAPI/JSON contracts and README examples.
3. Add focused backend unit tests and frontend component tests for changed logic.
4. Run the narrowest relevant checks first, then broader package checks when feasible.
5. Inspect the final diff for unrelated edits, generated artifacts, secrets, sensitive fields, and incomplete documentation.

## Frontend locator contract

- Give every new or modified rendered element a unique, descriptive, stable `data-testid`.
- Preserve semantic HTML, labels, names, roles, and accessible names; locators supplement them.
- Use stable domain IDs for repeated records, for example `account-card-${accountId}` and `account-withdraw-${accountId}`.
- Never use array indexes, random values, mutable labels, balances, or customer names as the only unique locator input.
- Assert important locators and uniqueness in component tests.

## Implementation boundaries

- Target the CommonJS Express/Prisma backend currently executed by npm unless consolidation is explicitly in scope.
- Keep the implementation readable and deterministic for testing tools.
- Do not add production infrastructure, speculative abstraction, browser automation, load testing, or broad hardening.
- Do not expose password hashes or secrets, bypass scenario-required ownership, or weaken rejected-request side-effect guarantees.
- Leave API integration test ownership to the Test agent, except for maintaining an existing test that must compile after a contract change.

## Handoff

Return:

- behavior implemented;
- files changed by layer;
- schema/migration and contract changes;
- unit/component tests added;
- commands run and exact outcomes;
- assumptions, plan deviations, and known environment limitations;
- API scenarios the Test agent should verify.

