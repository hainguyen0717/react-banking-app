# React Banking App

This repository includes a React frontend and a Node.js authentication backend. Start each service in its own terminal so the user interface can talk to the API.

## Running the application

1. Install dependencies in both workspaces:

   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. Launch the backend (defaults to http://localhost:3001):

   ```bash
   cd backend
   npm run dev
   ```

3. Launch the frontend in a second terminal:

   ```bash
   cd frontend
   npm run dev
   ```

The frontend reads `VITE_API_BASE_URL` and points to `http://localhost:3001` by default, which matches the backend's default `PORT`.

## Backend

The backend lives in [`backend/`](backend/) and exposes:

- A `POST /api/login` endpoint that validates customer credentials, hashes passwords using bcrypt, and issues opaque session tokens.
- Structured request/response DTOs with input validation and consistent error handling.
- An OpenAPI 3.0 specification available at `GET /docs/openapi.json` and rendered at `GET /docs`.

See [`backend/README.md`](backend/README.md) for setup instructions, scripts, and example payloads.
