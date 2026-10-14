# React Banking App

This repository is a React, CommonJS Express, Prisma, and SQLite banking demo built for deterministic test-tool scenarios. It supports customer registration and login, three AUD account types, transfers between Express Bank accounts, and directional transaction history.

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

Create a customer from the login page or use the configured seeded customer. After login, the dashboard can create `EVERYDAY`, `SAVINGS`, and `BUSINESS` accounts. Each new account receives the server-controlled `DEFAULT_ACCOUNT_BALANCE_CENTS` opening balance, which defaults to `100000000` cents (`$1,000,000.00` AUD) for test purposes.

The dashboard uses grouped function navigation with deep-linkable views:

- `/dashboard?view=accounts` — account overview and transaction history.
- `/dashboard?view=new-account` — new account form.
- `/dashboard?view=transfer` — transfer form.

Missing or invalid `view` values show the accounts overview. A transfer can target any valid Express Bank account number, including an account owned by another customer.

## Active APIs

- `POST /api/customers` and `POST /api/login` register and authenticate customers.
- `GET|POST /api/customers/:customerId/accounts` list and create owned accounts.
- `POST /api/transfers` performs atomic, no-overdraft transfers between Express Bank accounts by destination account number.
- `GET /api/customers/:customerId/accounts/:accountId/transactions` returns newest-first `SENT`/`RECEIVED` history.
- `GET /api/health` checks database health; `GET /health` redirects to it.
- `GET /docs/openapi.json` serves the active OpenAPI 3.0 JSON contract.

Authentication is intentionally lightweight: the frontend stores only the non-sensitive returned customer profile and sends its `customerId` as the demo ownership context. This is not a production session or authorization design.

See [backend/README.md](backend/README.md) for backend details and [docs/CURRENT_FUNCTIONS_AND_APIS.md](docs/CURRENT_FUNCTIONS_AND_APIS.md) for the function-to-API table.

## Verification

```bash
cd backend && npm test
cd ../frontend && npm test -- --run
npm run build
```
