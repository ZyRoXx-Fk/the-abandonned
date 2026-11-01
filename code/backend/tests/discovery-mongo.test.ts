import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { buildMongoHarness } from './helpers/relay-mongo.js';
import { owner, other, profile, offering, services } from './helpers/publication-fixtures.js';
import { DiscoveryService } from '../src/services/discovery.service.js';
import { actionResultSchema } from '../src/schemas/action.schema.js';

// Real raw inserts intentionally bypass Mongoose strict writes to test the read boundary.
test('Atlas discovery: published-only literal queries and explicit public/private projections on secret-bearing raw storage', async t => {
  const storage = await buildMongoHarness(); t.after(() => storage.close());
  const s = services(storage); const discovery = new DiscoveryService(storage.catalog, storage.transactions);
  const db = storage.connection.db!;
  const ids: string[] = [];
  for (const category of ['restaurant', 'hotel', 'shop'] as const) {
    let d = await s.drafts.create(owner, category);
    d = await s.drafts.patch(owner, d.id, d.revision, { profile: { ...profile(category), name: 'Literal [a].* $where', address: 'Road (1)+', categoryConfig: category === 'restaurant' ? { kind: category, cuisine: 'French', amenities: ['wifi', 'parking'] } : { kind: category, amenities: ['wifi', 'parking'] } } });
    d = await s.drafts.putOffering(owner, d.id, d.revision, offering(category));
    if (category === 'shop') d = await s.drafts.putInventory(owner, d.id, d.revision, { kind: 'sellable_variant', id: 'stock', offeringId: 'item', variantId: 'variant', remainingUnits: 0, metadata: [] });
    const p = (await s.publication.preview(owner, d.id)).proposal!;
    await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
    ids.push(d.businessId);
    await db.collection('businesses').updateOne({ relayBusinessId: d.businessId }, { $set: {
      password: 'SECRET_PASSWORD', pairing: { token: 'SECRET_PAIRING' }, clientId: 'SECRET_CLIENT',
      'relayProfile.ownerAccountId': 'SECRET_OWNER', 'relayProfile.contact.bearerToken': 'SECRET_TOKEN',
    } });
    await db.collection('relay_offerings').updateOne({ businessId: d.businessId }, { $set: { 'payload.clientId': 'SECRET_CLIENT' } });
    await db.collection<{ _id: string } & Record<string, unknown>>('relay_inventory').insertOne({
      _id: `unknown_${category}`, businessId: d.businessId, kind: 'sellable_variant', offeringId: 'item', variantId: 'unknown', published: true, updatedAt: d.updatedAt,
    });
    await db.collection('relay_offerings').insertOne({ businessId: d.businessId, offeringId: 'hidden', published: false, payload: { secret: 'SECRET_UNPUBLISHED' } });
    const before = await discovery.getBusiness(d.businessId).catch(error => {
      if (error.issues) t.diagnostic(JSON.stringify(error.issues).slice(0, 4000));
      throw error;
    });
    await s.drafts.create(owner, category, d.businessId);
    assert.deepEqual(await discovery.getBusiness(d.businessId), before);
    assert.equal(before.profile.contact.email, 'owner@example.com');
    assert.deepEqual(before.offerings, [offering(category)]);
    assert.deepEqual(before.supportedActionKinds, category === 'restaurant' ? ['order', 'restaurant_booking'] : category === 'hotel' ? ['hotel_booking'] : ['order']);
    assert.equal(before.availability.length, category === 'shop' ? 1 : 0);
    if (category === 'shop') assert.deepEqual(before.availability[0], { kind: 'sellable_variant', offeringId: 'item', variantId: 'variant', availableUnits: 0, updatedAt: before.updatedAt });
    assert.ok(!/SECRET_|owner_one|owner_two|trustStatus|baseCapacity/.test(JSON.stringify(before)));
  }
  const partial = await s.drafts.create(owner, 'restaurant');
  await db.collection('businesses').insertMany([
    { _id: new Types.ObjectId(), name: 'Legacy trusted', trustStatus: 'trusted', mcpProfile: { baseCapacity: 999 } },
    { _id: new Types.ObjectId(), relayBusinessId: partial.businessId, relayOwnerId: owner.userId, relayCategory: 'restaurant', name: 'Draft only' },
  ]);
  assert.equal(await storage.catalog.getPublished(partial.businessId), null);
  assert.equal((await discovery.search({} as never)).total, 3);
  for (const filters of [{ text: '[a].*' }, { text: '$where' }, { addressText: '(1)+' }, { amenities: ['wifi', 'parking'] }]) assert.equal((await discovery.search(filters as never)).total, 3);
  for (const filters of [{ text: '^.*$' }, { addressText: '.*' }, { amenities: ['wi'] }, { amenities: ['wifi', 'missing'] }]) assert.equal((await discovery.search(filters as never)).total, 0);
  assert.equal((await discovery.search({ category: 'hotel', limit: 1 } as never)).items[0]?.category, 'hotel');
  assert.equal((await discovery.search({ offset: 2, limit: 1 } as never)).items.length, 1);
  assert.equal((await discovery.listOwnerBusinesses(owner)).length, 3);
  assert.deepEqual(await discovery.listOwnerBusinesses(other), []);

  const result = actionResultSchema.parse({ id: 'booking', reference: 'REF_BOOKING', kind: 'restaurant_booking', revision: 0, status: 'confirmed', paymentStatus: 'not_applicable', summary: {
    kind: 'restaurant_booking', businessId: ids[0], slotId: 'slot', slotDate: '2027-01-02', startTime: '18:00', endTime: '20:00', partySize: 2, policies: ['On time'], paymentNotice: 'No payment collected.',
  } });
  const row = { _id: result.id, ownerId: owner.userId, businessId: ids[0], clientId: 'SECRET_CLIENT', proposalId: 'SECRET_PROPOSAL', allocations: [{ key: 'SECRET_ALLOCATION', delta: 2 }], result, createdAt: '2027-01-01T00:00:00.000Z', privateNote: 'SECRET_NOTE' };
  await db.collection<{ _id: string } & Record<string, unknown>>('relay_reservations').insertMany([
    row, { ...row, _id: 'foreign', ownerId: other.userId, proposalId: 'foreign_proposal', result: { ...result, id: 'foreign' } },
    { ...row, _id: 'other_business', businessId: ids[1], proposalId: 'other_proposal', result: { ...result, id: 'other_business' } },
  ]);
  assert.deepEqual(await storage.transactions.listOwnerActions(owner.userId, ids[0]!, 0, 10), [result]);
  assert.deepEqual(await discovery.listOwnerActions(owner, ids[0]!, 0, 10), [result]);
  assert.deepEqual(await discovery.listOwnerActions(owner, ids[0]!, 1, 1), []);
  await assert.rejects(discovery.listOwnerActions(other, ids[0]!, 0, 10), { code: 'FORBIDDEN' });
  await assert.rejects(discovery.listOwnerActions({ role: 'client', userId: owner.userId }, ids[0]!, 0, 10), { code: 'FORBIDDEN' });
  assert.ok(!JSON.stringify(await discovery.search({} as never)).includes('SECRET_'));
});
