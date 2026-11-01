# relay — Hackathon frontend

A responsive, bilingual English / French interface built with Astro, plain CSS, and TypeScript. English is the default language. No client-side framework or additional UI library.

## Getting started

From `code/frontend`, with Node.js >= 22.23.4 and pnpm:

```sh
pnpm install
pnpm astro dev --background
```

Server management: `pnpm astro dev status`, `pnpm astro dev logs`, `pnpm astro dev stop`.

Static build: `pnpm build`. Preview: `pnpm preview`.

## Pages and languages

- `/`: animated hotel / restaurant / shop heading, two copyable prompts, and access to client / business accounts.
- `/client/login/` and `/client/register/`: client forms.
- `/business/login/` and `/business/register/`: business forms.
- `/fr/`, `/fr/client/login/`, `/fr/client/register/`, `/fr/business/login/`, `/fr/business/register/`: the same pages in French.

Astro’s native i18n routing sets `en` as the default language without a prefix and `fr` with the `/fr/` prefix. There are no browser-language-based redirects: `/` always stays in English. The EN / FR switcher preserves the current page, profile, and login / registration mode; internal links and the logo follow the selected language. Form values are not carried over when switching languages.

Content is centralized in `code/frontend/src/i18n/messages.ts`, with TypeScript checks for the translation structure. Localized paths are managed by `code/frontend/src/i18n/index.ts`. The animated heading, forms, errors, notifications, accessible labels, metadata, and copied prompts all use the page’s language. The HTML `lang` attribute and alternate `hreflang` links are generated for each page.

Routes remain lightweight and reuse `code/frontend/src/components/pages/HomePage.astro` and `AuthPage.astro`. The client / business tabs preserve the login or registration mode.

## MCP configuration

Copy `code/frontend/.env.example` to `code/frontend/.env` and set:

```dotenv
PUBLIC_MCP_CLIENT_URL=https://your-server/client/mcp
PUBLIC_MCP_BUSINESS_URL=https://your-server/business/mcp
```

These URLs are public and embedded in the prompts at build time. Do not include tokens or secrets. Rebuild after making changes. If no URL is provided, the prompt contains `[URL_MCP_CLIENT]` or `[URL_MCP_BUSINESS]` and explicitly asks for the actual URL before continuing. The site does not invent or install any MCP server or package.

The English and French prompts are centralized in `code/frontend/src/lib/profiles.ts`. Copying uses the Clipboard API; if it is unavailable or access is denied, a localized dialog offers text for manual selection. HTTPS (or localhost) is required for automatic copying.

## Authentication

The forms connect to the Fastify backend through `code/frontend/src/lib/auth-api.ts` and `code/frontend/src/scripts/auth-form.ts`. Set `PUBLIC_API_BASE_URL` in `.env` (the backend origin, without `/api/auth`, defaulting to `http://localhost:3000`) and start the backend with MongoDB and `JWT_SECRET` configured. Add the actual frontend origin to `FRONTEND_URL` on the backend.

- Client → `/api/auth/clients/register` and `/api/auth/clients/login`.
- Business → `/api/auth/owners/register` and `/api/auth/owners/login`: the backend model is an owner account, with a first and last name, not a business listing.
- Registration automatically logs the user in. The page then displays their identity and a logout control. An existing session is restored using `/api/auth/me`, including after a reload or language change.
- Requests use `credentials: include` and an HttpOnly cookie. No JWT or password is written to `localStorage` or `sessionStorage`.
- Forms validate fields and display API errors in English or French. Duplicate submissions are blocked while requests are pending, and requests time out after 15 seconds.

Pages remain static; security and persistence are handled by the backend, not by hiding forms. In production, use HTTPS and frontend / backend origins belonging to the same site for the SameSite=Lax cookie. See [backend authentication](./auth.md) for contracts, configuration, and limitations.

## Art direction

The provisional “relay” identity uses a palette inspired by the [official BaselHack website](https://www.baselhack.ch/): black / charcoal backgrounds and lemon yellow. Colors taken from its stylesheet: `#F2E94D` (primary yellow), `#F5EE73` (light yellow), `#EEE319` (bold yellow), `#171717` and `#262626` (surfaces). Design tokens are centralized in `code/frontend/src/styles/global.css` and applied to the homepage, forms, menus, notifications, and copy dialog. DM Sans remains the body font; Fira Code, used by BaselHack, adds accents to the footer. Fallback fonts are provided.

Icons come from **Bootstrap Icons 1.11.3**, the same library and version used by the official website. Only the required SVGs are embedded in the HTML from the local package through `Icon.astro`: no icon font or CDN request is needed. Hotel, restaurant, and shop icons replace the carousel emojis; the lightning bolt echoes BaselHack’s visual language. The MIT license is distributed in `code/frontend/public/licenses/bootstrap-icons.txt`. The “relay” identity remains distinct from the official BaselHack logo.

A compact homepage without illustrations or marketing sections; centered forms without a decorative panel. The name can be replaced in `Brand.astro`, the metadata, and the prompts.

The discovery heading (`DiscoveryHeading.astro`) cycles through the hotel / restaurant / shop categories in the selected language, using vertical CSS animation without layout shifts. A control lets users pause the animation. The full heading remains stable for screen readers; cycling is disabled with `prefers-reduced-motion` or when JavaScript is unavailable.

## Pairing panel and verification boundaries

After website login, explicit Generate pairing code calls protected `POST /api/auth/link-token` using the same `PUBLIC_API_BASE_URL` and `credentials: include`. Backend response is201 `{token,expiresAt,principal:{role,userId}}`; the panel checks captured account ID and mapped role (Business→owner) before dropping the private identity from normalized pairing state. Only generated `TRUST-`+32 lowercase hexadecimal codes are interpolated into private pairing prompts; public installation prompts contain no code/identity/secrets. Canonical tool is `link_session({token})`; `pair_session` remains compatible and `link_owner_session` is owner-only.

No automatic generation on login/load. `relay:session` profile|null notifications coordinate restore/login/logout. Logout intent, account switch, late responses, expiry and page lifecycle clear/abort private state. Do not persist codes or JWTs in browser storage. Reconnect after the30-minute MCP idle expiry uses a fresh15-minute code; replacement invalidates older codes. Transport aliases `/sse` and `/messages` dispatch Streamable HTTP like `/mcp`, not legacy SSE.

Owner/customer prompts explain upfront that final human validation is required. The host asserts `approved:true` after approval; the server cannot independently certify human consent. No payments are collected and no civil/independent identity certification is implied. See [operations](agentic-relay.md) and [exact fictional demo](agentic-relay-demo.md).

Browser evidence is from a dedicated local mock API/browser and isolated frontend port, not real hosted backend cookie/assistant integration. Mock lifecycle and BFcache tests do not establish all-browser BFcache behavior or screen-reader/accessibility certification. Actual chosen-assistant HTTPS smoke remains NOT RUN and is an external release blocker; the linked demo lists manual checks. The audit fetcher likewise has injected-adapter/source-inspection coverage, not live TLS pentest coverage.
