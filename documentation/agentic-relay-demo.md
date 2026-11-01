# Rehearsal: owner first, then a customer

**All businesses below are fictional test fixtures. No real hotel, IKEA, retailer, payment, delivery or civil certification integration exists.** Tell each human at the start: “You will need to validate the final request before I publish or confirm it.” Do not collect passwords/payment credentials in chat. Owner onboarding and final human validation come first, customer actions only prove the newly published offerings work.

## Exact automated fixture

`code/backend/tests/integration/relay-demo.test.ts` runs the ACTUAL `buildApp` and default mongoose-backed repositories on loopback HTTP with real SDK clients, not memory service composition. It explicitly connects the global mongoose connection to a newly generated MongoDB8 `relay_test_*` database (max38 bytes); importing the app runs no production startup in `NODE_ENV=test`. It creates separate owner and client accounts via real auth HTTP routes, uses their distinct HttpOnly session cookies on protected pairing routes, then binds two separate live MCP transports. No published business/catalog is secretly inserted. SDK sessions, HTTP app, generated DB and mongoose connection are closed/dropped in teardown. Account credentials/codes/URIs are not printed.

All three profiles: names `Fictional Relay restaurant`, `Fictional Relay hotel`, `Fictional Relay shop`; address `1 Main Street`; description `Owner supplied description`; contact `owner@example.com`; currency EUR; timezone **Europe/Paris**. Opening Monday 09:00–18:00; service `service`, Monday 09:00–18:00. Final price description `All taxes included`; policy `Pickup only` (including this deliberately simple hotel fixture). Restaurant cuisine French. IDs are business-local:

| Category | Exact offering | Exact known inventory |
| --- | --- | --- |
| restaurant | menu_item `item`, name Item; variant `variant`, Standard, **1000 EUR minor = EUR10.00** | sellable stock `stock`, 4 units; slot `slot`, **2027-01-04 12:00–14:00 Paris local**, 4 total seats, min party1/max4 |
| hotel | room_type `room`, Double, max2 guests, **10000 EUR minor = EUR100.00/night** | room nights `night0` 2027-01-04 and `night1` 2027-01-05, 1 room each; no other known nights |
| shop | product `item`, Item; variant `variant`, Standard, **1000 EUR minor = EUR10.00** | stock `stock`, 4 units |

Pickup is **2027-01-04T10:00:00Z = Monday11:00 Paris local** (UTC+1). Restaurant slot12:00–14:00 local is11:00–13:00Z. Hotel stays use local dates, no UTC-midnight conversion: Jan4→Jan5 is one night; amendment Jan5→Jan6 is one night. Jan6 inventory is unknown and cannot be booked as available. These are fixed rehearsal dates, not claims of currently available real inventory. If running after their service dates, create freshly reviewed future fixtures and record the exact replacement dates rather than silently changing this evidence.

## Owner walkthrough (repeat for each category)

1. Human creates/logs into the Business account on the trusted site. Generate a pairing code explicitly. Connect the assistant to the configured MCP endpoint; `link_session({token})`. Do not copy code into screenshots/logs. Discover `owner_onboarding` and `relay://workflow`.
2. `create_business_draft({category})`. Save returned draft/business IDs. Before publication, customer `get_business` must refuse; another account cannot read the private draft.
3. `update_business_draft({draftId,expectedRevision,patch:{profile:…}})` with the exact common profile/category above. `put_business_offering` with the listed offering. `put_business_inventory` for **each** listed row. Always use the latest returned revision. Missing capacity must remain unknown; do not invent it.
4. `preview_business_publication({draftId})`: explain missing fields, price/charge/policy details and inventory. Ask the human to review the full proposed request. If changed, edit and preview again.
5. Only after explicit final validation: `publish_business({proposalId,revision,approved:true})`. Save proof from `list_my_businesses` and customer `get_business({businessId})`: now published, correct category/price/inventory, no private owner account details. Preview alone must not publish.

## Customer proof and safe failure

Use a separate authenticated Client account and separate live transport. Discover `customer_assistance`; explain final human validation upfront.

- For each category try an invented `offeringId:'invented', variantId:'bad'` order: refusal, no record/inventory mutation. Never substitute a guessed item.
- Restaurant pickup: `prepare_customer_action({kind:'order',businessId,items:[{offeringId:'item',variantId:'variant',quantity:1}],pickupAt:'2027-01-04T10:00:00Z'})`. Inspect server total1000 EUR minor and pickup/policy, ask final approval, then `confirm_customer_action({proposalId,revision,approved:true})`. Result is confirmed **unpaid demo**, `not_collected_demo`.
- Restaurant table: prepare `restaurant_booking` for slot `slot`, party2; approve/confirm. Then `prepare_reservation_amendment({kind:'restaurant_booking',reservationId,expectedReservationRevision,slotId:'slot',partySize:3})`; review full changed snapshot, approve/confirm: revision advances, party3, `not_applicable` payment. Confirm a separate party1 booking to fill the fourth seat. Attempt amendment of the party3 booking to party4: `UNAVAILABLE`. Read `get_my_action({id})` and verify it equals the original party3 result including revision; original allocation remains. Existing storage/race suites additionally exercise commit-time rollback and concurrent capacity races.
- Hotel: prepare `hotel_booking` with room `room`, Jan4→Jan5, guests2. Server total10000 EUR minor, one night. Review/approve/confirm, `not_collected_demo`. Prepare amendment to Jan5→Jan6, same room/guests2; fresh validation/approval and confirmation. Attempt Jan5→Jan7 (Jan6 inventory unknown): `UNAVAILABLE`; readback must be byte-for-byte equivalent to the prior confirmed result, no silent date change or release of old room allocation.
- Shop: prepare order for `item`/`variant`, quantity1, same UTC pickup. Review total1000 EUR minor, approve/confirm, `not_collected_demo`. No real vendor or payment API is contacted.
- Owner `list_business_actions({businessId})` privately finds each safe result/reference, including the amended reservation; client cannot call the owner lookup. `get_my_action` is client-scoped. Owner readback does not expose customer identity or stored allocation internals. SDK-native malformed-input errors and safe handler/domain error envelopes differ: see [operations](agentic-relay.md).

Lost-response retry: resubmit the **same approved proposal**; expect the identical durable result, no duplicate sale. Do not prepare an extra action to recover a lost response. Failed amendments preserve old records/capacity. Do not implement cleanup by cancellation: cancellation is outside scope.

## Running and cleaning the local rehearsal

Use only a new disposable MongoDB8 replica-set database with explicit `TEST_MONGODB_URI`, test-only JWT configuration, `NODE_ENV=test`. Run from backend: `NODE_ENV=test pnpm exec tsx --test tests/integration/relay-demo.test.ts` (or `NODE_ENV=test node --import tsx --test tests/integration/relay-demo.test.ts`). Never point global mongoose at the original configured DB. The fixture supplies its own random JWT secret; no real accounts are used. Full verification commands and migration backup/default-dry-run/explicit-apply/rollback guidance are in [operations](agentic-relay.md).

The test terminates both MCP sessions, closes clients/app, waits for model initialization, drops its generated DB and disconnects global mongoose. Harness tests drop their generated DBs separately. The validation runner checks its own generated prefix for leftovers and drops only matching generated names, closes its administration connection, removes its mode0600 scoped env, stops standalone native Mongo, deletes dbpaths and downloaded binary/archive/scratch. Do not retain cookies/codes/proposals/private records in screenshots; inspect captured logs for URI/credential or private projection leakage. No migration is executed on existing application data during rehearsal, even dry run.

## External chosen-assistant release checklist — NOT RUN

There is no provisioned hosted HTTPS endpoint or selected assistant. This is an **external release blocker**, not a failed internal SDK bridge and not a passed SDK surrogate. Do not deploy/expose a local service or use real accounts without separate authorization. Once the operator provisions the endpoint and selects an assistant, record assistant/version/date and:

- [ ] Configure same-site HTTPS, trusted website auth, public secret-free installation prompts and correct MCP URL.
- [ ] Verify actual assistant supports Streamable HTTP, prompts/resources, tool error shapes and reconnect/session cleanup.
- [ ] Use separate disposable owner/client identities; generate codes explicitly and pair each intended role. Test wrong-role/private lookup refusal and expired/replaced codes.
- [ ] Confirm assistant explains final human validation **before** onboarding/actions, displays authoritative prices/dates/demo payment wording, and does not silently assert `approved:true`. Record host-consent boundary acceptance.
- [ ] Perform all owner publication and customer steps above, with published proof, invalid-item refusal, failed amendment unchanged and private owner readback; verify no real payment/certification claims.
- [ ] Exercise lost-response retry and disconnect/reconnect without identity transfer.
- [ ] Check browser logout/account switch/expiry/BFcache on selected browsers and keyboard/screen-reader flow; mock browser evidence alone is not accessibility certification or a real hosted cookie roundtrip.
- [ ] Inspect sanitized logs/projections, terminate sessions, remove only the generated demo data/accounts, revoke temporary codes and confirm process/DB cleanup. Record pass/failure evidence without secrets.
