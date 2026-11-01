import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMongoHarness } from './helpers/relay-mongo.js';
import { publicationContracts, seed } from './helpers/publication-contract.js';
import { owner, services, offering } from './helpers/publication-fixtures.js';
import { proposalRecordSchema } from '../src/schemas/action.schema.js';
import { inventoryKeyForInput } from '../src/repositories/catalog.repository.js';
publicationContracts('Atlas transaction', buildMongoHarness);

test('Atlas: draft edit wins publication snapshot race through transactional revision fence', async t => {
  const storage = await buildMongoHarness(); t.after(() => storage.close()); const s = services(storage);
  const { d } = await seed(s, 'shop');
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  function signal() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }
  const entered = signal(); const release = signal();
  const original = storage.catalog.fenceDraft.bind(storage.catalog); let first = true;
  storage.catalog.fenceDraft = async (...args) => {
    if (first) { first = false; entered.resolve(); await release.promise; }
    return original(...args);
  };
  const pending = s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true });
  const rejected = assert.rejects(pending, { code: 'STALE_REVISION' });
  await entered.promise;
  await s.drafts.patch(owner, d.id, d.revision, { profile: { name: 'Concurrent edit' } });
  release.resolve(); await rejected;
  assert.equal(await storage.catalog.getPublished(d.businessId), null);
  assert.equal((await storage.proposals.get(p.id))?.state, 'pending');
});

test('Atlas: concurrent approvals return one durable result and withdrawal preserves confirmed snapshots', async t => {
  const storage = await buildMongoHarness(); t.after(() => storage.close()); const s = services(storage);
  const { d, inputs } = await seed(s, 'restaurant');
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  const approval = { proposalId: p.id, revision: p.revision, approved: true as const };
  const results = await Promise.all([s.publication.commit(owner, approval), s.publication.commit(owner, approval)]);
  assert.deepEqual(results[0], results[1]);
  const booking = proposalRecordSchema.parse({ id: 'booking_history', principal: { role: 'client', userId: 'client_history' }, revision: 0, kind: 'restaurant_booking',
    payload: { kind: 'restaurant_booking', businessId: d.businessId, slotId: 'slot', partySize: 2 },
    summary: { kind: 'restaurant_booking', businessId: d.businessId, slotId: 'slot', slotDate: '2027-01-02', startTime: '18:00', endTime: '20:00', partySize: 2, policies: ['Owner policy'], paymentNotice: 'No payment required.' },
    termsRevision: { businessRevision: 1, offeringRevisions: [], inventoryRevisions: [] }, expiresAt: '2027-01-01T00:15:00Z', state: 'pending', durableResultRef: null });
  await storage.proposals.insert(booking);
  const confirmed = await storage.uow.run(async tx => {
    await storage.catalog.applyAllocations([{ key: inventoryKeyForInput(d.businessId, inputs[1]!), delta: 2 }], tx);
    return storage.transactions.insertAction(booking.principal, booking, tx);
  });
  let edit = await s.drafts.create(owner, 'restaurant', d.businessId);
  edit = await s.drafts.putOffering(owner, edit.id, edit.revision, { ...offering('restaurant'), active: false });
  const withdrawal = (await s.publication.preview(owner, edit.id)).proposal!;
  await s.publication.commit(owner, { proposalId: withdrawal.id, revision: withdrawal.revision, approved: true });
  assert.equal((await storage.catalog.getPublished(d.businessId))?.offerings[0]?.active, false);
  assert.deepEqual(await storage.transactions.getCustomerAction('client_history', confirmed.id), confirmed);
  s.expire(); assert.deepEqual(await s.publication.commit(owner, approval), results[0]);
});

test('Atlas: event failure after profile/inventory/proposal writes rolls the whole publication back', async t => {
  const storage = await buildMongoHarness(); t.after(() => storage.close()); const s = services(storage);
  const { d } = await seed(s, 'shop');
  const p = (await s.publication.preview(owner, d.id)).proposal!;
  const originalEvent = storage.transactions.appendEvent.bind(storage.transactions);
  storage.transactions.appendEvent = async (...args) => { await originalEvent(...args); throw new Error('publication event failure'); };
  await assert.rejects(s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true }), /publication event failure/);
  assert.equal(await storage.catalog.getPublished(d.businessId), null);
  assert.equal((await storage.proposals.get(p.id))?.state, 'pending');
  assert.deepEqual(await storage.catalog.getInventory(d.inventoryEdits.map(i => inventoryKeyForInput(d.businessId, i))), []);
  storage.transactions.appendEvent = originalEvent;
  assert.equal((await s.publication.commit(owner, { proposalId: p.id, revision: p.revision, approved: true })).kind, 'publication');
});
