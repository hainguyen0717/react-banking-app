# React Banking App

This repository is a React, CommonJS Express, Prisma, and SQLite banking demo built for deterministic test-tool scenarios. It supports customer registration and login, editable personal information, three AUD account types with personal or joint ownership, immediate and scheduled transfers, directional transaction history, and holder-owned demo debit cards.

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

The dashboard uses deep-linkable function navigation. Cards is a standalone primary destination after the Accounts group and before the Transfer group:

- `/dashboard?view=accounts` — account overview and transaction history.
- `/dashboard?view=new-account` — new account form.
- `/dashboard?view=new-joint-account` — joint account form for a second registered active customer.
- `/dashboard?view=cards` — open, temporarily lock, unlock, and permanently disable demo cards.
- `/dashboard?view=transfer` — transfer form.
- `/dashboard?view=schedule-transfer` — one-time future transfer form with a picker-only local date and time.
- `/dashboard?view=scheduled-transfers` — customer-private schedule statuses.
- `/dashboard?view=profile` — edit first name, last name, and address.

Missing or invalid `view` values show the accounts overview. A transfer can target any valid Express Bank account number, including an account owned by another customer.

## Active APIs

- `POST /api/customers` and `POST /api/login` register and authenticate customers.
- `GET /api/session` restores the authenticated safe profile; `POST /api/logout` revokes the current session.
- `PUT /api/profile` updates the authenticated customer's required first name, last name, and address.
- `GET|POST /api/accounts` list and create accounts for the authenticated customer.
- `POST /api/joint-accounts` creates one shared account for the authenticated customer and a registered co-owner resolved by email.
- `POST /api/transfers` performs atomic, no-overdraft transfers between Express Bank accounts by destination account number.
- `GET|POST /api/scheduled-transfers` lists and creates one-time future transfers. Funds are not reserved; the worker rechecks rules when due.
- `GET|POST /api/cards`, `GET /api/cards/:cardId`, and card action endpoints manage masked holder-owned demo cards. Each newly opened card has exactly five display-only sample transactions.
- `GET /api/accounts/:accountId/transactions` returns newest-first `SENT`/`RECEIVED` history.
- `GET /api/health` checks database health; `GET /health` redirects to it.
- `GET /docs/` serves a browser-friendly Swagger UI; `GET /docs` redirects to it, and `GET /docs/openapi.json` keeps serving the active OpenAPI 3.0 JSON contract.

Open `/docs/` on the configured backend origin; with the copied development environment, that is [http://localhost:4000/docs/](http://localhost:4000/docs/). (`server.js` falls back to port `3001` only when `PORT` is unset.) The UI uses locally bundled open-source assets and the existing JSON contract, so it requires no paid service or CDN. Its standard **Try it out** flow sends same-origin cookies: log in through `POST /api/login`, then the browser stores and sends the HttpOnly session cookie automatically without exposing or preloading the token in the page.

Authentication uses an opaque `eb_session` HttpOnly cookie. Only a SHA-256 token hash is stored in SQLite; the browser keeps no token or trusted profile in Web Storage. Sessions have configurable idle and absolute expiry, logout revokes only the current session, and protected APIs derive customer identity from the verified session. Cookie-authenticated mutations require either an exact configured frontend `Origin` or the exact protocol, host, and port serving the API (used by same-origin Swagger UI). Credentialed CORS remains limited to configured frontend origins. The design is deliberately scoped to this test-tool demo and does not add OAuth, MFA, or production session infrastructure.

See [backend/README.md](backend/README.md) for backend details and [docs/CURRENT_FUNCTIONS_AND_APIS.md](docs/CURRENT_FUNCTIONS_AND_APIS.md) for the function-to-API table.

## Verification

```bash
cd backend && npm test
cd ../frontend && npm test -- --run
npm run build
```
