# relay phase 1: owner-first agentic businesses

Status: approved by the user on 2026-11-01. Implementation planning authorized; product implementation awaits plan review and execution-method selection.

## Intent

Explore web usage in the next 5–10 years when assistants, rather than business websites, become the main interface. relay is not a shopping website with a chatbot: it gives a business owner's assistant and a customer's assistant a shared, actionable business system through MCP.

The website is the entry point for account access and a copyable connection/onboarding prompt. Most subsequent work happens in the person's chosen assistant. relay itself stores and manages offerings, orders, and reservations in MongoDB.

The jury demonstration prioritizes the business owner. The customer experience then proves that the information the owner published can actually fulfill a request.

## Confirmed requirements

- Support restaurants, hotels, and shops, with owner-supplied offerings, prices, and operational information.
- A business owner copies a prompt that guides connecting MCP and onboarding the business conversationally.
- An existing website may optionally be audited for SEO/GEO and used to suggest onboarding information.
- Customers connect through a prompt, describe their needs, discover suitable offerings, and order, book, or modify a reservation.
- Customers cannot buy unpublished or nonexistent offerings. The backend is authoritative for prices, stock, availability, and permissions.
- The assistant must explain in advance that the person will need to validate the final request.
- Publication and transactional changes require final user approval, not just permission to gather information.
- Valid customer requests are automatically accepted by relay after that approval; no separate business-owner approval queue in this version.
- No real payment integration in this version. Confirmation must not imply successful payment. Future payment-dependent confirmation is a separate lifecycle step.

## Approaches considered

### Selected: owner-first breadth with typed category data

Shared onboarding, identity, drafts, approval, publication, and transaction infrastructure; validated restaurant, hotel, and shop data. Demonstrate a limited but working customer journey against the newly published business.

This was recommended and selected in conversation as option/phase 1. It demonstrates the central idea across business types, at the cost of limiting category-specific features.

### Alternative: restaurant-first vertical

Complete a deeper restaurant experience first, then add hotels and shops. It offers a smaller implementation surface and potentially stronger single demo, but does not demonstrate the chosen breadth as directly.

An unrestricted JSON store is not the selected approach: MongoDB flexibility does not remove the need for validation or executable business rules.

## Proposed phase 1 boundaries

The following are design recommendations, not additional requirements already agreed by the user.

### Owner-facing capabilities

- Connect an assistant, sign in/register through the website when needed, and securely pair the authenticated owner with MCP.
- Create or resume a persistent business draft; choose restaurant, hotel, or shop.
- Gather shared information: name, address, timezone, currency, description, contact information, opening/service hours, and applicable fulfillment/cancellation rules.
- Optionally audit a website and import explicitly labeled suggestions into the draft. Missing facts become questions, not invented defaults.
- Add and edit typed offerings and availability through conversation.
- Ask for a preview showing everything that will become public and any missing required information.
- Approve publication. Only published, valid offerings become discoverable/orderable.
- Later changes are drafted and approved before replacing published data. The existing published revision stays available while edits are incomplete.
- Read the owner's own business, offerings, and order/reservation records so the jury can see the downstream result.

### Minimum category coverage

| Category | Owner supplies | Minimum customer action |
| --- | --- | --- |
| Restaurant | Menu items, fixed-price variants/options, sellable units per item/variant, pickup service windows, and reservation slots with party-size limits and seat capacity | Order menu items for pickup; reserve a table and change party size, including 2 to 3 |
| Hotel | Room types, maximum guests per room, fixed nightly price, room count/availability by local night, and check-in/check-out rules | Book one room type for a date range; change dates or guest count within the published limits |
| Shop | Products, explicit variants, price per variant, available units, and pickup rules/windows | Buy a quantity of a published product variant for pickup |

This intentionally uses simplified capacity-based restaurant reservations, not table-layout optimization. Hotel pricing is a fixed nightly rate per room type, not a revenue-management system. Shop and food orders use pickup, not delivery logistics. These limitations must be visible in the owner workflow and demo documentation.

Each demo has one currency per business. Money is stored in integer minor units plus currency, calculated server-side. No live currency conversion, inferred tax treatment, or invented fees. Publication requires the owner to supply the final customer-facing price and clarify included charges; complex tax calculation is deferred.

## Conversational contract

At onboarding or the start of a consequential customer request, the assistant explains: it will gather information and prepare a proposal, then ask the person to review and validate before publication or commitment.

MCP tools return structured missing fields and constraints so the assistant can ask relevant questions instead of restarting a rigid questionnaire. The user may provide several answers in one message, correct earlier answers, or resume a draft after reconnecting.

Normal assistant conversation is the baseline. MCP elicitation may provide structured questions when the connected client supports it, but is not required. relay cannot assume that a particular assistant's proprietary ask-question tool exists.

Prepare and commit are separate operations. A preview returns a persisted proposal ID, revision, expiration, and authoritative summary. The assistant presents that summary and obtains explicit approval before invoking the commit operation for that exact revision. Editing the proposal invalidates earlier approval. Proposals expire after 15 minutes (proposed default); expiry requires a fresh preview and approval.

The server enforces proposal identity, ownership, revision, expiration, validity, and one-time commitment. It cannot independently prove that a generic external assistant truly asked its human: without host-provided confirmation/elicitation, that part is an assistant/host trust boundary. Do not claim cryptographic or independent human consent verification. Passwords, payment credentials, and bearer tokens are never requested in chat.

## Proposed domain model

Keep Fastify, TypeScript, Zod, Mongoose, MongoDB, Astro, and Streamable HTTP MCP. No new frontend framework or embedded chat product.

- **Business:** owner ID, category discriminator, common profile, lifecycle and revision metadata. Distinguish draft/published from any future independent verification status.
- **Business draft:** persistent editable profile and category-specific configuration, including optional audit suggestions with provenance. An owner may manage multiple businesses; operations always identify the target explicitly when ambiguous.
- **Offering:** business ID, kind discriminator, owner-defined description, validated type-specific attributes, prices, publication state and revision. A restaurant profile does not force hotel/shop records to have a cuisine or seat capacity.
- **Inventory/availability:** actual product/variant units, restaurant service-slot seat capacity, or room-type counts by local night. Dates and timezone are explicit. Display availability timestamps; unknown availability is not full capacity.
- **Action proposal:** actor ID, action type, exact proposed payload, affected published revisions, computed summary, revision, expiration and consumption status. Covers publication, orders, bookings, and modifications.
- **Order:** customer ID, business ID, immutable line-item/price snapshot, quantities, pickup details, reference, fulfillment state, and payment state.
- **Reservation:** customer ID, business ID, restaurant/hotel discriminator, offering or slot references, party/guest details, dates/times, reference, revision, and payment state where applicable.
- **Action history:** actor, approved proposal/revision, action result, and timestamps. Business owners can inspect records for their own businesses; customers only their own private records.

Use a bounded schema for each supported kind, not arbitrary owner-defined executable schemas. Retain an extension area only for descriptive metadata; unknown metadata cannot affect price, capacity, or authorization.

## Transaction and availability rules

- Search and preview never guarantee availability or consume inventory.
- Commit rechecks current published offerings, price/terms revisions, and inventory. If the approved terms changed, return a new proposal for approval rather than silently substituting.
- A confirmed demo action is immediately persisted with a stable reference and `paymentStatus: not_collected_demo`; never describe it as paid. Where no payment applies, use a distinct not-applicable state.
- Retries of the same proposal return its original result, not another order or booking.
- Confirmation atomically consumes inventory and records the action. Concurrent clients cannot oversell or overbook.
- Restaurant capacity applies to explicitly configured non-overlapping service slots; the owner declares those slots. Hotel nights use a half-open local-date range: check-in included, check-out excluded. Every night must have sufficient room inventory.
- An amendment is a new proposal referencing the existing reservation revision. On commit, apply the net capacity change and reservation mutation atomically. A failed amendment leaves the original reservation and capacity untouched.
- A stale amendment must not overwrite a newer amendment. Do not implement modifications by cancelling first and hoping the replacement succeeds.
- Existing confirmed records preserve their approved snapshots when offerings are edited or unpublished. Only new commitments must use current published terms.
- Owner availability changes must not erase confirmed allocations or reduce total capacity below existing commitments. Stock replenishment adjusts remaining units explicitly; editing a description must never reset stock. Shared paid extras across multiple offerings are outside this version; fixed-price options belong to a specific sellable variant.
- Proposed implementation constraint: use MongoDB transactions for cross-document commitments; a development/demo replica set or suitable Atlas deployment is therefore required. Do not silently fall back to unsafe multi-write operations on standalone MongoDB.

## MCP surface and identity

Exact tool names/signatures belong in the implementation plan. Group capabilities into:

- Connection/workflow guidance and account pairing.
- Owner draft creation/resumption, draft updates, offering/availability management, audit, publication preview/commit, and private owner record lookup.
- Public business/offer discovery and details across all three categories.
- Authenticated customer proposal creation/preview/commit, private order/reservation lookup, and reservation amendment proposals.

Keep handlers thin and share domain services between tools. Return structured results with stable error codes, required/missing fields, next actions, authoritative totals, and timestamps. Do not expose raw collections or let agents submit arbitrary database queries.

Extend pairing to clients as well as owners. Public browsing can remain anonymous; private lookups and commitments require the correct authenticated principal. Account creation and authentication remain on the trusted website. Add the minimal authenticated pairing-code control to the existing account page; do not ask users to copy their password or JWT into a prompt. Pairing codes are single-use, short-lived, rate-limited, and atomically consumed.

The current caller-supplied `sessionId` override must not authorize operations. Bind identity to the active transport session. Isolate MCP transport instances per connected session: the current singleton transport is not sufficient evidence of safe multi-client operation. Verify two independent owner/client connections and reject unknown/expired sessions. Reconnection can require pairing again; drafts and records remain persistent.

Retain `/mcp` compatibility and use it in both role-specific website prompts initially; the server enforces principal roles rather than implying that two URLs create security. `/sse` and `/messages`, if retained, remain compatibility aliases, not a claim of separate legacy transport support. Restrict status diagnostics so they do not expose linked users/sessions publicly.

Register workflow instructions/prompts that explain onboarding, category selection, preview, and final validation. They assist the agent but never replace server-side validation.

## Website audit and trust

The current audit is restaurant-oriented heuristic HTML analysis. Generalize its output to the supported categories and make fetch failures explicit.

Separate observed evidence, missing/unknown data, and suggested owner answers. Do not default an unknown business to Swiss cuisine, 50 seats, a Basel address, or assumed amenities. An audit suggestion must be confirmed by the owner before publication.

SEO checks and GEO/agent-readiness recommendations are advisory, not guarantees of search ranking, citations, or independently verified facts. Phase 1 can report metadata, structured-data observations, and missing machine-readable offering details without pretending to implement a search engine. Restrict fetches to safe public HTTP(S) targets, validate redirects and resolved addresses, and bound response size/time; prevent internal-network fetching.

Owner-approved data is not independently certified identity. Replace automatic 'trusted/certified' language with an accurate owner-published status; existing records require an explicit compatibility/migration treatment. Never infer that an existing `trusted` flag proves civil identity or current availability.

## Existing code and compatibility

- `code/backend/src/services/mcp.service.ts`: currently registers five restaurant-centric tools, one health resource, owner pairing, and a singleton Streamable HTTP transport.
- `code/backend/src/services/business.service.ts`: direct profile writes immediately mark records trusted; profile saves also overwrite live status. Replace this publishing behavior carefully and preserve live inventory during unrelated profile edits.
- `code/backend/src/models/business.model.ts` and `code/backend/src/schemas/business.schema.ts`: replace mandatory restaurant fields with validated category-specific data. Existing restaurant records remain readable without falsely inventing publication consent or verified inventory.
- `code/backend/src/services/audit.service.ts`: replace unverified fallback facts with unknown/suggested fields and category-aware advisory output.
- `code/backend/src/services/link-token.service.ts` and `code/backend/src/utils/managers/mcp-session.manager.ts`: extend secure pairing and role binding; preserve supported owner use without session-override authorization.
- `code/frontend/src/lib/profiles.ts`: expand both localized prompts from connection-only guidance to the appropriate workflow and the upfront final-validation notice.
- `code/frontend/src/scripts/auth-form.ts` and the shared auth page: minimal pairing-code access after login, not a new business administration website.
- Existing public/auth contracts and tests must remain supported unless a deliberate compatibility change is documented. Existing direct-write MCP tools must not remain an approval bypass; retire or adapt them to the draft/preview contract with clear guidance.

There are already unrelated tracked modifications and untracked files in this worktree, including database-viewer work and existing documents. Do not overwrite, stage, or attribute them to this change.

## Non-goals and anti-goals

- No real card collection, payment provider, refunds, or payment-success simulation presented as real payment.
- No connection to IKEA, hotel booking platforms, POS systems, or real third-party inventory. Furniture is an example of a shop-owned offering, not permission to claim an IKEA integration.
- No delivery logistics, multi-business checkout, complex taxes, hotel dynamic pricing, or restaurant floor-plan optimization.
- Customer cancellation and order amendments are follow-up features; this version demonstrates reservation amendments only. Collect policy text without implying that every policy has an automated workflow.
- No comprehensive visual business dashboard; conversational management is central.
- No promise of automatic MCP installation in every assistant. Detect capabilities and offer manual setup without replacing existing connections or changing configuration without permission.
- No arbitrary MongoDB access, guessed inventory, silent purchases, or publication without final validation.

## Demonstration and acceptance

Prioritize an owner-led demo: connect via the prompt, pair, describe a business, optionally audit its website, answer missing questions, define offerings/availability, inspect the final preview, and approve publication. Then connect a separate customer's assistant, discover that newly published business, prepare an action, validate it, and show the resulting record to both authorized parties.

Use that script for a restaurant, hotel, and shop with concise fixtures; restaurant amendment from 2 to 3 is the explicit modification example. Hotel amendment and shop purchase must also work against owner-published data, not hard-coded success messages.

Required verification in the eventual implementation:

1. Drafts are resumable and invisible to public discovery; no approval means no publication/commit.
2. Each category rejects missing required fields and invalid offerings; hotel/shop do not require restaurant data.
3. Website suggestions remain unconfirmed; fetch failure does not manufacture facts.
4. Unknown/unpublished items, changed prices, insufficient inventory, and unavailable dates are rejected with useful next actions.
5. Repeated commit returns one result; concurrent commitments never exceed stock, slot capacity, or room inventory.
6. Restaurant and hotel amendments preserve the old reservation on failure and reject stale revisions.
7. Independent owner/client sessions cannot cross identities; foreign proposals/records and caller-supplied session overrides are rejected.
8. Owner and customer instructions announce final validation; final summaries match backend prices/terms and clearly distinguish demo confirmation from payment.
9. Test domain rules and actual MCP handshake/tool invocation, not just isolated handler functions. Exercise real MongoDB transactions in integration tests, alongside repository-isolated tests.
10. Existing authentication/database-viewer tests and backend/frontend builds continue to pass. Verify the chosen MCP client manually for connection, prompts, questions, approval, and role isolation.

## Builder discretion and approval request

The builder chooses exact collection layouts, indexes, service decomposition, tool names, fixtures, and compatibility mechanics while preserving these rules. No new platform or frontend framework is needed.

Important proposed defaults for the user to review: broad but limited category support; pickup-only purchases; fixed pricing; explicit restaurant slots; one hotel room per booking; one currency per business; 15-minute proposal expiry; website-based authentication; conversational approval with an explicit external-assistant trust boundary; MongoDB transaction-capable deployment.

After approval, write the implementation plan before changing product code. This document does not claim that any capability described here already exists or has been tested.
