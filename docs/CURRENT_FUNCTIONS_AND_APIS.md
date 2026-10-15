# Banking functions and APIs

Last reviewed: 15 October 2026

API paths are case-sensitive. Protected APIs derive identity only from the verified opaque `eb_session` HttpOnly cookie; they do not accept a customer identity in the URL or request body.

## Customer functions

| # | Function | Description | Related API | Status |
| ---: | --- | --- | --- | --- |
| 1 | Create a customer | Registers normalized customer data and stores a bcrypt password hash. Duplicate emails are rejected. | `POST /api/customers` | **Implemented** |
| 2 | Login | Authenticates an active customer, updates `lastLoginAt`, creates a hashed server-side session, sets `eb_session`, and returns a non-sensitive profile. | `POST /api/login` | **Implemented** |
| 3 | Navigate the dashboard | Uses an Accounts group, standalone Cards destination, Transfer group, and Profile group. Cards appears immediately after Accounts and before Transfer. Query-backed views preserve active state; missing or invalid views fall back to accounts, and `/welcome` redirects to the dashboard for compatibility. | Frontend routes under `/dashboard?view=...`, including `accounts`, `new-account`, `new-joint-account`, `cards`, `transfer`, `schedule-transfer`, `scheduled-transfers`, and `profile` | **Implemented** |
| 4 | Create an account | Creates an `EVERYDAY`, `SAVINGS`, or `BUSINESS` AUD account for the authenticated customer. | `POST /api/accounts` | **Implemented** |
| 5 | View accounts | Lists all personal and joint accounts owned by the authenticated active customer. | `GET /api/accounts` | **Implemented** |
| 6 | View transaction history | Lists one authenticated-owned account's transfers newest first. | `GET /api/accounts/:accountId/transactions` | **Implemented** |
| 7 | Transfer money | Atomically debits a personal or jointly owned source, credits another Express Bank account selected by account number, and records one transfer. Either joint owner may send; self-transfer and overdraft are rejected without side effects. | `POST /api/transfers` | **Implemented** |
| 8 | Deposit money | Would add money outside the configured account opening balance and record a deposit. | No API currently exists. | **Not implemented** |
| 9 | Withdraw money | Would remove money outside an account-to-account transfer and record a withdrawal. | No API currently exists. | **Not implemented** |
| 10 | Create a joint account | Creates one account shared by the authenticated customer and a different active registered customer resolved by normalized email. | `POST /api/joint-accounts` | **Implemented** |
| 11 | View and use a joint account | Both owners see the full shared balance and history and may transfer from the same account. Joint ownership does not add a fourth account product type or require approval. | Account list, transaction history, and transfer APIs | **Implemented** |
| 12 | Restore a session | Verifies the HttpOnly cookie, enforces idle/absolute expiry and active-customer status, refreshes `lastSeenAt`, and returns the safe profile. | `GET /api/session` | **Implemented** |
| 13 | Log out | Revokes only the current server session, clears the cookie, and returns to login. | `POST /api/logout` | **Implemented** |
| 14 | Update personal information | Updates required first name, last name, and address for the authenticated customer and refreshes the in-memory dashboard profile. | `PUT /api/profile`, `/dashboard?view=profile` | **Implemented** |
| 15 | Schedule a transfer | Creates a private one-time future transfer from a picker-only local date/time. Funds are checked but not reserved; due processing rechecks rules and records `COMPLETED` or side-effect-free `FAILED`. | `GET\|POST /api/scheduled-transfers`, schedule dashboard views | **Implemented** |
| 16 | Manage demo debit cards | Opens holder-specific cards on personally or jointly owned accounts, creates exactly five display-only samples, and supports temporary lock/unlock or permanent disable. | Card APIs, `/dashboard?view=cards` | **Implemented** |

## Operational functions

| # | Function | Description | Related API or command | Status |
| ---: | --- | --- | --- | --- |
| 1 | Check database health | Confirms Prisma can query SQLite. | `GET /api/health` | **Implemented** |
| 2 | Support legacy health checks | Redirects the legacy path to the canonical health endpoint. | `GET /health` → `308` to `/api/health` | **Implemented** |
| 3 | View API documentation | Renders a public, browser-friendly Swagger UI from locally bundled assets and the active CommonJS server's single OpenAPI 3.0 JSON contract. No paid service or customer-dashboard navigation is involved. | `GET /docs` → `/docs/`; `GET /docs/openapi.json` | **Implemented** |
| 4 | Seed a customer | Upserts a deterministic development customer from environment variables. | `cd backend && npm run seed` | **Implemented command** |
| 5 | Log API requests | Logs method, path, response status, and duration without query-string values. | Applies to all active APIs. | **Implemented** |
| 6 | Shut down safely | Closes the server and disconnects Prisma on `SIGINT`/`SIGTERM`. | Process lifecycle behavior. | **Implemented** |
| 7 | Process due transfers | Runs at startup and on a configurable non-overlapping interval, atomically claims due pending schedules, and stops before Prisma disconnect. | `SCHEDULED_TRANSFER_POLL_INTERVAL_MS` | **Implemented** |

## Implemented API summary

| Method | API | Success | Main failures |
| --- | --- | --- | --- |
| `POST` | `/api/customers` | `201` safe customer profile | `400` validation, `409` duplicate email |
| `POST` | `/api/login` | `200` safe customer profile | `400` missing fields, `401` invalid credentials |
| `GET` | `/api/session` | `200` safe customer profile | `401` missing, malformed, unknown, expired, or inactive session |
| `PUT` | `/api/profile` | `200` updated safe customer profile | `400` invalid fields, `401` authentication, `403` untrusted origin |
| `POST` | `/api/logout` | `204` and cleared cookie | `401` invalid/replayed session, `403` untrusted origin |
| `GET` | `/api/accounts` | `200` `{ "accounts": [...] }` | `401` authentication required |
| `POST` | `/api/accounts` | `201` created account | `400` invalid type/name, `401` authentication required, `403` untrusted origin |
| `POST` | `/api/joint-accounts` | `201` one shared account with two safe owners | `400` invalid input, `401` authentication required, `403` untrusted origin, `404` missing co-owner, `409` inactive owner |
| `POST` | `/api/transfers` | `201` transfer receipt | `400` validation/self-transfer, `403` ownership, `404` account missing, `409` insufficient funds |
| `GET`, `POST` | `/api/scheduled-transfers` | `200` list or `201` pending schedule | `400` validation/time, `401` authentication, `403` ownership/origin, `404` account missing, `409` current funds |
| `GET`, `POST` | `/api/cards` | `200` holder list or `201` active masked card | `400` validation, `401` authentication, `403` ownership/origin, `404` account missing |
| `GET` | `/api/cards/:cardId` | `200` holder-owned masked card | `401` authentication, `403` foreign card, `404` missing card |
| `POST` | `/api/cards/:cardId/lock`, `/unlock`, `/disable` | `200` updated masked card | `401`, `403`, `404`, `409` invalid/repeated transition |
| `GET` | `/api/accounts/:accountId/transactions` | `200` `{ "transactions": [...] }` | `401` authentication required, `403` ownership, `404` account missing |
| `GET` | `/api/health` | `200` `{ "status": "ok" }` | `503` database unavailable |
| `GET` | `/health` | `308` redirect | None defined |
| `GET` | `/docs`, `/docs/` | `308` canonical redirect or `200` Swagger UI | None defined |
| `GET` | `/docs/openapi.json` | `200` OpenAPI JSON | None defined |

Swagger **Try it out** uses the API's serving origin and browser-managed HttpOnly session cookie. Login sets the cookie; the UI does not read or preload it. Mutating calls still require an exact configured frontend origin or an exact match to the API request's protocol, host, and port. Credentialed CORS is not broadened.

## Money and history contract

- Values are integer AUD cents. The dashboard parses decimal AUD input into cents without floating-point arithmetic.
- One transfer record is shown as `SENT` for its source and `RECEIVED` for its destination.
- Customers may own multiple personal and joint accounts. Multiple accounts for the same owner pair are allowed.
- Each joint account has one balance and one history. Each owner dashboard counts that full balance once because the shared account is returned once per owner.
- Account responses retain `customerId` as creator/legacy primary metadata and add `ownershipType` plus a safe `owners` array. Either listed joint owner is authorized.
- New account opening balance is controlled by `DEFAULT_ACCOUNT_BALANCE_CENTS`, not by client input.
- Scheduled balances are never reserved. Successful due work creates the same normal `Transfer` history as an immediate transfer; expected business failures do not alter balances or history.
- Card sample transactions are intentionally separate from account transfer history and never affect balances. APIs and the DOM expose masked identifiers only.

When behavior changes, update the exact method/path row and the active OpenAPI document. Do not describe disconnected prototype behavior as implemented.
