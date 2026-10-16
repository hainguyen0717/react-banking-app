# Backend Service

The active backend is the CommonJS Express server in `src/server.js`, backed by Prisma and SQLite. It implements the deliberately simple behavior needed to exercise API and UI test tools.

## Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
```

The backend listens on `PORT`, with a source fallback of `3001` when it is unset. The checked-in `.env.example` explicitly overrides it to `4000` to match the current frontend default. `DATABASE_URL=file:./dev.db` stores the database under `prisma/dev.db` because Prisma resolves relative SQLite paths from the schema directory.

Opaque sessions use `SESSION_IDLE_TIMEOUT_SECONDS` (default `1800`) and `SESSION_ABSOLUTE_TIMEOUT_SECONDS` (default `28800`). `FRONTEND_ORIGINS` is a comma-separated exact allowlist used by credentialed CORS and mutation-origin checks. Mutations also accept an exact origin matching the API request's protocol, host, and port so the same-origin Swagger UI works; this does not broaden CORS. Development cookies are `HttpOnly`, `SameSite=Lax`, and path `/`; production adds `Secure` and uses `SameSite=Strict`.

## Swagger UI

Open `/docs/` on the configured backend origin; with the copied development environment, that is [http://localhost:4000/docs/](http://localhost:4000/docs/). `server.js` falls back to port `3001` only when `PORT` is unset. `/docs` redirects to the canonical trailing-slash URL, while `/docs/openapi.json` remains the single active contract used by the UI. Swagger UI and its assets are bundled locally through `swagger-ui-express`; there is no CDN or paid service.

Standard **Try it out** requests use the serving origin and include browser credentials. Run `POST /api/login` first and the browser will retain the returned HttpOnly `eb_session` cookie for later protected calls. The UI does not read, embed, or persist the cookie, password, or authorization value. Existing authentication, ownership, validation, `401`/`403`, and trusted-origin behavior still applies.

## Test delay simulator

`GET /api/test-controls/delay` returns the current shared delay and `PUT /api/test-controls/delay` atomically replaces it with a complete payload such as `{ "durationSeconds": 5, "scope": "BOTH" }`. Duration must be a whole number from 0 through 60 and scope must be `API`, `UI`, or `BOTH`. Both endpoints are intentionally public for test scripts; the mutation still requires a trusted `Origin`.

The setting is in-memory per server process, shared across users, and starts as `{ "durationSeconds": 0, "scope": "BOTH" }` after each restart. The control endpoints, documentation, and legacy `/health` redirect remain responsive. `API` and `BOTH` delay completion of subsequent ordinary `/api` responses using the value captured when each request enters middleware, without changing status, headers, body, or completed service side effects. UI delay behavior is owned by the dashboard and is not added to API-backed form actions.

The in-process scheduled-transfer worker runs once at startup and then every `SCHEDULED_TRANSFER_POLL_INTERVAL_MS` (default `1000`). Shutdown stops and awaits the worker before Prisma disconnects, so due work never races client teardown.

The seed command requires `SEED_CUSTOMER_EMAIL`, `SEED_CUSTOMER_PASSWORD`, `SEED_CUSTOMER_FIRST_NAME`, and `SEED_CUSTOMER_LAST_NAME`. Optional profile variables are documented in `.env.example`; rerunning the seed updates the matching email without exposing its password hash. It also upserts a non-login fictional recipient, email PayID `harbour.services@example.test`, and fictional BPAY billers `123456` (10-digit reference) and `98765` (8-digit reference). No recipient credential is printed or documented.

## Account and money rules

- Supported account types are exactly `EVERYDAY`, `SAVINGS`, and `BUSINESS`.
- Money is represented as integer AUD cents.
- New accounts receive `DEFAULT_ACCOUNT_BALANCE_CENTS`. It must be a non-negative safe integer and defaults to `100000000` cents (`$1,000,000.00` AUD).
- The server controls the opening balance; account-creation requests cannot override it.
- A customer may own multiple accounts.
- Ownership is `SINGLE` or `JOINT`; it is separate from the three product types. A joint account is one record shared by exactly two active registered customers and receives its opening balance once.
- Joint creation resolves a different co-owner by normalized email and grants both owners immediate equal visibility, transaction-history access, and transfer rights. There is no invitation or approval step.
- Transfers between Express Bank accounts are atomic: the service debits, credits, and creates one `Transfer` record in one Prisma transaction. The destination may belong to the same customer or another customer.
- Transfers cannot overdraw the source or send to the same account. A rejected transfer has no balance or history side effects.
- Payments are immediate AUD operations with an explicit passive review step. Account-number and email PayID payments atomically debit and credit internal accounts and link one `Payment` receipt to one `Transfer`; BPAY conditionally debits only the source and records an outgoing payment.
- Either joint owner may pay. The actor may not pay any account they own, directly or through PayID. PayIDs are normalized lowercase emails and their mapped account is never returned. BPAY codes and references are numeric, and each configured biller requires an exact reference length.
- Transaction history derives `SENT` or `RECEIVED` from the viewed account and includes transfer/payment method plus a safe counterparty label. Outgoing PayID and BPAY rows do not expose a mapped destination account.
- Scheduled transfers are customer-private, one-time instructions. Creating one checks ownership, destination, amount, future time, and current funds without reserving money. At the due time the worker atomically claims it, rechecks the same transfer rules, and either creates a normal transfer/history record as `COMPLETED` or records a side-effect-free `FAILED` result.
- Cards belong to the authenticated holder even when linked to a joint account. `ACTIVE` cards may be temporarily `LOCKED`, locked cards may be unlocked, and either may be permanently `DISABLED`. Responses expose only `••••` plus four digits. Five deterministic display-only sample purchases are created with every card and never change account balances.

SQLite `CHECK` constraints enforce the three account types, valid `SINGLE`/`JOINT` ownership shape, different joint owners, AUD currency, non-negative balances, positive transfer amounts, and distinct transfer accounts. Prisma uses strings for the semantic account-type and ownership enums because the current SQLite connector does not provide native enum types.

## API summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/customers` | Register a customer with a bcrypt password hash. |
| `POST` | `/api/login` | Authenticate and return a non-sensitive customer profile. |
| `GET` | `/api/session` | Restore the current authenticated safe customer profile. |
| `PUT` | `/api/profile` | Update required personal name and address fields. |
| `POST` | `/api/logout` | Revoke the current session and clear its cookie. |
| `GET` | `/api/accounts` | List accounts primarily or jointly owned by the authenticated customer. |
| `POST` | `/api/accounts` | Create an AUD account for the authenticated customer. |
| `POST` | `/api/joint-accounts` | Create one account shared with a different active customer identified by registered email. |
| `POST` | `/api/transfers` | Atomically transfer funds by destination account number. |
| `POST` | `/api/payments/resolve` | Validate and safely resolve an immediate payment without writes. |
| `POST` | `/api/payments` | Re-resolve and confirm an immediate account, PayID, or BPAY payment. |
| `GET`, `POST` | `/api/scheduled-transfers` | List private schedules or create a one-time future transfer. |
| `GET`, `POST` | `/api/cards` | List holder-owned cards or open one with five sample transactions. |
| `GET` | `/api/cards/:cardId` | Get one holder-owned masked card. |
| `POST` | `/api/cards/:cardId/lock` | Temporarily lock an active card. |
| `POST` | `/api/cards/:cardId/unlock` | Unlock a locked card. |
| `POST` | `/api/cards/:cardId/disable` | Permanently disable an active or locked card. |
| `GET` | `/api/accounts/:accountId/transactions` | List newest-first directional transfer history for an owned account. |
| `GET`, `PUT` | `/api/test-controls/delay` | Read or atomically replace the public 0–60 second test delay; PUT requires a trusted Origin. |
| `GET` | `/api/health` | Check database connectivity. |
| `GET` | `/docs`, `/docs/` | Redirect to or render the public Swagger UI. |
| `GET` | `/docs/openapi.json` | Return the active OpenAPI 3.0 contract. |

Protected routes derive the actor exclusively from the verified `eb_session` cookie. Client path/body identity is not accepted. Account response `customerId` remains creator/legacy metadata; `owners` is the complete safe owner set, and either joint owner is authorized. Missing or invalid authentication is `401`; authenticated cross-owner access and untrusted mutation origins are `403`.

API errors use `{ "error": "Human-readable message" }`. Payments and transfers return `400` for invalid input/self-payment, `403` for unowned resources or untrusted origin, `404` for missing records, and `409` for insufficient funds.

## Data model

- `Customer` holds normalized login/profile data and may be a primary or joint co-owner.
- `Customer.address` remains nullable for migration compatibility, but profile updates require a non-blank address.
- `Account` holds one unique `EXB-#########` number, ownership mode, primary owner, optional co-owner, product type, optional display name, one shared balance, currency, and timestamps.
- `Transfer` links source and destination accounts and stores integer cents, an optional description, and creation time.
- `PayIdDirectoryEntry` maps one active normalized email to an internal account and stores only a safe display name for responses. `BpayBiller` stores a fictional numeric code and reference length rule.
- `Payment` stores the initiating customer, source, method, amount, optional transfer/directory/biller links, method-specific reference, and immutable safe receipt snapshots.
- `AuthSession` stores only a unique SHA-256 token hash, customer relation, activity timestamps, and absolute expiry. Raw tokens exist only transiently and in the HttpOnly cookie.
- `ScheduledTransfer` stores the authenticated creator, resolved account IDs, due instant, processing status, safe terminal reason, and optional resulting transfer.
- `Card` stores its holder, linked account, internal last four digits and state; `CardTransaction` stores exactly five deterministic samples per newly opened card.

Migration `0002_accounts_and_transfers` adds the account and transfer tables without resetting existing customers. Migration `0003_joint_accounts` preserves account IDs and transfer references while marking existing accounts `SINGLE` and adding the optional co-owner relation.
Migration `0004_auth_sessions` adds revocable server-side sessions without changing existing customer, account, or transfer data.
Migration `0005_profile_schedules_and_cards` adds the nullable legacy-compatible address plus scheduled-transfer, card, and card-transaction tables without resetting existing rows.
Migration `0006_payments` adds PayID directory, BPAY biller, and payment receipt tables with method-shape, amount, reference, and relationship constraints.

The bounded opaque-session and trusted-origin choices follow the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), and Node's cryptographic [`randomBytes`](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback) primitive.

## Tests and commands

```bash
npm test
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

The focused service tests cover customer normalization/hashing/duplicates, account types/configuration/customer status, joint-owner validation and listing, either-owner transfer/payment/history authorization, payment resolution secrecy, atomic account/PayID effects, BPAY debit-only behavior, rejected-write guarantees, and history direction/order.
