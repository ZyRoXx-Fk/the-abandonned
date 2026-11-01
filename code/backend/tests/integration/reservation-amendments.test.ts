import assert from 'node:assert/strict';
import { buildMongoHarness } from '../helpers/relay-mongo.js';
import { amendmentContracts } from '../helpers/reservation-amendment-contract.js';
import { test } from 'node:test';
import { booked } from '../helpers/reservation-amendment-contract.js';
import { client, approve } from '../helpers/action-commit-contract.js';
import { owner, offering } from '../helpers/publication-fixtures.js';
import { getActionEventModel } from '../../src/models/action-event.model.js';
import { getReservationModel } from '../../src/models/reservation.model.js';
import { getBusinessModel } from '../../src/models/business.model.js';
import { RelayError } from '../../src/utils/relay-error.js';
async function buildMongo8() {
  const st = await buildMongoHarness();
  try { const info = await st.connection.db!.admin().command({ buildInfo: 1 }); assert.match(info.version, /^8\./); console.log(`Task9 ${st.connection.name}: MongoDB ${info.version}`); }
  catch (e) { await st.close(); throw e; }
  const close = st.close.bind(st); st.close = async () => { try { await st.connection.db!.dropDatabase(); assert.deepEqual(await st.connection.db!.listCollections().toArray(), []); console.log(`Task9 cleaned ${st.connection.name}: zero collections`); } finally { await close(); } };
  return st;
}
amendmentContracts('Mongo8', buildMongo8, st => {
  let resolve!: () => void; const ready = new Promise<void>(r => { resolve = r; }); let calls = 0; const fence = st.catalog.fencePublished.bind(st.catalog);
  st.catalog.fencePublished = async (...args) => { if (++calls <= 2) { if (calls === 2) resolve(); await ready; } return fence(...args); };
});

function signal() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test('Mongo8: same amendment concurrent retries yield one exact durable result/event', async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await booked(st);
  const p = await x.amendments.prepare(client, x.amendment); const ready = signal(); let calls = 0; const fence = st.catalog.fencePublished.bind(st.catalog);
  st.catalog.fencePublished = async (...args) => { if (++calls <= 2) { if (calls === 2) ready.resolve(); await ready.promise; } return fence(...args); };
  const [a, b] = await Promise.all([x.commit.commit(client, approve(p)), x.commit.commit(client, approve(p))]); assert.deepEqual(a, b); assert.equal(a.revision, 1);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 1);
  assert.equal(await getReservationModel(st.connection).countDocuments({ _id: a.id }), 1);
  const rows = await st.catalog.getInventory(p.termsRevision.inventoryRevisions.map(r => r.key)); assert.equal(rows[0]!.kind !== 'sellable_variant' && rows[0]!.allocatedCapacity, 3);
});
test('Mongo8: zero-net guest amendment publication fence rejects concurrent price-only publication', async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await booked(st, 'hotel');
  const p = await x.amendments.prepare(client, { ...x.amendment, kind: 'hotel_booking', checkIn: '2027-01-02', checkOut: '2027-01-04', guests: 1 });
  const before = await st.catalog.getInventory(p.termsRevision.inventoryRevisions.map(r => r.key));
  const entered = signal(); const release = signal(); const fence = st.catalog.fencePublished.bind(st.catalog); let first = true;
  st.catalog.fencePublished = async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return fence(...args); };
  const rejection = assert.rejects(x.commit.commit(client, approve(p)), (error: unknown) => { assert.ok(error instanceof RelayError); assert.equal(error.code, 'TERMS_CHANGED'); assert.ok((error.details as {replacementProposal: unknown}).replacementProposal); return true; });
  await entered.promise;
  try {
    let edit = await x.s.drafts.create(owner, 'hotel', x.d.businessId); const room = offering('hotel'); if (room.kind !== 'room_type') throw new Error('hotel expected'); room.nightlyRate.amountMinor = 15000;
    edit = await x.s.drafts.putOffering(owner, edit.id, edit.revision, room); assert.deepEqual(edit.inventoryEdits, []);
    await x.s.publication.commit(owner, approve((await x.s.publication.preview(owner, edit.id)).proposal!));
  } finally { release.resolve(); }
  await rejection; assert.deepEqual(await st.catalog.getInventory(before.map(r => r.key)), before); assert.deepEqual(await x.commit.getAction(client, x.original.id), x.original);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 0); assert.equal((await st.proposals.get(p.id))!.state, 'pending');
});
test('Mongo8: zero-net amendment fences privately; post-event failure rolls back every durable effect', async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await booked(st, 'hotel');
  const p = await x.amendments.prepare(client, { ...x.amendment, kind: 'hotel_booking', checkIn: '2027-01-02', checkOut: '2027-01-04', guests: 1 });
  const before = await getBusinessModel(st.connection).findOne({ relayBusinessId: x.d.businessId }).lean();
  const append = st.transactions.appendEvent.bind(st.transactions); st.transactions.appendEvent = async (...args) => { await append(...args); throw new Error('amendment event rollback'); };
  await assert.rejects(x.commit.commit(client, approve(p)), /amendment event rollback/);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 0); assert.deepEqual(await x.commit.getAction(client, x.original.id), x.original);
  assert.deepEqual(await getBusinessModel(st.connection).findOne({ relayBusinessId: x.d.businessId }).lean(), before);
  st.transactions.appendEvent = append; await x.commit.commit(client, approve(p));
  const after = await getBusinessModel(st.connection).findOne({ relayBusinessId: x.d.businessId }).lean(); assert.equal(after!.relayCommitFence, before!.relayCommitFence! + 1);
  const { relayCommitFence: _a, ...publicAfter } = after!; const { relayCommitFence: _b, ...publicBefore } = before!; assert.deepEqual(publicAfter, publicBefore);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 1);
});
test('Mongo8: persisted allocations, not a reconstructed historical party, are old authority', async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await booked(st);
  // Deliberately divergent historical snapshot: two real allocated seats remain authoritative.
  await getReservationModel(st.connection).updateOne({ _id: x.original.id }, { $set: { 'result.summary.partySize': 1 } });
  const p = await x.amendments.prepare(client, x.amendment); await x.commit.commit(client, approve(p));
  const rows = await st.catalog.getInventory(p.termsRevision.inventoryRevisions.map(r => r.key)); assert.equal(rows[0]!.kind !== 'sellable_variant' && rows[0]!.allocatedCapacity, 3);
});
