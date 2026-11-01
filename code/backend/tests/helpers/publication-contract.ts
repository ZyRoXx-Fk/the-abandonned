import { test } from 'node:test';
import assert from 'node:assert/strict';
import { owner, profile, offering, services } from './publication-fixtures.js';
import type { createRelayMemory } from './relay-memory.js';
import { inventoryKeyForInput } from '../../src/repositories/catalog.repository.js';
import type { BusinessCategory } from '../../src/schemas/relay.schema.js';
import type { InventoryInput } from '../../src/schemas/catalog.schema.js';

export type PublicationStorage = Pick<ReturnType<typeof createRelayMemory>, 'catalog' | 'proposals' | 'transactions' | 'uow'> & { close?: () => Promise<void> };
export function publicationContracts(label: string, build: () => Promise<PublicationStorage>) {
  for (const category of ['restaurant', 'hotel', 'shop'] as const) {
    test(`${label}: ${category} profile-only publication preserves all consumed live inventory; stale replenishment rolls back`, async t => {
      const storage = await build(); t.after(() => storage.close?.()); const s = services(storage);
      const { d, inputs } = await seed(s, category);
      const first = (await s.publication.preview(owner, d.id)).proposal!;
      const approval = { proposalId: first.id, revision: first.revision, approved: true as const };
      const original = await s.publication.commit(owner, approval);
      let edit = await s.drafts.create(owner, category, d.businessId);
      assert.deepEqual(edit.inventoryEdits, []);
      edit = await s.drafts.patch(owner, edit.id, edit.revision, { profile: { description: 'Profile only' } });
      const preview = (await s.publication.preview(owner, edit.id)).proposal!;
      await storage.uow.run(tx => storage.catalog.applyAllocations(inputs.map(i => ({ key: inventoryKeyForInput(d.businessId, i), delta: 1 })), tx));
      const before = await storage.catalog.getInventory(inputs.map(i => inventoryKeyForInput(d.businessId, i)));
      assert.ok(before.every(i => i.revision === 1));
      await s.publication.commit(owner, { proposalId: preview.id, revision: preview.revision, approved: true });
      assert.deepEqual(await storage.catalog.getInventory(before.map(i => i.key)), before);
      assert.equal((await storage.catalog.getPublished(d.businessId))?.availability.length, inputs.length);
      assert.deepEqual(await s.publication.commit(owner, approval), original);
      let stale = await s.drafts.create(owner, category, d.businessId);
      stale = await s.drafts.patch(owner, stale.id, stale.revision, { profile: { name: 'Must roll back' }, inventoryEdits: { upsert: [{ ...inputs[0]!, expectedRevision: 0 }], removeIds: [] } });
      const bad = (await s.publication.preview(owner, stale.id)).proposal!;
      const publishedBefore = await storage.catalog.getPublished(d.businessId);
      await assert.rejects(s.publication.commit(owner, { proposalId: bad.id, revision: bad.revision, approved: true }), { code: 'STALE_REVISION' });
      assert.deepEqual(await storage.catalog.getPublished(d.businessId), publishedBefore);
      assert.equal((await storage.proposals.get(bad.id))?.state, 'pending');
    });
  }
  test(`${label}: rejected capacity edit rolls back profile and proposal; incomplete edit keeps published data readable`, async t => {
    const storage = await build(); t.after(() => storage.close?.()); const s = services(storage);
    const { d, inputs } = await seed(s, 'hotel');
    const p = (await s.publication.preview(owner, d.id)).proposal!;
    await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
    await storage.uow.run(tx => storage.catalog.applyAllocations([{ key: inventoryKeyForInput(d.businessId, inputs[0]!), delta: 2 }], tx));
    const before = await storage.catalog.getPublished(d.businessId);
    let edit = await s.drafts.create(owner, 'hotel', d.businessId);
    edit = await s.drafts.patch(owner, edit.id, edit.revision, { profile: { policies: [] } });
    assert.equal((await s.publication.preview(owner, edit.id)).proposal, null);
    assert.deepEqual(await storage.catalog.getPublished(d.businessId), before);
    edit = await s.drafts.patch(owner, edit.id, edit.revision, { profile: { name: 'Rejected profile', policies: ['Owner policy'] } });
    edit = await s.drafts.putInventory(owner, edit.id, edit.revision, { ...inputs[0]!, kind: 'room_night', roomTypeId: 'room', localNight: '2027-01-02', totalRooms: 1, expectedRevision: 1 });
    const bad = (await s.publication.preview(owner, edit.id)).proposal!;
    await assert.rejects(s.publication.commit(owner, { proposalId: bad.id, revision: bad.revision, approved: true }), { code: 'UNAVAILABLE' });
    assert.deepEqual(await storage.catalog.getPublished(d.businessId), before);
    assert.equal((await storage.proposals.get(bad.id))?.state, 'pending');
  });
  test(`${label}: competing draft base revision cannot overwrite newer publication; withdrawal retains inventory`, async t => {
    const storage = await build(); t.after(() => storage.close?.()); const s = services(storage);
    const { d, inputs } = await seed(s, 'shop');
    const p = (await s.publication.preview(owner, d.id)).proposal!;
    await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
    const stale = await s.drafts.create(owner, 'shop', d.businessId);
    let withdraw = await s.drafts.create(owner, 'shop', d.businessId);
    withdraw = await s.drafts.putOffering(owner, withdraw.id, withdraw.revision, { ...offering('shop'), active: false });
    const staleP = (await s.publication.preview(owner, stale.id)).proposal!;
    const withdrawP = (await s.publication.preview(owner, withdraw.id)).proposal!;
    await s.publication.commit(owner, { proposalId: withdrawP.id, revision: withdrawP.revision, approved: true });
    await assert.rejects(s.publication.commit(owner, { proposalId: staleP.id, revision: staleP.revision, approved: true }), { code: 'STALE_REVISION' });
    assert.equal((await storage.catalog.getPublished(d.businessId))?.offerings[0]?.active, false);
    assert.equal((await storage.catalog.getInventory(inputs.map(i => inventoryKeyForInput(d.businessId, i)))).length, 2);
  });
}
export async function seed(s: ReturnType<typeof services>, category: BusinessCategory) {
  let d = await s.drafts.create(owner, category);
  d = await s.drafts.patch(owner, d.id, d.revision, { profile: profile(category) });
  d = await s.drafts.putOffering(owner, d.id, d.revision, offering(category));
  const inputs: InventoryInput[] = category === 'hotel' ? ['2027-01-02', '2027-01-03'].map((localNight, n) => ({ kind: 'room_night', id: `night_${n}`, roomTypeId: 'room', localNight, totalRooms: 3, metadata: [] })) : [
    { kind: 'sellable_variant', id: 'units', offeringId: 'item', variantId: 'variant', remainingUnits: 10, metadata: [] },
    ...(category === 'restaurant' ? [{ kind: 'restaurant_slot' as const, id: 'slot', slotDate: '2027-01-02', startTime: '18:00', endTime: '20:00', totalSeats: 10, minPartySize: 1, maxPartySize: 4, metadata: [] }] : [{ kind: 'sellable_variant' as const, id: 'units_two', offeringId: 'item', variantId: 'second', remainingUnits: 5, metadata: [] }]),
  ];
  if (category === 'shop') {
    const o = offering(category); if (o.kind === 'room_type') throw new Error('fixture');
    d = await s.drafts.putOffering(owner, d.id, d.revision, { ...o, variants: [...o.variants, { ...o.variants[0]!, id: 'second' }] });
  }
  for (const input of inputs) d = await s.drafts.putInventory(owner, d.id, d.revision, input);
  return { d, inputs };
}
