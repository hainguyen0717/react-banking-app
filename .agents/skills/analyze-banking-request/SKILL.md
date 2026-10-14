---
name: analyze-banking-request
description: Elaborate a short banking-app feature request into a focused MVP business brief before technical planning. Use for application features, behavior changes, and product ideas that need scope, user actions, navigation placement, relationships, rules, and acceptance outcomes clarified without implementation detail.
---

# Analyze a banking request

## Inputs

Use the user's original request and the repository's documented functions. Inspect implementation only when needed to distinguish existing behavior from requested behavior. Remain read-only.

## Workflow

1. Restate the user goal in plain business language.
2. Triage the request against existing functions and identify the smallest useful addition.
3. Expand it into **two or three capabilities maximum**. Count the primary function as one capability and select only the highest-value supporting actions.
4. Describe where users find the function, including its left-navigation group when it has UI.
5. Describe essential relationships to existing customers, accounts, transfers, or other records.
6. State simple user-visible rules, access expectations, and success/error outcomes.
7. Record reasonable assumptions and explicitly defer optional enhancements.
8. Produce a concise brief for the Planner. Do not propose files, schemas, endpoints, libraries, or implementation steps.

## MVP guardrails

- Keep the result appropriate for a deterministic test-tool demo, not a production bank.
- Do not turn a noun into a full product suite. Choose no more than three demonstrable capabilities.
- Prefer capabilities that form one coherent workflow.
- Include only supporting states required to exercise the workflow, such as active, temporarily locked, or deactivated.
- Avoid speculative compliance, fraud engines, card networks, fees, notifications, approval workflows, reporting, or administration unless the user explicitly requests them.
- Do not silently expand into unrelated features. Put useful extras under deferred options.
- Ask a blocking question only when different answers would materially change the MVP. Otherwise make and label a reasonable assumption.

## Example scope

For “Add card function,” an appropriate brief could select:

1. Add a card linked to one owned account.
2. Temporarily lock and unlock the card.
3. Deactivate the card permanently.

Place Cards in the left navigation, show the linked account, and defer replacement cards, physical delivery, PIN management, card payments, and fraud controls.

## Output

Return these sections:

1. Interpreted goal
2. MVP capabilities — two or three numbered items
3. User flow and navigation
4. Business relationships and rules
5. Acceptance outcomes
6. Assumptions and deferred options

End with a compact `Planner handoff` containing the original request plus the elaborated MVP brief. Do not edit files.
