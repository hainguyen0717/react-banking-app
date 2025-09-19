# Banking Authentication Backend

This package provides a lightweight Node.js/TypeScript service that authenticates banking customers and exposes an OpenAPI specification for the frontend.

## Available scripts

- `npm run build` – compile TypeScript sources into the `dist/` directory.
- `npm start` – start the compiled server from `dist/` (requires `npm run build` first).
- `npm run lint` – perform a fast type-check only pass using the TypeScript compiler.

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/login` | Validates a customer's credentials and returns an opaque token. |
| `GET` | `/docs/openapi.json` | Returns the OpenAPI 3.0 document. |
| `GET` | `/docs` | Renders a simple documentation page that inlines the specification. |

### Authentication flow

1. Submit an `application/json` payload to `POST /api/login` that matches the [LoginRequest](#loginrequest) schema.
2. When the credentials are valid, the API returns a [LoginResponse](#loginresponse) payload. Invalid submissions produce structured error responses.

#### LoginRequest

```json
{
  "email": "jane.doe@example.com",
  "password": "Sup3rSecret!"
}
```

#### LoginResponse

```json
{
  "token": "...",
  "customerId": "cust-1001",
  "customerName": "Jane Doe"
}
```

## Development notes

- Passwords are hashed using PBKDF2 with a random salt and verified with a timing-safe comparison.
- Input validation is enforced via request DTOs that sanitize emails and guard against malformed requests.
- Errors are normalized into JSON payloads that include the HTTP status and optional diagnostic details.
- The OpenAPI description is generated statically so it can be consumed by tooling without additional runtime dependencies.
