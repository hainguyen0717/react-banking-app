# Banking functions and APIs

Last reviewed: 14 October 2026

API paths are case-sensitive. The `customerId` values used by account and transfer APIs are an intentionally simple demo ownership context, not production authentication.

## Customer functions

| # | Function | Description | Related API | Status |
| ---: | --- | --- | --- | --- |
| 1 | Create a customer | Registers normalized customer data and stores a bcrypt password hash. Duplicate emails are rejected. | `POST /api/customers` | **Implemented** |
| 2 | Login | Authenticates an active customer, updates `lastLoginAt`, and returns a non-sensitive profile. | `POST /api/login` | **Implemented** |
| 3 | Navigate the dashboard | Uses grouped Accounts and Transfer navigation with query-backed views for the account overview, new-account form, and transfer form. Missing or invalid views fall back to accounts; `/welcome` redirects to the dashboard for compatibility. | Frontend routes: `/dashboard?view=accounts`, `/dashboard?view=new-account`, `/dashboard?view=transfer` | **Implemented** |
| 4 | Create an account | Creates an `EVERYDAY`, `SAVINGS`, or `BUSINESS` AUD account. The server applies the configured opening balance, defaulting to `$1,000,000.00`. | `POST /api/customers/:customerId/accounts` | **Implemented** |
| 5 | View accounts | Lists all accounts owned by an active customer, including display name, number, type, currency, and balance. | `GET /api/customers/:customerId/accounts` | **Implemented** |
| 6 | View transaction history | Lists one owned account's transfers newest first with `SENT`/`RECEIVED` direction and counterparty number. | `GET /api/customers/:customerId/accounts/:accountId/transactions` | **Implemented** |
| 7 | Transfer money | Atomically debits an owned source, credits another Express Bank account selected by account number, and records one transfer. The destination may belong to another customer; self-transfer and overdraft are rejected without side effects. | `POST /api/transfers` | **Implemented** |
| 8 | Deposit money | Would add money outside the configured account opening balance and record a deposit. | No API currently exists. | **Not implemented** |
| 9 | Withdraw money | Would remove money outside an account-to-account transfer and record a withdrawal. | No API currently exists. | **Not implemented** |
| 10 | View joint accounts | Would display one shared account for multiple customers. Current accounts have one owner. | No API currently exists. | **Not implemented** |
| 11 | Use a joint account | Would allow multiple owners to transact against a shared balance. | No API currently exists. | **Not implemented** |
| 12 | Log out | Clears the locally stored safe demo customer profile and returns to login. | Frontend action on `/dashboard`; no API. | **Implemented** |

## Operational functions

| # | Function | Description | Related API or command | Status |
| ---: | --- | --- | --- | --- |
| 1 | Check database health | Confirms Prisma can query SQLite. | `GET /api/health` | **Implemented** |
| 2 | Support legacy health checks | Redirects the legacy path to the canonical health endpoint. | `GET /health` → `308` to `/api/health` | **Implemented** |
| 3 | View API documentation | Returns the active CommonJS server's OpenAPI 3.0 JSON contract. | `GET /docs/openapi.json` | **Implemented** |
| 4 | Seed a customer | Upserts a deterministic development customer from environment variables. | `cd backend && npm run seed` | **Implemented command** |
| 5 | Log API requests | Logs method, URL, response status, and duration. | Applies to all active APIs. | **Implemented** |
| 6 | Shut down safely | Closes the server and disconnects Prisma on `SIGINT`/`SIGTERM`. | Process lifecycle behavior. | **Implemented** |

## Implemented API summary

| Method | API | Success | Main failures |
| --- | --- | --- | --- |
| `POST` | `/api/customers` | `201` safe customer profile | `400` validation, `409` duplicate email |
| `POST` | `/api/login` | `200` safe customer profile | `400` missing fields, `401` invalid credentials |
| `GET` | `/api/customers/:customerId/accounts` | `200` `{ "accounts": [...] }` | `404` missing customer, `409` inactive customer |
| `POST` | `/api/customers/:customerId/accounts` | `201` created account | `400` invalid type/name, `404` missing customer, `409` inactive customer |
| `POST` | `/api/transfers` | `201` transfer receipt | `400` validation/self-transfer, `403` ownership, `404` account missing, `409` insufficient funds |
| `GET` | `/api/customers/:customerId/accounts/:accountId/transactions` | `200` `{ "transactions": [...] }` | `403` ownership, `404` account missing |
| `GET` | `/api/health` | `200` `{ "status": "ok" }` | `503` database unavailable |
| `GET` | `/health` | `308` redirect | None defined |
| `GET` | `/docs/openapi.json` | `200` OpenAPI JSON | None defined |

## Money and history contract

- Values are integer AUD cents. The dashboard parses decimal AUD input into cents without floating-point arithmetic.
- One transfer record is shown as `SENT` for its source and `RECEIVED` for its destination.
- Customers may own multiple accounts; joint ownership remains out of scope.
- New account opening balance is controlled by `DEFAULT_ACCOUNT_BALANCE_CENTS`, not by client input.

When behavior changes, update the exact method/path row and the active OpenAPI document. Do not describe disconnected prototype behavior as implemented.
