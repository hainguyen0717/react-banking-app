# React Banking App

This repository now includes a TypeScript-based authentication backend that can be used alongside the React frontend.

## Backend

The backend lives in [`backend/`](backend/) and exposes:

- A `POST /api/login` endpoint that validates customer credentials, hashes passwords using PBKDF2, and issues opaque session tokens.
- Structured request/response DTOs with input validation and consistent error handling.
- An OpenAPI 3.0 specification available at `GET /docs/openapi.json` and rendered at `GET /docs`.

See [`backend/README.md`](backend/README.md) for setup instructions, scripts, and example payloads.
