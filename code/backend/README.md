# Agentic relay backend

Fastify + TypeScript + Mongoose + Streamable HTTP MCP. No payment, deployment, arbitrary schema execution or chat-based account creation.

From this directory, install using the existing lockfile/policy, configure MongoDB8 replica-set `MONGODB_URI`, `JWT_SECRET`, and allowed `FRONTEND_URL` origins, then `pnpm dev`. `pnpm build` / `pnpm start` build/start production. Keep secrets out of prompts, logs and public frontend configuration. `/health` reports status; `/mcp` is the canonical Streamable HTTP endpoint (`/sse` and `/messages` are transport aliases, not old SSE). Pair the active transport using a code generated through trusted authenticated website `POST /api/auth/link-token`.

Start with owner onboarding, final preview and human approval, then prove customer usability. See [operations and migration](../../documentation/agentic-relay.md), [exact fictional demo and release checklist](../../documentation/agentic-relay-demo.md), [authentication](../../documentation/auth.md), and [frontend](../../documentation/frontend.md).

- `pnpm test`: backend unit/domain and Mongo contract tests (explicit disposable `TEST_MONGODB_URI` required).
- `pnpm test:integration`: real Mongo transaction/standalone behavior and actual production HTTP SDK demo. Use only generated `relay_test_*` databases, never application data. Standalone checks support optional disposable MongoDB8 `TEST_MONGOD_BINARY`.
- `pnpm build`: strict source TypeScript build.
- `pnpm migrate:relay`: manual default dry run; `pnpm migrate:relay --apply` is the only CLI write opt-in. No import/startup seeding or migration. Back up and review first; see rollback constraints in operations. Never run migration on existing app data as part of tests.

Transactions are mandatory for publication/commit/amendments. Standalone Mongo must refuse atomic workflows rather than fall back to unsafe writes. Retrying an approved proposal returns the durable outcome; unknown availability is not stock. Priced actions remain `not_collected_demo`, free tables `not_applicable`; publication is not independent certification.

Chosen-assistant hosted HTTPS smoke is **NOT RUN / external release blocker** until separately provisioned. Local HTTP SDK + real Mongo and browser mock tests are not proof of chosen-assistant human approval UX, live TLS security or accessibility certification. No original checkout/user database-viewer work is copied into this branch.
