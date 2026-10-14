# React Banking App

This repository is a React, CommonJS Express, Prisma, and SQLite banking demo built for deterministic test-tool scenarios. It supports customer registration and login, three AUD account types with personal or joint ownership, transfers between Express Bank accounts, and directional transaction history.

## Running the application

1. Install dependencies:

   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. Copy `backend/.env.example` to `backend/.env`, then apply migrations and start the API:

   ```bash
   cd backend
   npm run prisma:generate
   npm run prisma:migrate
   npm run dev
   ```

3. Start the UI in a second terminal:

   ```bash
   cd frontend
   npm run dev
   ```

Open [http://localhost:5173](http://localhost:5173). The frontend uses `http://localhost:4000` by default; set `VITE_API_BASE_URL` to change it.

Create a customer from the login page or use the configured seeded customer. After login, the dashboard can create `EVERYDAY`, `SAVINGS`, and `BUSINESS` accounts. Ownership is either personal or joint; joint is not a fourth product type. Each new account receives the server-controlled `DEFAULT_ACCOUNT_BALANCE_CENTS` opening balance, which defaults to `100000000` cents (`$1,000,000.00` AUD) for test purposes. A joint account receives that balance once and is shown in full to each of its two owners.

The dashboard uses grouped function navigation with deep-linkable views:

- `/dashboard?view=accounts` — account overview and transaction history.
- `/dashboard?view=new-account` — new account form.
- `/dashboard?view=new-joint-account` — joint account form for a second registered active customer.
- `/dashboard?view=transfer` — transfer form.

Missing or invalid `view` values show the accounts overview. A transfer can target any valid Express Bank account number, including an account owned by another customer.

## Active APIs

- `POST /api/customers` and `POST /api/login` register and authenticate customers.
- `GET /api/session` restores the authenticated safe profile; `POST /api/logout` revokes the current session.
- `GET|POST /api/accounts` list and create accounts for the authenticated customer.
- `POST /api/joint-accounts` creates one shared account for the authenticated customer and a registered co-owner resolved by email.
- `POST /api/transfers` performs atomic, no-overdraft transfers between Express Bank accounts by destination account number.
- `GET /api/accounts/:accountId/transactions` returns newest-first `SENT`/`RECEIVED` history.
- `GET /api/health` checks database health; `GET /health` redirects to it.
- `GET /docs/openapi.json` serves the active OpenAPI 3.0 JSON contract.

Authentication uses an opaque `eb_session` HttpOnly cookie. Only a SHA-256 token hash is stored in SQLite; the browser keeps no token or trusted profile in Web Storage. Sessions have configurable idle and absolute expiry, logout revokes only the current session, and protected APIs derive customer identity from the verified session. Cookie-authenticated mutations require an exact configured frontend `Origin`. The design is deliberately scoped to this test-tool demo and does not add OAuth, MFA, or production session infrastructure.

See [backend/README.md](backend/README.md) for backend details and [docs/CURRENT_FUNCTIONS_AND_APIS.md](docs/CURRENT_FUNCTIONS_AND_APIS.md) for the function-to-API table.

## Verification

```bash
cd backend && npm test
cd ../frontend && npm test -- --run
npm run build
```
