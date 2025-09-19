# Backend Service

## Database selection

The backend uses **PostgreSQL** as the primary data store. PostgreSQL offers robust transactional guarantees, native JSON support for storing supplementary metadata, powerful indexing, and mature tooling. These characteristics make it well-suited for a banking context where relational integrity, auditability, and long-term maintainability are critical.

## Getting started

1. Copy the environment template and adjust it to your local setup:

   ```bash
   cd backend
   cp .env.example .env
   ```

   Update the `DATABASE_URL` with valid PostgreSQL credentials. Prisma expects the connection string to follow the format:

   ```
   postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=SCHEMA
   ```

2. Install dependencies and generate the Prisma client:

   ```bash
   npm install
   npm run prisma:generate
   ```

3. Apply database migrations:

   ```bash
   # For local development (creates new migrations when the schema changes)
   npm run prisma:migrate:dev -- --name init

   # For CI/CD or production environments
   npm run prisma:migrate
   ```

   The first migration ensures the `pgcrypto` extension is available so UUID identifiers can be generated via `gen_random_uuid()`.

4. Seed at least one customer record for testing. Configure the seed variables in `.env` (see `.env.example`) and run the helper script, or open Prisma Studio to manage records manually.

   ```bash
   # Seed a deterministic customer based on the values in your .env file
   npm run seed

   # Or inspect/edit records through a UI
   npx prisma studio
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

   The server listens on the port defined by the `PORT` environment variable (defaults to `4000`).

## Customer model

`prisma/schema.prisma` defines the `Customer` table with the following core fields:

| Field          | Type      | Notes                                               |
|----------------|-----------|-----------------------------------------------------|
| `id`           | UUID      | Primary key generated via `uuid()`                  |
| `email`        | String    | Unique login identifier                            |
| `passwordHash` | String    | BCrypt hash of the login password                  |
| `firstName`    | String    | Customer first name                                |
| `lastName`     | String    | Customer surname                                   |
| `phoneNumber`  | String?   | Optional contact number                            |
| `dateOfBirth`  | DateTime? | Optional date of birth metadata                    |
| `isActive`     | Boolean   | Indicates whether the customer can authenticate    |
| `lastLoginAt`  | DateTime? | Timestamp of the most recent successful login      |
| `createdAt`    | DateTime  | Creation timestamp (managed by the database)       |
| `updatedAt`    | DateTime  | Update timestamp (managed by Prisma/database)      |

## Login flow

The `/login` endpoint accepts an `email` and `password`, performs a lookup via Prisma against the PostgreSQL database, verifies the password using bcrypt, updates the `lastLoginAt` timestamp, and returns only the non-sensitive customer profile fields (ID, email, names, phone, date of birth, and latest login timestamp). This ensures all authentication attempts leverage the centralized relational data model without exposing credential hashes or internal flags.

## Additional commands

- `npm run prisma:generate`: Regenerate the Prisma client after editing `schema.prisma`.
- `npm run prisma:migrate:dev`: Create and apply a new migration while developing locally.
- `npm run prisma:migrate`: Apply migrations without creating new ones (useful for CI/CD).
- `npm run seed`: Populate or refresh a development customer using the values provided in `.env`.

## Project structure

```
backend/
├── .env.example
├── package.json
├── prisma/
│   ├── migrations/
│   │   ├── 0001_init/
│   │   │   └── migration.sql
│   │   └── migration_lock.toml
│   └── schema.prisma
└── src/
    ├── lib/
    │   └── prisma.js
    ├── services/
    │   └── customerService.js
    └── server.js
```
