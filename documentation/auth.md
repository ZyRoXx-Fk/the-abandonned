# Client / business authentication

## Model

The two interface profiles map to the existing backend models:

- **Client** → `Client`, JWT role `client`.
- **Business** → `Owner`, JWT role `owner`.

Business registration creates the owner’s personal account, not a `Business` document. Setting up the business remains a separate workflow, notably through the existing MCP tools. Both registration flows require `firstName`, `lastName`, `email`, and `password`.

## Routes

All routes are under `/api/auth`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/clients/register` | Register a client and start their session (201) |
| POST | `/owners/register` | Register an owner and start their session (201) |
| POST | `/clients/login` | Log in a client only (200) |
| POST | `/owners/login` | Log in an owner only (200) |
| POST | `/login` | Legacy shared login, retained for compatibility (200) |
| GET | `/me` | Return the authenticated profile (200) |
| POST | `/logout` | Clear the session cookie, even if the session has expired (204) |
| PUT | `/clients/preferences` | Update an authenticated client’s preferences (200) |

Registration:

```json
{
  "firstName": "Camille",
  "lastName": "Martin",
  "email": "camille@example.com",
  "password": "a-long-example-password"
}
```

Login:

```json
{
  "email": "camille@example.com",
  "password": "a-long-example-password"
}
```

Registration / login responses preserve the existing `{ token, role, user }` contract. `user` contains `id`, `firstName`, `lastName`, `email`, `createdAt`, and any client preferences. No password or hash is returned. The frontend ignores the returned bearer token: its session relies on the HttpOnly cookie. `/me` returns a flat profile `{ role, id, firstName, lastName, email, createdAt, ... }`.

Logging in with the wrong account type returns the same 401 as invalid credentials, without starting a session. The existing rule preventing reuse of an email address already registered under the other profile is preserved.

## Validation and errors

- First and last name: trimmed values, 1 to 120 characters, whitespace-only strings rejected.
- Email: trimmed, normalized to lowercase, and validated, with a maximum of 254 characters.
- New password: at least 8 characters and at most 72 UTF-8 bytes to prevent silent truncation by bcrypt. Older, shorter passwords remain usable for login.
- Passwords are hashed with bcrypt (cost 10).
- Validation 400: `code: VALIDATION_ERROR`, with `details: [{ field, message }]`.
- Email already in use 409: `code: EMAIL_EXISTS`.
- Invalid credentials 401: `code: INVALID_CREDENTIALS`.
- Disallowed browser origin 403: `code: ORIGIN_NOT_ALLOWED`.
- Rate limit exceeded: 429.
- Unexpected error 500: generic message, with details restricted to server logs.

Authentication mutations are limited to 10 attempts per minute, per route and IP address. This limiter is in-memory and suitable for a demo instance; a multi-instance deployment requires shared storage and an appropriate trusted-proxy configuration.

## Session and security

The backend issues the `relay_session` cookie with `HttpOnly`, `SameSite=Lax`, `Path=/api`, a 7-day expiration, and `Secure` when `NODE_ENV=production`. It is restricted to the API host, with no Domain attribute. Authentication responses use `Cache-Control: no-store`.

The middleware accepts this cookie and maintains compatibility with `Authorization: Bearer <token>` for API clients. An invalid Authorization header is never silently replaced by the cookie. Role checks remain server-side.

Allowed origins are defined in `FRONTEND_URL` (a comma-separated list). CORS allows credentials only for these origins. Browser requests that change authentication or use the cookie for a protected mutation are rejected if their Origin header is not allowed. Non-browser clients without an Origin header remain supported.

**Deployment**: the frontend and API must use HTTPS and belong to the same site (for example, `app.example.com` and `api.example.com`, or behind a same-origin proxy). Different root domains are not supported by the SameSite=Lax cookie. Locally, use the same hostname on both sides, for example `localhost` for both the frontend and API, even if the ports differ.

Logging out removes the browser session. JWTs remain stateless: a previously copied bearer token remains valid until it expires; this prototype has no revocation list or refresh token.

## Configuration

Create `code/backend/.env` from `.env.example`, then set a valid MongoDB connection and a strong random JWT secret:

```dotenv
PORT=3000
FRONTEND_URL=http://localhost:4321,http://localhost:4322
MONGODB_URI=mongodb://localhost:27017/relay
JWT_SECRET=<strong-random-secret>
```

For example, generate the secret with `openssl rand -hex 32`. Do not commit `.env` to version control. Registration checks that JWT configuration is present before saving the account, to prevent partial account creation caused by a missing secret.

From `code/backend`:

```sh
npm ci
npm run dev
```

In `code/frontend/.env`:

```dotenv
PUBLIC_API_BASE_URL=http://localhost:3000
```

Restart the frontend after changing the environment. This variable is public and embedded at build time; do not put any secrets in it. For a preview served on another port, also add its origin to `FRONTEND_URL`.

## Tests

From `code/backend`:

```sh
npm test
npm run build
```

Tests use Fastify `inject`, the actual Zod schemas, bcrypt, JWT, cookies, CORS, and rate limiter. Only persistence is replaced with in-memory repositories: no MongoDB instance or real secret is required. They cover both profiles, Bearer compatibility, cross-profile rejections, expired sessions, duplicates, validation, origins, rate limiting, and production cookies. Actual MongoDB persistence must be verified using the project environment.
