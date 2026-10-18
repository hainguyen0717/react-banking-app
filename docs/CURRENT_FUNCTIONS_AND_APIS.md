# Banking functions and APIs

Last reviewed: 19 October 2026

API paths are case-sensitive. Protected APIs derive identity only from a verified opaque session supplied by `Authorization: Bearer <token>` or the `eb_session` HttpOnly cookie; they do not accept customer identity in the URL or request body. An explicit Authorization header is authoritative.

## Customer functions

| # | Function | Description | Related API | Status |
| ---: | --- | --- | --- | --- |
| 1 | Create a customer | Registers normalized customer data and stores a bcrypt password hash. Duplicate emails are rejected. | `POST /api/customers` | **Implemented** |
| 2 | Login | Authenticates an active customer, updates `lastLoginAt`, creates a hashed server-side session, sets `eb_session`, and returns `{ customer, accessToken, tokenType, expiresAt }` without permitting caching. | `POST /api/login` | **Implemented** |
| 3 | Navigate the dashboard | Uses a top status banner, grouped left menu, and middle content region. The menu has Accounts, Cards, Payments, Transfer, Profile, and Test Controls destinations. Query-backed views preserve active state; missing or invalid views fall back to accounts, and `/welcome` redirects to the dashboard for compatibility. | Frontend routes under `/dashboard?view=...`, including `accounts`, `new-account`, `new-joint-account`, `cards`, `payments`, `transfer`, `schedule-transfer`, `scheduled-transfers`, `profile`, and `delay-simulator` | **Implemented** |
| 4 | Create an account | Creates an `EVERYDAY`, `SAVINGS`, or `BUSINESS` AUD account for the authenticated customer. | `POST /api/accounts` | **Implemented** |
| 5 | View accounts | Lists all personal and joint accounts owned by the authenticated active customer. | `GET /api/accounts` | **Implemented** |
| 6 | View transaction history | Lists one authenticated-owned account's transfers newest first. | `GET /api/accounts/:accountId/transactions` | **Implemented** |
| 7 | Transfer money | Atomically debits a personal or jointly owned source, credits another Express Bank account selected by account number, and records one transfer. Either joint owner may send; self-transfer and overdraft are rejected without side effects. | `POST /api/transfers` | **Implemented** |
| 8 | Deposit money | Would add money outside the configured account opening balance and record a deposit. | No API currently exists. | **Not implemented** |
| 9 | Withdraw money | Would remove money outside an account-to-account transfer and record a withdrawal. | No API currently exists. | **Not implemented** |
| 10 | Create a joint account | Creates one account shared by the authenticated customer and a different active registered customer resolved by normalized email. | `POST /api/joint-accounts` | **Implemented** |
| 11 | View and use a joint account | Both owners see the full shared balance and history and may transfer from the same account. Joint ownership does not add a fourth account product type or require approval. | Account list, transaction history, and transfer APIs | **Implemented** |
| 12 | Restore a session | Verifies the HttpOnly cookie, enforces idle/absolute expiry and active-customer status, refreshes `lastSeenAt`, and returns the safe profile. | `GET /api/session` | **Implemented** |
| 13 | Log out | Revokes only the selected server session, clears a matching cookie without clearing an unrelated browser session, and returns the React client to login. | `POST /api/logout` | **Implemented** |
| 14 | Update personal information | Updates required first name, last name, and address for the authenticated customer and refreshes the in-memory dashboard profile. | `PUT /api/profile`, `/dashboard?view=profile` | **Implemented** |
| 15 | Schedule a transfer | Creates a private one-time future transfer from a picker-only local date/time. Funds are checked but not reserved; due processing rechecks rules and records `COMPLETED` or side-effect-free `FAILED`. | `GET\|POST /api/scheduled-transfers`, schedule dashboard views | **Implemented** |
| 16 | Manage demo debit cards | Opens holder-specific cards on personally or jointly owned accounts, creates exactly five display-only samples, and supports temporary lock/unlock or permanent disable. | Card APIs, `/dashboard?view=cards` | **Implemented** |
| 17 | Make an immediate payment | Resolves and reviews an Express account number, email PayID, or fictional BPAY biller before final confirmation. Account/PayID payments update both internal sides; BPAY debits the source only. Joint owners may pay, while actor-owned destinations, invalid references, and overdrafts are side-effect-free failures. | `POST /api/payments/resolve`, `POST /api/payments`, `/dashboard?view=payments` | **Implemented** |
| 18 | Configure test delay | Reads and replaces a shared inclusive 0–60 second whole-number range with `API`, `UI`, or `BOTH` scope. Each eligible event samples independently; equal bounds are fixed. The banner shows the active setting and offers a responsive reset. UI-inclusive scope delays dashboard destination changes only; API-backed actions rely on their reserved server sample. | `GET\|PUT /api/test-controls/delay`, `POST /api/test-controls/delay/sample`, `/dashboard?view=delay-simulator` | **Implemented** |

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
| 8 | Simulate slow APIs and UI navigation | Stores one in-memory inclusive delay range per server process, defaulting to `0`–`0` seconds with `BOTH` scope. The UI reserves a short-lived single-use API sample so its countdown matches the server response delay; unticketed scripts sample directly at entry. Exact control endpoints, docs, legacy health redirect, and background work remain responsive. Restart restores the default. | Delay control API and dashboard Test Controls | **Implemented** |

## Implemented API summary

| Method | API | Success | Main failures |
| --- | --- | --- | --- |
| `POST` | `/api/customers` | `201` safe customer profile | `400` validation, `409` duplicate email |
| `POST` | `/api/login` | `200` safe customer and opaque bearer-token envelope plus HttpOnly cookie | `400` missing fields, `401` invalid credentials, `415` unsupported Content-Type |
| `GET` | `/api/session` | `200` safe customer profile | `401` missing, malformed, unknown, expired, or inactive session |
| `PUT` | `/api/profile` | `200` updated safe customer profile | `400` invalid fields, `401` authentication, `403` untrusted origin |
| `POST` | `/api/logout` | `204`, with a matching cookie cleared when present | `401` invalid/replayed session, `403` untrusted cookie-authenticated origin |
| `GET` | `/api/accounts` | `200` `{ "accounts": [...] }` | `401` authentication required |
| `POST` | `/api/accounts` | `201` created account | `400` invalid type/name, `401` authentication required, `403` untrusted origin |
| `POST` | `/api/joint-accounts` | `201` one shared account with two safe owners | `400` invalid input, `401` authentication required, `403` untrusted origin, `404` missing co-owner, `409` inactive owner |
| `POST` | `/api/transfers` | `201` transfer receipt | `400` validation/self-transfer, `403` ownership, `404` account missing, `409` insufficient funds |
| `POST` | `/api/payments/resolve` | `200` safe, non-mutating review details | `400` validation/self-payment, `401` authentication, `403` ownership/origin, `404` source/payee/biller missing, `409` insufficient funds |
| `POST` | `/api/payments` | `201` immutable safe payment receipt | `400` validation/self-payment, `401` authentication, `403` ownership/origin, `404` source/payee/biller missing, `409` insufficient funds |
| `GET`, `POST` | `/api/scheduled-transfers` | `200` list or `201` pending schedule | `400` validation/time, `401` authentication, `403` ownership/origin, `404` account missing, `409` current funds |
| `GET`, `POST` | `/api/cards` | `200` holder list or `201` active masked card | `400` validation, `401` authentication, `403` ownership/origin, `404` account missing |
| `GET` | `/api/cards/:cardId` | `200` holder-owned masked card | `401` authentication, `403` foreign card, `404` missing card |
| `POST` | `/api/cards/:cardId/lock`, `/unlock`, `/disable` | `200` updated masked card | `401`, `403`, `404`, `409` invalid/repeated transition |
| `GET` | `/api/accounts/:accountId/transactions` | `200` `{ "transactions": [...] }` | `401` authentication required, `403` ownership, `404` account missing |
| `GET`, `PUT` | `/api/test-controls/delay` | `200` complete `{ "minSeconds", "maxSeconds", "scope" }` setting | `400` missing/fractional/unordered/out-of-range/unknown payload, `403` untrusted PUT origin |
| `POST` | `/api/test-controls/delay/sample` | `200` non-cacheable `{ "ticket", "sampledSeconds" }` reservation | `403` untrusted origin |
| `GET` | `/api/health` | `200` `{ "status": "ok" }` | `503` database unavailable |
| `GET` | `/health` | `308` redirect | None defined |
| `GET` | `/docs`, `/docs/` | `308` canonical redirect or `200` Swagger UI | None defined |
| `GET` | `/docs/openapi.json` | `200` OpenAPI JSON | None defined |

Swagger **Try it out** can use the API's browser-managed HttpOnly session cookie or the OpenAPI bearer **Authorize** control. Login sets the cookie and returns the same opaque session token for non-browser integration testing; the React UI consumes only `customer` and never stores or renders the token. Bearer-authenticated protected mutations bypass Origin checks, while cookie-authenticated and public mutations still require an exact configured frontend origin or an exact match to the API request's protocol, host, and port. Credentialed CORS allows `Authorization`, `Content-Type`, and `X-Test-Delay-Ticket` from configured frontend origins.

All 11 operations with required request bodies require `application/json` (optionally with a UTF-8 charset) and document JSON `415` errors. GETs and bodyless actions do not require Content-Type. Protected `401` responses include `WWW-Authenticate: Bearer realm="express-bank"`; malformed JSON continues to return `400`.

The delay control is intentionally process-local and public for deterministic API/UI test scripts. PUT requires all three fields and rejects invalid input without changing the active setting. Reset writes `0`–`0` seconds while retaining the active scope. Each eligible event independently samples an inclusive whole-number value. A sampled ticket is opaque, short-lived, and single-use; send it as `X-Test-Delay-Ticket` and inspect `X-Test-Delay-Seconds` on the ordinary API response. Invalid, expired, or replayed tickets return `400`. External setting changes appear in the dashboard after reload or explicit refresh; there is no polling.

## Money and history contract

- Values are integer AUD cents. The dashboard parses decimal AUD input into cents without floating-point arithmetic.
- One transfer record is shown as `SENT` for its source and `RECEIVED` for its destination.
- Payment history uses `BANK_ACCOUNT`, `PAYID`, or `BPAY` alongside legacy `TRANSFER`. Linked account/PayID transfers are not duplicated; BPAY is source-only. Outgoing PayID history and receipts never reveal its mapped account.
- Customers may own multiple personal and joint accounts. Multiple accounts for the same owner pair are allowed.
- Each joint account has one balance and one history. Each owner dashboard counts that full balance once because the shared account is returned once per owner.
- Account responses retain `customerId` as creator/legacy primary metadata and add `ownershipType` plus a safe `owners` array. Either listed joint owner is authorized.
- New account opening balance is controlled by `DEFAULT_ACCOUNT_BALANCE_CENTS`, not by client input.
- Scheduled balances are never reserved. Successful due work creates the same normal `Transfer` history as an immediate transfer; expected business failures do not alter balances or history.
- Card sample transactions are intentionally separate from account transfer history and never affect balances. APIs and the DOM expose masked identifiers only.

When behavior changes, update the exact method/path row and the active OpenAPI document. Do not describe disconnected prototype behavior as implemented.
