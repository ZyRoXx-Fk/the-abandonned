import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscoveryService } from '../src/services/discovery.service.js';
import { createRelayMemory } from './helpers/relay-memory.js';
import { owner, other, profile, offering, services } from './helpers/publication-fixtures.js';
import type { BusinessQuery } from '../src/schemas/catalog.schema.js';

const query = (value: Partial<BusinessQuery> = {}): BusinessQuery => ({ offset: 0, limit: 10, amenities: [], ...value });

test('discovery publishes all categories with fixed prices, capabilities and truthful unknown/zero freshness', async () => {
  const storage = createRelayMemory(); const s = services(storage);
  const discovery = new DiscoveryService(storage.catalog, storage.transactions);
  for (const category of ['restaurant', 'hotel', 'shop'] as const) {
    let d = await s.drafts.create(owner, category);
    d = await s.drafts.patch(owner, d.id, d.revision, { profile: profile(category) });
    d = await s.drafts.putOffering(owner, d.id, d.revision, offering(category));
    if (category === 'shop') d = await s.drafts.putInventory(owner, d.id, d.revision, {
      kind: 'sellable_variant', id: 'stock', offeringId: 'item', variantId: 'variant', remainingUnits: 0, metadata: [],
    });
    const p = (await s.publication.preview(owner, d.id)).proposal!;
    await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
    const published = await discovery.getBusiness(d.businessId);
    assert.deepEqual(published.supportedActionKinds, category === 'restaurant' ? ['order', 'restaurant_booking'] : category === 'hotel' ? ['hotel_booking'] : ['order']);
    assert.deepEqual(published.offerings, [offering(category)]);
    assert.equal(published.profile.contact.email, 'owner@example.com');
    assert.equal(published.updatedAt, '2027-01-01T00:00:00.000Z');
    if (category === 'shop') assert.deepEqual(published.availability, [{ kind: 'sellable_variant', offeringId: 'item', variantId: 'variant', availableUnits: 0, updatedAt: published.updatedAt }]);
    else assert.deepEqual(published.availability, []);
    await s.drafts.create(owner, category, d.businessId); // incomplete edit must not shadow publication
    assert.deepEqual(await discovery.getBusiness(d.businessId), published);
    assert.ok(!/owner_one|clientId|pairing|trustStatus|baseCapacity/.test(JSON.stringify(published)));
  }
  await s.drafts.create(owner, 'hotel');
  const page = await discovery.search(query());
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 3);
  assert.deepEqual(page.items.find(i => i.category === 'hotel')?.supportedActionKinds, ['hotel_booking']);
  assert.equal((await discovery.listOwnerBusinesses(owner)).length, 3);
  assert.deepEqual(await discovery.listOwnerBusinesses(other), []);
  await assert.rejects(discovery.getBusiness('absent'), { code: 'NOT_FOUND' });
});

test('literal text/address and exact amenities; runtime pagination rejects injection and out of range', async () => {
  const storage = createRelayMemory(); const s = services(storage);
  const discovery = new DiscoveryService(storage.catalog, storage.transactions);
  let d = await s.drafts.create(owner, 'shop');
  d = await s.drafts.patch(owner, d.id, d.revision, { profile: { ...profile('shop'), name: 'Shop [a].* $where', address: 'Road (1)+', categoryConfig: { kind: 'shop', amenities: ['wifi', 'parking'] } } });
  d = await s.drafts.putOffering(owner, d.id, d.revision, offering('shop'));
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
  for (const filters of [{ text: '[a].*' }, { text: '$where' }, { addressText: '(1)+' }, { amenities: ['wifi', 'parking'] }]) assert.equal((await discovery.search(query(filters))).total, 1);
  for (const filters of [{ text: '^.*$' }, { addressText: '.*' }, { amenities: ['wi'] }, { amenities: ['wifi', 'missing'] }]) assert.equal((await discovery.search(query(filters))).total, 0);
  assert.equal((await discovery.search(query({ offset: 1, limit: 1 }))).items.length, 0);
  assert.equal((await discovery.search({} as BusinessQuery)).limit, 10);
  for (const filters of [{ offset: -1 }, { offset: 0.1 }, { limit: 0 }, { limit: 51 }, { limit: NaN }, { text: { $ne: '' } }, { amenities: [{ $ne: '' }] }]) await assert.rejects(discovery.search(query(filters as never)));
  for (const [offset, limit] of [[-1, 10], [0, 51], [0, 0], [0.5, 10], [Number.MAX_SAFE_INTEGER + 1, 10]]) await assert.rejects(discovery.listOwnerActions(owner, d.businessId, offset, limit));
  await assert.rejects(discovery.listOwnerBusinesses({ role: 'client', userId: owner.userId }), { code: 'FORBIDDEN' });
  await assert.rejects(discovery.listOwnerBusinesses({ ...owner, sessionId: 'foreign' } as never));
  await assert.rejects(discovery.listOwnerActions({ role: 'client', userId: owner.userId }, d.businessId, 0, 10), { code: 'FORBIDDEN' });
  await assert.rejects(discovery.listOwnerActions(other, d.businessId, 0, 10), { code: 'FORBIDDEN' });
  assert.deepEqual(await discovery.listOwnerActions(owner, d.businessId, 0, 10), []);
});

test('owner action read port returns only the scoped result, never client/storage data', async () => {
  const result = { id: 'booking', reference: 'REF_BOOKING', kind: 'restaurant_booking' as const, revision: 0, status: 'confirmed' as const, paymentStatus: 'not_applicable' as const, summary: {
    kind: 'restaurant_booking' as const, businessId: 'relay_2', slotId: 'slot', slotDate: '2027-01-02', startTime: '18:00', endTime: '20:00', partySize: 2, policies: ['On time'], paymentNotice: 'No payment collected.',
  } };
  const storage = createRelayMemory([
    { ownerId: owner.userId, businessId: result.summary.businessId, createdAt: '2027-01-01T00:00:00.000Z', result },
    { ownerId: other.userId, businessId: result.summary.businessId, createdAt: '2027-01-01T00:00:00.000Z', result: { ...result, id: 'foreign' } },
  ]);
  const s = services(storage); let d = await s.drafts.create(owner, 'restaurant');
  assert.equal(d.businessId, result.summary.businessId);
  d = await s.drafts.patch(owner, d.id, d.revision, { profile: profile('restaurant') });
  d = await s.drafts.putOffering(owner, d.id, d.revision, offering('restaurant'));
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
  const discovery = new DiscoveryService(storage.catalog, storage.transactions);
  assert.deepEqual(await discovery.listOwnerActions(owner, d.businessId, 0, 10), [result]);
  assert.deepEqual(await discovery.listOwnerActions(owner, d.businessId, 1, 1), []);
  await assert.rejects(discovery.listOwnerActions(other, d.businessId, 0, 10), { code: 'FORBIDDEN' });
});
