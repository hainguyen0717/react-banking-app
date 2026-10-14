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

The backend listens on `PORT` (`4000` in `.env.example`, with a source fallback of `3001`). `DATABASE_URL=file:./dev.db` stores the database under `prisma/dev.db` because Prisma resolves relative SQLite paths from the schema directory.

Opaque sessions use `SESSION_IDLE_TIMEOUT_SECONDS` (default `1800`) and `SESSION_ABSOLUTE_TIMEOUT_SECONDS` (default `28800`). `FRONTEND_ORIGINS` is a comma-separated exact allowlist used by both credentialed CORS and mutation-origin checks. Development cookies are `HttpOnly`, `SameSite=Lax`, and path `/`; production adds `Secure` and uses `SameSite=Strict`.

The seed command requires `SEED_CUSTOMER_EMAIL`, `SEED_CUSTOMER_PASSWORD`, `SEED_CUSTOMER_FIRST_NAME`, and `SEED_CUSTOMER_LAST_NAME`. Optional profile variables are documented in `.env.example`; rerunning the seed updates the matching email without exposing its password hash.

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
- Transaction history derives `SENT` or `RECEIVED` from the viewed account and returns the counterparty account number.

SQLite `CHECK` constraints enforce the three account types, valid `SINGLE`/`JOINT` ownership shape, different joint owners, AUD currency, non-negative balances, positive transfer amounts, and distinct transfer accounts. Prisma uses strings for the semantic account-type and ownership enums because the current SQLite connector does not provide native enum types.

## API summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/customers` | Register a customer with a bcrypt password hash. |
| `POST` | `/api/login` | Authenticate and return a non-sensitive customer profile. |
| `GET` | `/api/session` | Restore the current authenticated safe customer profile. |
| `POST` | `/api/logout` | Revoke the current session and clear its cookie. |
| `GET` | `/api/accounts` | List accounts primarily or jointly owned by the authenticated customer. |
| `POST` | `/api/accounts` | Create an AUD account for the authenticated customer. |
| `POST` | `/api/joint-accounts` | Create one account shared with a different active customer identified by registered email. |
| `POST` | `/api/transfers` | Atomically transfer funds by destination account number. |
| `GET` | `/api/accounts/:accountId/transactions` | List newest-first directional transfer history for an owned account. |
| `GET` | `/api/health` | Check database connectivity. |
| `GET` | `/docs/openapi.json` | Return the active OpenAPI 3.0 contract. |

Protected routes derive the actor exclusively from the verified `eb_session` cookie. Client path/body identity is not accepted. Account response `customerId` remains creator/legacy metadata; `owners` is the complete safe owner set, and either joint owner is authorized. Missing or invalid authentication is `401`; authenticated cross-owner access and untrusted mutation origins are `403`.

API errors use `{ "error": "Human-readable message" }`. Transfers return `400` for invalid input/self-transfer, `403` for unowned resources, `404` for missing records, and `409` for insufficient funds.

## Data model

- `Customer` holds normalized login/profile data and may be a primary or joint co-owner.
- `Account` holds one unique `EXB-#########` number, ownership mode, primary owner, optional co-owner, product type, optional display name, one shared balance, currency, and timestamps.
- `Transfer` links source and destination accounts and stores integer cents, an optional description, and creation time.
- `AuthSession` stores only a unique SHA-256 token hash, customer relation, activity timestamps, and absolute expiry. Raw tokens exist only transiently and in the HttpOnly cookie.

Migration `0002_accounts_and_transfers` adds the account and transfer tables without resetting existing customers. Migration `0003_joint_accounts` preserves account IDs and transfer references while marking existing accounts `SINGLE` and adding the optional co-owner relation.
Migration `0004_auth_sessions` adds revocable server-side sessions without changing existing customer, account, or transfer data.

The bounded opaque-session and trusted-origin choices follow the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), and Node's cryptographic [`randomBytes`](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback) primitive.

## Tests and commands

```bash
npm test
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

The focused service tests cover customer normalization/hashing/duplicates, account types/configuration/customer status, joint-owner validation and listing, either-owner transfer/history authorization, atomic side effects, and history direction/order.
