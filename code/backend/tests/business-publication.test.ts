import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayMemory } from './helpers/relay-memory.js';
import { owner, other, profile, offering, services } from './helpers/publication-fixtures.js';

test('partial restaurant asks specific questions, persists and resumes only for its owner', async () => {
  const storage = createRelayMemory();
  const s = services(storage);
  const d = await s.drafts.create(owner, 'restaurant');
  const p = await s.publication.preview(owner, d.id);
  assert.equal(p.proposal, null);
  assert.ok(p.missingFields.some(f => f.path === 'profile.categoryConfig.cuisine'));
  assert.ok(p.missingFields.some(f => f.path === 'profile.name' && f.question.includes('name')));
  const reconnected = services(storage);
  assert.equal((await reconnected.drafts.list(owner, 0, 10))[0]?.id, d.id);
  assert.equal((await reconnected.drafts.get(owner, d.id)).revision, d.revision);
  assert.deepEqual(await s.drafts.list(other, 0, 10), []);
  await assert.rejects(s.drafts.get(other, d.id));
  await assert.rejects(s.publication.preview(other, d.id));
  await assert.rejects(s.drafts.patch(owner, d.id, 0, { ownerId: other.userId } as never));
});
for (const category of ['hotel', 'shop'] as const) {
  test(`${category} complete without restaurant fields; approval, expiry and durable retries`, async () => {
    const storage = createRelayMemory(); const s = services(storage);
    let d = await s.drafts.create(owner, category);
    d = await s.drafts.patch(owner, d.id, d.revision, { profile: profile(category) });
    d = await s.drafts.putOffering(owner, d.id, d.revision, offering(d.category));
    const p = (await s.publication.preview(owner, d.id)).proposal!;
    assert.ok(p);
    const approval = { proposalId: p.id, revision: p.revision, approved: true as const };
    await assert.rejects(s.publication.commit(owner, { ...approval, approved: false } as never));
    await assert.rejects(s.publication.commit(other, approval));
    const result = await s.publication.commit(owner, approval);
    s.expire();
    assert.deepEqual(await s.publication.commit(owner, approval), result);
    await assert.rejects(s.publication.commit(owner, { ...approval, revision: 123 }));
    assert.equal((await storage.catalog.listOwnerBusinesses(owner.userId)).length, 1);
  });
}
test('editing invalidates preview, expires pending proposals, and rejects stale draft writes', async () => {
  const s = services(createRelayMemory());
  let d = await s.drafts.create(owner, 'shop');
  d = await s.drafts.patch(owner, d.id, 0, { profile: profile('shop') });
  d = await s.drafts.putOffering(owner, d.id, d.revision, offering(d.category));
    const p = (await s.publication.preview(owner, d.id)).proposal!;
  await s.drafts.patch(owner, d.id, d.revision, { profile: { name: 'Changed' } });
  await assert.rejects(s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true }), { code: 'STALE_REVISION' });
  await assert.rejects(s.drafts.patch(owner, d.id, d.revision, { profile: { name: 'Stale' } }), { code: 'STALE_REVISION' });
  const fresh = (await s.publication.preview(owner, d.id)).proposal!; s.expire();
  await assert.rejects(s.publication.commit(owner, { proposalId: fresh.id, revision: fresh.revision, approved: true }), { code: 'PROPOSAL_EXPIRED' });
});

import { publicationContracts } from './helpers/publication-contract.js';
publicationContracts('memory', async () => createRelayMemory());

test('category, final price/currency, overlapping slots and references are validated without invented facts', async () => {
  const s = services(createRelayMemory());
  let d = await s.drafts.create(owner, 'restaurant');
  d = await s.drafts.patch(owner, d.id, d.revision, { profile: profile('restaurant') });
  await assert.rejects(s.drafts.putOffering(owner, d.id, d.revision, offering('hotel')));
  await assert.rejects(s.drafts.putOffering(owner, d.id, d.revision, { ...offering('restaurant'), variants: [{ id: 'bad', name: 'Bad', unitPrice: { amountMinor: 1, currency: 'CHF' }, metadata: [] }] } as never));
  d = await s.drafts.putOffering(owner, d.id, d.revision, offering('restaurant'));
  const slot = { kind: 'restaurant_slot' as const, id: 'slot_a', slotDate: '2027-01-02', startTime: '18:00', endTime: '20:00', totalSeats: 10, minPartySize: 1, maxPartySize: 4, metadata: [] };
  d = await s.drafts.putInventory(owner, d.id, d.revision, slot);
  d = await s.drafts.putInventory(owner, d.id, d.revision, { ...slot, id: 'slot_b', startTime: '19:00', endTime: '21:00' });
  await assert.rejects(s.publication.preview(owner, d.id), { code: 'VALIDATION_ERROR' });
  d = await s.drafts.patch(owner, d.id, d.revision, { inventoryEdits: { upsert: [], removeIds: ['slot_b'] } });
  assert.ok((await s.publication.preview(owner, d.id)).proposal);
  d = await s.drafts.putInventory(owner, d.id, d.revision, { kind: 'sellable_variant', id: 'invalid_ref', offeringId: 'foreign', variantId: 'foreign', remainingUnits: 1, metadata: [] });
  const preview = await s.publication.preview(owner, d.id);
  assert.equal(preview.proposal, null); assert.ok(preview.missingFields.some(f => f.path.startsWith('inventoryEdits.')));
});
