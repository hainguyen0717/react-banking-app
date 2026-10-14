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

The seed command requires `SEED_CUSTOMER_EMAIL`, `SEED_CUSTOMER_PASSWORD`, `SEED_CUSTOMER_FIRST_NAME`, and `SEED_CUSTOMER_LAST_NAME`. Optional profile variables are documented in `.env.example`; rerunning the seed updates the matching email without exposing its password hash.

## Account and money rules

- Supported account types are exactly `EVERYDAY`, `SAVINGS`, and `BUSINESS`.
- Money is represented as integer AUD cents.
- New accounts receive `DEFAULT_ACCOUNT_BALANCE_CENTS`. It must be a non-negative safe integer and defaults to `100000000` cents (`$1,000,000.00` AUD).
- The server controls the opening balance; account-creation requests cannot override it.
- A customer may own multiple accounts.
- Transfers between Express Bank accounts are atomic: the service debits, credits, and creates one `Transfer` record in one Prisma transaction. The destination may belong to the same customer or another customer.
- Transfers cannot overdraw the source or send to the same account. A rejected transfer has no balance or history side effects.
- Transaction history derives `SENT` or `RECEIVED` from the viewed account and returns the counterparty account number.

SQLite `CHECK` constraints enforce the three account types, AUD currency, non-negative balances, positive transfer amounts, and distinct transfer accounts. Prisma uses strings for the semantic account-type enum because the current SQLite connector does not provide a native enum type.

## API summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/customers` | Register a customer with a bcrypt password hash. |
| `POST` | `/api/login` | Authenticate and return a non-sensitive customer profile. |
| `GET` | `/api/customers/:customerId/accounts` | List accounts owned by an active customer. |
| `POST` | `/api/customers/:customerId/accounts` | Create an AUD account with the configured opening balance. |
| `POST` | `/api/transfers` | Atomically transfer funds by destination account number. |
| `GET` | `/api/customers/:customerId/accounts/:accountId/transactions` | List newest-first directional transfer history for an owned account. |
| `GET` | `/api/health` | Check database connectivity. |
| `GET` | `/docs/openapi.json` | Return the active OpenAPI 3.0 contract. |

The `customerId` route/body value is the intentional demo ownership/session mechanism. It is not production authentication.

API errors use `{ "error": "Human-readable message" }`. Transfers return `400` for invalid input/self-transfer, `403` for unowned resources, `404` for missing records, and `409` for insufficient funds.

## Data model

- `Customer` holds normalized login/profile data and owns accounts.
- `Account` holds a unique `EXB-#########` number, type, optional display name, balance, currency, and timestamps.
- `Transfer` links source and destination accounts and stores integer cents, an optional description, and creation time.

Migration `0002_accounts_and_transfers` adds the account and transfer tables without resetting existing customers.

## Tests and commands

```bash
npm test
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

The focused service tests cover customer normalization/hashing/duplicates, account types/configuration/customer status, transfer validation/ownership/atomic side effects, and history direction/order.
