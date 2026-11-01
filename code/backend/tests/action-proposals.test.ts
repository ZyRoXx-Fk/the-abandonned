import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionProposalService, priceAction } from '../src/services/action-proposal.service.js';
import { createRelayMemory } from './helpers/relay-memory.js';
import { owner, profile, offering, services } from './helpers/publication-fixtures.js';
import { publicBusinessSchema, type InventoryInput, type PublicBusiness } from '../src/schemas/catalog.schema.js';
import { proposalViewSchema, type CustomerActionInput } from '../src/schemas/action.schema.js';
import type { Principal } from '../src/schemas/relay.schema.js';

const client: Principal = { role: 'client', userId: 'client_one' };
const now = new Date('2027-01-01T00:00:00Z');
const pickupAt = '2027-01-04T09:00:00Z'; // Monday 10:00 Paris
const order = (businessId: string): Extract<CustomerActionInput, { kind: 'order' }> => ({ kind: 'order', businessId, items: [{ offeringId: 'item', variantId: 'variant', quantity: 2 }], pickupAt });
function business(category: 'shop' | 'hotel' | 'restaurant' = 'shop'): PublicBusiness {
  const o = offering(category);
  if (o.kind !== 'room_type') o.variants[0]!.unitPrice.amountMinor = 1250;
  return publicBusinessSchema.parse({ businessId: 'biz', category, revision: 3, profile: profile(category), offerings: [o],
    availability: category === 'hotel' ? ['2027-03-27', '2027-03-28', '2027-10-30', '2027-10-31'].map(localNight => ({ kind: 'room_night', roomTypeId: 'room', localNight, availableRooms: 1, updatedAt: now.toISOString() }))
      : category === 'restaurant' ? [{ kind: 'restaurant_slot', slotId: 'slot', slotDate: '2027-01-04', startTime: '12:00', endTime: '13:00', minPartySize: 2, maxPartySize: 4, availableSeats: 5, updatedAt: now.toISOString() }]
      : [{ kind: 'sellable_variant', offeringId: 'item', variantId: 'variant', availableUnits: 3, updatedAt: now.toISOString() }],
    publishedAt: now.toISOString(), updatedAt: now.toISOString() });
}
async function setup(category: 'shop' | 'hotel' | 'restaurant' = 'shop', inventory?: InventoryInput[]) {
  const storage = createRelayMemory(); const s = services(storage);
  let d = await s.drafts.create(owner, category);
  d = await s.drafts.patch(owner, d.id, d.revision, { profile: profile(category) });
  const o = business(category).offerings[0]!;
  d = await s.drafts.putOffering(owner, d.id, d.revision, o);
  for (const i of inventory ?? (category === 'shop' ? [{ kind: 'sellable_variant', id: 'stock', offeringId: 'item', variantId: 'variant', remainingUnits: 3, metadata: [] }] : [])) d = await s.drafts.putInventory(owner, d.id, d.revision, i);
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
  let clockReads = 0;
  const service = new ActionProposalService(storage.catalog, storage.proposals, () => { clockReads++; return now; });
  return { storage, service, s, businessId: d.businessId, clockReads: () => clockReads };
}
const invalid = (fn: () => unknown, code = 'VALIDATION_ERROR') => assert.throws(fn, { code });

test('priceAction resolves server prices, complete terms and explicit approval/demo notice without wall clock', () => {
  const b = business(); const summary = priceAction(b, order(b.businessId));
  assert.equal(summary.kind, 'order');
  if (summary.kind !== 'order') return;
  assert.equal(summary.totalPrice.amountMinor, 2500);
  assert.deepEqual(summary.items[0], { offeringId: 'item', variantId: 'variant', name: 'Standard', quantity: 2, unitPrice: { amountMinor: 1250, currency: 'EUR' }, lineTotal: { amountMinor: 2500, currency: 'EUR' } });
  assert.equal(summary.chargeDescription, b.profile.finalPriceDescription);
  assert.deepEqual(summary.policies, b.profile.policies);
  assert.match(summary.paymentNotice, /demo/i); assert.match(summary.paymentNotice, /approval/i); assert.match(summary.paymentNotice, /not collected/i);
  assert.equal(priceAction(b, { ...order('biz'), pickupAt: '2020-01-06T09:00:00Z' }).kind, 'order'); // pure; service applies now
});

test('hotel uses half-open calendar nights across spring and autumn DST, never checkout inventory', () => {
  for (const [checkIn, checkOut, nights] of [['2027-03-27', '2027-03-29', ['2027-03-27', '2027-03-28']], ['2027-10-30', '2027-11-01', ['2027-10-30', '2027-10-31']]] as const) {
    const b = business('hotel');
    const s = priceAction(b, { kind: 'hotel_booking', businessId: 'biz', roomTypeId: 'room', checkIn, checkOut, guests: 2 });
    assert.equal(s.kind, 'hotel_booking'); if (s.kind !== 'hotel_booking') return;
    assert.deepEqual(s.nights, nights); assert.equal(s.totalPrice.amountMinor, 20000);
  }
});

test('strict runtime inputs reject injected money/identity/session/unknown fields and malformed counts/times', () => {
  const b = business(); const good = order('biz');
  for (const extra of [{ totalPrice: 1 }, { price: 1 }, { clientId: 'other' }, { sessionId: 'foreign' }, { principal: client }, { discount: 10 }]) invalid(() => priceAction(b, { ...good, ...extra } as CustomerActionInput));
  if (good.kind !== 'order') return;
  for (const quantity of [0, -1, 0.5, 1001, NaN, Infinity]) invalid(() => priceAction(b, { ...good, items: [{ ...good.items[0]!, quantity }] }));
  for (const pickupAt of ['bad', '2027-01-04T10:00:00', '2027-02-30T10:00:00Z']) invalid(() => priceAction(b, { ...good, pickupAt }));
  invalid(() => priceAction(b, { ...good, items: [{ ...good.items[0]!, unitPrice: 1 }] } as unknown as CustomerActionInput));
  invalid(() => priceAction(b, { ...good, items: [] }));
});

test('offering/variant resolution is business scoped, active and category correct; unknown/zero stock is unavailable', () => {
  const b = business(); const good = order('biz');
  invalid(() => priceAction(b, order('foreign')));
  if (good.kind !== 'order') return;
  for (const item of [{ offeringId: 'missing', variantId: 'variant', quantity: 1 }, { offeringId: 'item', variantId: 'missing', quantity: 1 }]) invalid(() => priceAction(b, { ...good, items: [item] }));
  b.offerings[0]!.active = false; invalid(() => priceAction(b, good), 'UNAVAILABLE');
  b.offerings[0]!.active = true;
  for (const availability of [[], [{ ...b.availability[0]!, availableUnits: 0 }]]) invalid(() => priceAction({ ...b, availability } as PublicBusiness, good), 'UNAVAILABLE');
  invalid(() => priceAction(business('hotel'), good));
  invalid(() => priceAction(b, { kind: 'restaurant_booking', businessId: 'biz', slotId: 'slot', partySize: 2 }));
});

test('reject duplicate line keys rather than allowing aggregate demand to bypass stock; checked multiply/sum and one currency', () => {
  const b = business(); const input = order('biz'); if (input.kind !== 'order') return;
  invalid(() => priceAction(b, { ...input, items: [input.items[0]!, input.items[0]!] }));
  const o = b.offerings[0]!; if (o.kind === 'room_type') return;
  o.variants[0]!.unitPrice.amountMinor = Number.MAX_SAFE_INTEGER;
  invalid(() => priceAction(b, input));
  o.variants.push({ ...o.variants[0]!, id: 'second' });
  b.availability.push({ kind: 'sellable_variant', offeringId: 'item', variantId: 'second', availableUnits: 3, updatedAt: now.toISOString() });
  invalid(() => priceAction(b, { ...input, items: ['variant', 'second'].map(variantId => ({ offeringId: 'item', variantId, quantity: 1 })) }));
  o.variants[0]!.unitPrice = { amountMinor: 1250, currency: 'USD' }; invalid(() => priceAction(b, input));
});

test('restaurant exact slot/party/policy details without fabricated fees', () => {
  const b = business('restaurant'); b.profile.categoryConfig = { kind: 'restaurant', cuisine: 'French', amenities: [], reservationPolicy: 'Arrive on time' };
  const input: CustomerActionInput = { kind: 'restaurant_booking', businessId: 'biz', slotId: 'slot', partySize: 3 };
  const s = priceAction(b, input);
  assert.deepEqual(s, { ...input, slotDate: '2027-01-04', startTime: '12:00', endTime: '13:00', policies: ['Pickup only', 'Arrive on time'], paymentNotice: 'Human approval is required before confirmation. Free table booking; no payment is applicable (demo).' });
  for (const partySize of [1, 6, 101, 1.5]) invalid(() => priceAction(b, { ...input, partySize }));
  invalid(() => priceAction(b, { ...input, slotId: 'missing' }), 'UNAVAILABLE');
  const slot = b.availability[0]!; if (slot.kind !== 'restaurant_slot') return;
  slot.availableSeats = 2; invalid(() => priceAction(b, input), 'UNAVAILABLE');
});

test('hotel rejects impossible/reversed/over60/wide ranges, wrong room, guests, unknown night, exhausted rooms and overflow', () => {
  const b = business('hotel'); const input: CustomerActionInput = { kind: 'hotel_booking', businessId: 'biz', roomTypeId: 'room', checkIn: '2027-03-27', checkOut: '2027-03-29', guests: 2 };
  for (const patch of [{ checkIn: '2027-02-30' }, { checkOut: '2027-03-27' }, { checkOut: '2027-03-26' }, { checkOut: '9999-12-31' }, { checkOut: '2027-05-27' }, { guests: 3 }, { guests: 0 }, { guests: 1.5 }, { roomTypeId: 'foreign' }]) invalid(() => priceAction(b, { ...input, ...patch }));
  invalid(() => priceAction({ ...b, availability: b.availability.slice(1) }, input), 'UNAVAILABLE');
  const night = b.availability[0]!; if (night.kind !== 'room_night') return;
  night.availableRooms = 0; invalid(() => priceAction(b, input), 'UNAVAILABLE'); night.availableRooms = 1;
  const room = b.offerings[0]!; if (room.kind !== 'room_type') return;
  room.nightlyRate.amountMinor = Number.MAX_SAFE_INTEGER; invalid(() => priceAction(b, input));
});

test('prepare persists pending proposal only, snapshots real normalized revisions, expires exactly 15m and never reserves', async () => {
  const { storage, service, businessId, clockReads } = await setup();
  const before = storage.inspect();
  const p = await service.prepare(client, order(businessId));
  await service.prepare(client, order(businessId)); // both demand 2 of 3: no reservation
  const after = storage.inspect();
  assert.equal(p.expiresAt, '2027-01-01T00:15:00.000Z'); assert.equal(clockReads(), 2);
  assert.equal(p.state, 'pending'); assert.equal(p.revision, 0);
  assert.equal(p.termsRevision.businessRevision, 1); assert.deepEqual(p.termsRevision.offeringRevisions, []);
  assert.deepEqual(p.termsRevision.inventoryRevisions, before.inventory.map(i => ({ key: i.key, revision: i.revision })));
  assert.deepEqual(after.inventory, before.inventory); assert.deepEqual(after.actions, before.actions); assert.deepEqual(after.events, before.events); assert.deepEqual(after.results, before.results);
  assert.equal(after.proposals.length, before.proposals.length + 2);
  assert.deepEqual(await service.get(client, p.id), p);
  assert.ok(!('principal' in p)); assert.ok(!('durableResultRef' in p));
});

test('service trusts normalized inventory not discovery projection; missing actual rows never become stock', async () => {
  const { storage, service, businessId } = await setup('shop', []);
  const original = storage.catalog.getPublished;
  storage.catalog.getPublished = async id => { const b = await original(id); return b ? { ...b, availability: business().availability } : null; };
  await assert.rejects(service.prepare(client, order(businessId)), { code: 'UNAVAILABLE' });
  assert.equal(storage.inspect().proposals.filter(p => p.kind === 'order').length, 0);
});

test('pickup must be future and inside BOTH local opening and service hours (end exclusive, timezone-aware)', async () => {
  const { service, businessId } = await setup(); const input = order(businessId);
  await service.prepare(client, input);
  for (const pickupAt of ['2026-12-28T09:00:00Z', now.toISOString(), '2027-01-04T07:59:00Z', '2027-01-04T17:00:00Z', '2027-01-05T09:00:00Z']) await assert.rejects(service.prepare(client, { ...input, pickupAt } as CustomerActionInput), { code: 'VALIDATION_ERROR' });
  await assert.rejects(service.prepare(client, order('unpublished')), { code: 'NOT_FOUND' });
});

test('private get isolates identity and customer kinds, non-client access uses domain auth errors', async () => {
  const { storage, service, businessId } = await setup(); const p = await service.prepare(client, order(businessId));
  for (const principal of [undefined, null, { role: 'public' }, { role: 'client' }]) {
    await assert.rejects(service.prepare(principal as Principal, order(businessId)), { code: 'AUTH_REQUIRED' });
    await assert.rejects(service.get(principal as Principal, p.id), { code: 'AUTH_REQUIRED' });
  }
  await assert.rejects(service.prepare(owner, order(businessId)), { code: 'FORBIDDEN' });
  await assert.rejects(service.get(owner, p.id), { code: 'FORBIDDEN' });
  await assert.rejects(service.get({ ...client, userId: 'other' }, p.id), { code: 'FORBIDDEN' });
  await assert.rejects(service.get(client, 'missing'), { code: 'NOT_FOUND' });
  const publication = storage.inspect().proposals.find(p => p.kind === 'publication')!;
  await assert.rejects(service.get(client, publication.id), { code: 'FORBIDDEN' });
  await storage.proposals.insert({ ...publication, id: 'wrong_kind', principal: client });
  await assert.rejects(service.get(client, 'wrong_kind'), { code: 'FORBIDDEN' });
});

test('service hotel nights and restaurant dates/party are authoritative and future in local timezone', async () => {
  const h = await setup('hotel', ['2027-03-27', '2027-03-28'].map(localNight => ({ kind: 'room_night', id: `n_${localNight}`, roomTypeId: 'room', localNight, totalRooms: 1, metadata: [] })));
  const p = await h.service.prepare(client, { kind: 'hotel_booking', businessId: h.businessId, roomTypeId: 'room', checkIn: '2027-03-27', checkOut: '2027-03-29', guests: 2 });
  assert.equal(p.termsRevision.inventoryRevisions.length, 2);
  const r = await setup('restaurant', [{ kind: 'restaurant_slot', id: 'slot', slotDate: '2027-01-04', startTime: '12:00', endTime: '13:00', totalSeats: 5, minPartySize: 2, maxPartySize: 4, metadata: [] }]);
  await r.service.prepare(client, { kind: 'restaurant_booking', businessId: r.businessId, slotId: 'slot', partySize: 2 });
  const past = new ActionProposalService(r.storage.catalog, r.storage.proposals, () => new Date('2027-01-04T11:00:00Z'));
  await assert.rejects(past.prepare(client, { kind: 'restaurant_booking', businessId: r.businessId, slotId: 'slot', partySize: 2 }), { code: 'VALIDATION_ERROR' });
  const hotelPast = new ActionProposalService(h.storage.catalog, h.storage.proposals, () => new Date('2027-03-28T00:00:00Z'));
  await assert.rejects(hotelPast.prepare(client, { kind: 'hotel_booking', businessId: h.businessId, roomTypeId: 'room', checkIn: '2027-03-27', checkOut: '2027-03-29', guests: 2 }), { code: 'VALIDATION_ERROR' });
});

test('all 20 common restaurant policies plus reservation policy survive preparation and amendment summary schema', async () => {
  const { service, s, businessId } = await setup('restaurant', [{ kind: 'restaurant_slot', id: 'slot', slotDate: '2027-01-04', startTime: '12:00', endTime: '13:00', totalSeats: 5, minPartySize: 2, maxPartySize: 4, metadata: [] }]);
  let d = await s.drafts.create(owner, 'restaurant', businessId);
  const policies = Array.from({ length: 20 }, (_, i) => `Exact policy ${i}`);
  d = await s.drafts.patch(owner, d.id, d.revision, { profile: { policies, categoryConfig: { kind: 'restaurant', cuisine: 'French', reservationPolicy: 'Exact reservation policy' } } });
  const pub = (await s.publication.preview(owner, d.id)).proposal!;
  await s.publication.commit(owner, { proposalId: pub.id, revision: pub.revision, approved: true });
  const p = await service.prepare(client, { kind: 'restaurant_booking', businessId, slotId: 'slot', partySize: 2 });
  assert.equal(p.summary.kind, 'restaurant_booking');
  if (p.summary.kind !== 'restaurant_booking') return;
  assert.deepEqual(p.summary.policies, [...policies, 'Exact reservation policy']);
  const amendment = { ...p, kind: 'reservation_amendment', payload: { kind: 'reservation_amendment', amendment: { kind: 'restaurant_booking', reservationId: 'reservation', expectedReservationRevision: 0, slotId: 'slot', partySize: 2 } }, summary: { kind: 'reservation_amendment', summary: { ...p.summary, reservationId: 'reservation', expectedReservationRevision: 0 } } };
  assert.equal(proposalViewSchema.safeParse(amendment).success, true);
  assert.equal(proposalViewSchema.safeParse({ ...p, summary: { ...p.summary, policies: [...p.summary.policies, '22nd'] } }).success, false);
  amendment.summary.summary.policies.push('22nd');
  assert.equal(proposalViewSchema.safeParse(amendment).success, false);
});

test('60 nights accepted, 61 rejected before enumeration; exact variant name is never truncated', () => {
  const b = business('hotel');
  const nights = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2027, 0, i + 1)).toISOString().slice(0, 10));
  b.availability = nights.map(localNight => ({ kind: 'room_night', roomTypeId: 'room', localNight, availableRooms: 1, updatedAt: now.toISOString() }));
  const input: CustomerActionInput = { kind: 'hotel_booking', businessId: 'biz', roomTypeId: 'room', guests: 2, checkIn: '2027-01-01', checkOut: '2027-03-02' };
  const p = priceAction(b, input); assert.equal(p.kind, 'hotel_booking');
  if (p.kind === 'hotel_booking') assert.equal(p.nights.length, 60);
  invalid(() => priceAction(b, { ...input, checkOut: '2027-03-03' }));
  const shop = business(); const o = shop.offerings[0]!; if (o.kind === 'room_type') return;
  o.variants[0]!.name = 'x'.repeat(120);
  const summary = priceAction(shop, order('biz'));
  if (summary.kind === 'order') assert.equal(summary.items[0]!.name, 'x'.repeat(120));
});

test('service rejects runtime injection and withdrawn offerings even with retained live inventory', async () => {
  const { storage, service, s, businessId } = await setup();
  await assert.rejects(service.prepare(client, { ...order(businessId), totalPrice: 1 } as unknown as CustomerActionInput), { code: 'VALIDATION_ERROR' });
  let d = await s.drafts.create(owner, 'shop', businessId);
  d = await s.drafts.putOffering(owner, d.id, d.revision, { ...business().offerings[0]!, active: false });
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
  const before = storage.inspect();
  await assert.rejects(service.prepare(client, order(businessId)), { code: 'UNAVAILABLE' });
  assert.deepEqual(storage.inspect(), before);
});

test('prepare observes consumed inventory revision, never stale public quantities', async () => {
  const { storage, service, businessId } = await setup();
  const before = await storage.catalog.getPublished(businessId);
  const key = storage.inspect().inventory[0]!.key;
  await storage.uow.run(tx => storage.catalog.applyAllocations([{ key, delta: 2 }], tx));
  storage.catalog.getPublished = async () => before; // deliberately stale projection
  await assert.rejects(service.prepare(client, order(businessId)), { code: 'UNAVAILABLE' });
  const input = order(businessId); if (input.kind !== 'order') return;
  const p = await service.prepare(client, { ...input, items: [{ ...input.items[0]!, quantity: 1 }] });
  assert.deepEqual(p.termsRevision.inventoryRevisions, [{ key, revision: 1 }]);
  const remaining = storage.inspect().inventory[0]!;
  assert.equal(remaining.kind === 'sellable_variant' && remaining.remainingUnits, 1);
});

test('pickup checks opening and service independently, summer timezone offset, inclusive start/exclusive end', async () => {
  const { storage, service, businessId } = await setup();
  const original = storage.catalog.getPublished;
  storage.catalog.getPublished = async id => { const b = await original(id); if (b) b.profile.serviceHours[0]!.startTime = '11:00'; return b; };
  await assert.rejects(service.prepare(client, order(businessId)), { code: 'VALIDATION_ERROR' }); // open but no service
  await service.prepare(client, { ...order(businessId), pickupAt: '2027-01-04T10:00:00Z' } as CustomerActionInput);
  storage.catalog.getPublished = async id => { const b = await original(id); if (b) { b.profile.openingHours[0]!.intervals[0]!.endTime = '12:00'; } return b; };
  await assert.rejects(service.prepare(client, { ...order(businessId), pickupAt: '2027-01-04T11:00:00Z' } as CustomerActionInput), { code: 'VALIDATION_ERROR' }); // service but closed
  storage.catalog.getPublished = original;
  await service.prepare(client, { ...order(businessId), pickupAt: '2027-07-05T07:00:00Z' } as CustomerActionInput); // 09:00 CEST
  await assert.rejects(service.prepare(client, { ...order(businessId), pickupAt: '2027-07-05T06:59:00Z' } as CustomerActionInput), { code: 'VALIDATION_ERROR' });
});
