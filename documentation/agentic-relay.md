# Owner-first agentic relay: operations and safety

Start with the business owner, not customer discovery. The assistant must explain **before collecting the request** that the person will validate the final publication, order, booking or amendment. Account creation/login happens on the trusted website; never ask for passwords, bearer tokens or payment credentials in chat. See [the reproducible demo](agentic-relay-demo.md).

## Trust and data boundaries

Supported categories are restaurant, hotel and shop. Owner publication is the owner's assertion, **not independent identity or civil certification**. Optional website audit is advisory, untrusted evidence, never an automatic import or approval. Redirect/DNS/private-address and prompt-injection controls have injected DNS/HTTP adapter and source-inspection coverage, not live socket/TLS/certificate penetration-test coverage. Audit failure must not invent facts. The deferred quoted-metadata extraction Minor remains final-review triage, not a certification claim.

Only published relay profiles/offerings/availability appear in discovery. A legacy `trusted` flag alone grants no actionable public inventory. Private drafts and action reads require the active transport's owner/client principal; arguments cannot supply a principal or foreign session ID. Owner action lists return safe action results, not customer identity, stored allocations or proposal internals. Existing read-only database-viewer security is unchanged; no viewer writes or raw Mongo query MCP tool were introduced.

Money is fixed integer minor units and explicit currency, calculated server-side, never caller totals. Ask the owner for final taxes/charges/policies; do not infer missing prices. EUR has two fraction digits in this demo. Orders are pickup-only; no delivery, payments, cancellation, order amendments or third-party commerce integrations. Priced confirmations remain `not_collected_demo`; free table bookings are `not_applicable`. Confirmed is not paid.

Unknown inventory is unavailable/unknown, not full capacity. Search/preview reserve nothing. Restaurant slots are explicit, non-overlapping local intervals; hotel check-in is included and checkout excluded, with one room per booking and local-date night enumeration (not elapsed 24-hour arithmetic). Inventory revisions and proposal term snapshots protect changed prices/stock. Owner stock edits cannot erase confirmed allocations.

## Pairing and transport

1. Create/login to a website account. Frontend Business maps to backend `owner`; Client maps to `client`.
2. Explicitly press Generate pairing code. Authenticated `POST /api/auth/link-token` uses the HttpOnly cookie and origin checks, not a chat-supplied identity. Response: HTTP 201 `{token, expiresAt, principal:{role,userId}}`. Codes are `TRUST-` plus 32 lowercase hexadecimal digits, single-use, expire in 15 minutes, stored hashed; replacement invalidates the previous code for that principal. Never put codes in logs, URLs or public installation prompts.
3. Connect a Streamable HTTP MCP client to `/mcp`; `/sse` and `/messages` are aliases of the **same Streamable HTTP dispatch**, not a separate legacy SSE subscription protocol. Session IDs originate at initialization. Use `link_session({token})` on that live connection. `pair_session` is compatibility spelling for the same handler. `link_owner_session` additionally requires an owner code; a role mismatch does not bind and safely releases the code unless replaced.
4. Each session has its own server/transport and immutable principal after binding. No rebinding or caller identity override. Idle expiry is 30 minutes; disconnect/DELETE removes the session. Reconnect with a new code; durable private drafts/actions survive. Pairing is scoped to the server process/session, not a cross-instance shared session bus.

Code generation is limited to 10/minute by socket IP. Failed consumption budgets are 10/session and 30/IP per minute, with reservation before async I/O; success releases the budget reservation. The retired public `/api/auth/link-token/verify` responds 410. Do not expose services externally without normal HTTPS/origin/auth operational review.

Frontend pairing validates the returned role **and account ID** against the captured session before dropping the private ID from copied text. Installation prompts are public and secret-free; pairing prompts contain only the temporary code and workflow guidance. Logout intent, account switch, expiry and page lifecycle clear/abort pairing state; generation never runs automatically on login/load. Cookies use `credentials: include`, HttpOnly, SameSite=Lax and Secure in production. Use same-site HTTPS origins and configured `FRONTEND_URL` / `PUBLIC_API_BASE_URL`; no JWT/localStorage fallback.

## Approval and errors

Discover `owner_onboarding`, `customer_assistance` prompts and `relay://workflow`. Prepare and commit are separate. Proposals expire after 15 minutes; a changed proposal requires fresh human approval. Final commit arguments are `{proposalId, revision, approved:true}`. This is the host/assistant's assertion that its human approved, **not independent proof of consent**. A malicious host can assert approval: the trusted-host human-validation boundary must be accepted explicitly before release.

Handler responses carry equivalent JSON text and `structuredContent`: `{ok:true,data}` or `{ok:false,error:{code,message,details?}}`; domain failures also set `isError`. Native SDK input validation occurs before the callback and can instead return `isError` text (`-32602` / input-validation error), without structuredContent. Clients must handle both; do not interpret SDK acceptance as validated human consent. Unknown handler errors suppress database/stack/credential details.

Commit rechecks terms and capacity and atomically persists records, allocations and events inside MongoDB transactions. Use MongoDB 8 replica-set/transaction-capable infrastructure. Standalone Mongo fails with `TRANSACTIONS_REQUIRED`, not an unsafe multi-write fallback. Retry the **same approved proposal ID/revision** after a lost response: committed durable outcomes remain idempotently retrievable, including after proposal expiry. Do not construct a second proposal merely to retry. Concurrent approvals must not oversell. Failed amendments preserve original reservation and allocations; no cancellation workflow is provided.

## Explicit legacy migration

No startup migration, seeding, lazy legacy-public query or trust promotion exists. `code/backend/scripts/migrate-relay-legacy.ts` exports `migrateLegacyBusinesses(options:{dryRun:boolean}):Promise<{scanned:number;drafted:number;skipped:number}>`. Importing it does not execute a command or connect. It opens its own explicit `MONGODB_URI` connection with autoCreate/autoIndex disabled. Raw reads avoid model/index/collection initialization on dry run.

Operator procedure (not permission to run against an existing database during this implementation):

1. Stop competing migration writers, take a database backup/snapshot and verify a restore on disposable infrastructure. Capture collection counts and exact revision/export of live data; restrict credentials. Never paste the URI into chat or captured logs.
2. Supply `MONGODB_URI` via a protected environment/secret manager. Run from `code/backend`: `pnpm migrate:relay` (default dry run) or `pnpm migrate:relay --dry-run`. Counts mean scanned legacy rows, eligible drafts that would be inserted, and skipped rows. This writes nothing, including no auto-created collections/indexes.
3. Review counts and owner mapping against the backup. Unknown categories, invalid captured ObjectId identities and existing relay-published rows are skipped, never guessed as restaurants.
4. Only after operator approval run `pnpm migrate:relay --apply`. The explicit flag is required for writes. Each eligible legacy ObjectId maps deterministically to draft/business ID `legacy_<24 hex>`. Atomic `$setOnInsert` on the built-in unique `_id` prevents repeated/concurrent duplicates; existing private drafts are not replaced. Counts from concurrent runs may differ, but only one insertion is possible. This is insert-only per row, not an all-business transaction; interrupted runs can be retried.
5. Owner resumes with `list_business_drafts` / `get_business_draft`, reviews `auditTrail` unconfirmed legacy name/address/cuisine suggestions, and supplies missing fields using ordinary draft tools. Nothing becomes published without preview and separate approval. Legacy capacity/availableSeats, categories not explicitly known, missing facts/prices/stock are never invented. No accounts are created or ownership overridden. Source trust/catalog/inventory/live actions remain untouched.
6. Rollback: use the backup and an exact manifest of newly inserted `legacy_*` draft IDs. Delete only those imports **if unchanged and unpublished** after verifying ownership/revisions. Do not blanket-delete drafts after owners have resumed work, reset live inventory or restore over confirmed actions. If an owner already published, stop and plan a reviewed recovery rather than destructive automatic rollback.

All migration executions in this task are only against fresh generated fixtures, never the original application database, even for dry run.

## Verification and release gates

Run backend `pnpm test`, `pnpm test:integration`, `pnpm build`; frontend `pnpm test`, `pnpm build`; strict whole backend test-tree typecheck and `git diff --check`. npm script equivalents are acceptable if pnpm dependency policy blocks; do not approve broad dependency builds to run tests. Mongo tests require explicit `TEST_MONGODB_URI` with a disposable `relay_test_*` base; each harness creates a new database (maximum 38 bytes), drops it and closes its connection. The production-composition demo points global mongoose ONLY at its generated database, never configuration fallback.

Integration standalone checks can use `TEST_MONGOD_BINARY` for a disposable MongoDB8 process on loopback. Verify the official macOS arm64 8.0.34 archive SHA256 `3255cbf2e70cc5de04220046e006067d20068656d1bfa674828768a51d20d5a6`, use a fresh dbpath and finally stop/remove process, archive and binary. No global install or Mongo downgrade. Transaction session operations stay sequential.

Local SDK + generated Mongo testing proves production composition and domain journeys, **not a chosen assistant's UI, prompts or consent behavior**. No hosted HTTPS endpoint or chosen assistant has been provisioned: chosen-assistant smoke is **NOT RUN — external release blocker**. Do not deploy/expose ports or use real accounts to bypass this gate. Complete the manual checklist in the demo before release.

Frontend browser checks used a dedicated mock API/browser/isolated dev port, not a hosted real-cookie backend roundtrip. Unit lifecycle/BFcache logic and mock browser evidence are not exhaustive BFcache compatibility, screen-reader or accessibility certification. Real assistant behavior, multi-browser lifecycle and assistive-technology validation remain manual checks. Never claim live TLS pentesting or civil certification from these tests.
