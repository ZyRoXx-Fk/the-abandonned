# Frontend container

Build from the repository root:

```sh
docker buildx build --platform linux/amd64 --load \
  -t ghcr.io/hbardet/relay-frontend:latest code/frontend

docker run --rm -p 8080:8080 \
  -e BACKEND_ORIGIN=https://relay-backend-latest.onrender.com \
  ghcr.io/hbardet/relay-frontend:latest
```

The build runs the frontend tests and creates the static Astro site. Only static
assets and Nginx configuration enter the non-root runtime; Node, source, tests,
development dependencies and local environment files are not shipped.

## Render / container hosting

- Use image `ghcr.io/hbardet/relay-frontend:latest`. If GHCR visibility is private,
  enter your GHCR username and a token with `read:packages` in the hosting
  dashboard, never in the image or repository.
- Nginx listens on `PORT` (default `8080`); the hosting platform can override it.
- Health-check path: `/healthz`. This checks the web server, not backend/database readiness.
- `BACKEND_ORIGIN` is a runtime setting. Use an HTTP(S) origin **without a path or
  trailing slash**, defaulting to `https://relay-backend-latest.onrender.com`.
  HTTPS upstream certificate verification and SNI remain enabled.
- The browser calls same-origin `/api/...`; Nginx forwards the original API path,
  request body, cookies, and Origin to the backend. This keeps the backend's
  host-only HttpOnly session cookie on the frontend's public host rather than
  relying on third-party cookies.
- In the **backend** configuration, set `FRONTEND_URL` to the actual public
  frontend origin (scheme + host + optional port; comma-separate multiple
  allowed origins). Do not bypass Origin checks in Nginx.
  Use public HTTPS for Secure session cookies.
- MCP connections still go directly to the configured MCP URL, not through
  Nginx. Optional Docker build arguments `PUBLIC_MCP_CLIENT_URL` and
  `PUBLIC_MCP_BUSINESS_URL` override the default Render MCP endpoint.
  They are public values baked into the site; runtime environment changes do
  not rewrite them.
- `PUBLIC_API_BASE_URL=/` is fixed in this container's build so API calls use the
  same-origin proxy. Do not deploy a local `.env` or credentials with the image.

After deployment, rehearse real owner/customer login, private code generation,
and pairing in the chosen assistant. Container HTTP smoke tests do not prove
a live hosted login or assistant session.
