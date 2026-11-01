import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMongoHarness } from '../helpers/relay-mongo.js';
import { type CommitStorage, actionCommitContracts, setup, client, approve } from '../helpers/action-commit-contract.js';
import { owner, offering } from '../helpers/publication-fixtures.js';
import { getActionEventModel } from '../../src/models/action-event.model.js';
import { RelayError } from '../../src/utils/relay-error.js';
import type { ProposalView } from '../../src/schemas/action.schema.js';
import { getBusinessModel } from '../../src/models/business.model.js';
import { getOrderModel } from '../../src/models/order.model.js';
import { getReservationModel } from '../../src/models/reservation.model.js';

async function buildMongo8() {
  const st = await buildMongoHarness();
  try {
    const info = await st.connection.db!.admin().command({ buildInfo: 1 });
    assert.match(info.version, /^8\./, 'Task8 is authorized only on MongoDB8');
    console.log(`Task8 database ${st.connection.name}: MongoDB ${info.version}`);
  } catch (error) { await st.close(); throw error; }
  const close = st.close.bind(st);
  st.close = async () => {
    try {
      await st.connection.db!.dropDatabase();
      assert.deepEqual(await st.connection.db!.listCollections().toArray(), []);
      console.log(`Task8 cleaned ${st.connection.name}: zero collections`);
    } finally { await close(); }
  };
  return st;
}
function synchronizeFirstApprovals(st: CommitStorage): void {
  const ready = signal(); let calls = 0; const fence = st.catalog.fencePublished.bind(st.catalog);
  st.catalog.fencePublished = async (...args) => {
    // Both independent sessions have read their snapshots before either writes.
    if (++calls <= 2) { if (calls === 2) ready.resolve(); await ready.promise; }
    return fence(...args);
  };
}
actionCommitContracts('Mongo8', buildMongo8, synchronizeFirstApprovals);
function signal() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test('Mongo8: deterministic price-only publication wins after approval terms read, before fence write', async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await setup(st);
  const p = await x.prepare.prepare(client, x.input);
  const before = await st.catalog.getInventory(p.termsRevision.inventoryRevisions.map(r => r.key));
  const entered = signal(); const release = signal(); const fence = st.catalog.fencePublished.bind(st.catalog); let first = true;
  st.catalog.fencePublished = async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return fence(...args); };
  const pending = x.commit.commit(client, approve(p));
  const rejection = assert.rejects(pending, (error: unknown) => { assert.ok(error instanceof RelayError); const details = error.details as { nextAction: string; replacementProposal: ProposalView }; assert.equal(error.code, 'TERMS_CHANGED'); assert.equal(details.nextAction, 'review_and_approve'); assert.equal(details.replacementProposal.summary.kind === 'order' && details.replacementProposal.summary.totalPrice.amountMinor, 2000); return true; });
  await entered.promise;
  try {
    let edit = await x.s.drafts.create(owner, 'shop', x.d.businessId); const o = offering('shop');
    if (o.kind === 'room_type') throw new Error('shop fixture expected'); o.variants[0]!.unitPrice.amountMinor = 2000;
    edit = await x.s.drafts.putOffering(owner, edit.id, edit.revision, o); assert.deepEqual(edit.inventoryEdits, []);
    const pub = (await x.s.publication.preview(owner, edit.id)).proposal!; await x.s.publication.commit(owner, approve(pub));
  } finally { release.resolve(); }
  await rejection;
  assert.deepEqual(await st.catalog.getInventory(before.map(i => i.key)), before);
  assert.equal((await st.proposals.get(p.id))!.state, 'pending');
  assert.equal(await getOrderModel(st.connection).countDocuments({ proposalId: p.id }), 0);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 0);
});
test('Mongo8: concurrent SAME proposal leaves exactly one action/event and one allocation', async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await setup(st); const p = await x.prepare.prepare(client, x.input);
  synchronizeFirstApprovals(st);
  const [a, b] = await Promise.all([x.commit.commit(client, approve(p)), x.commit.commit(client, approve(p))]); assert.deepEqual(a, b);
  x.expire(); assert.deepEqual(await x.commit.commit(client, approve(p)), a);
  assert.equal(await getOrderModel(st.connection).countDocuments({ proposalId: p.id }), 1);
  assert.equal(await getReservationModel(st.connection).countDocuments({ proposalId: p.id }), 0);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 1);
  const rows = await st.catalog.getInventory(p.termsRevision.inventoryRevisions.map(r => r.key)); assert.equal(rows[0]!.kind === 'sellable_variant' && rows[0]!.remainingUnits, 9);
});

for (const category of ['shop', 'restaurant', 'hotel'] as const) test(`Mongo8: ${category} fence is private and failure removes all durable effects`, async t => {
  const st = await buildMongo8(); t.after(() => st.close()); const x = await setup(st, category); const p = await x.prepare.prepare(client, x.input);
  const before = await getBusinessModel(st.connection).findOne({ relayBusinessId: x.d.businessId }).lean();
  const event = st.transactions.appendEvent.bind(st.transactions);
  st.transactions.appendEvent = async (...args) => { await event(...args); throw new Error('post-event rollback'); };
  await assert.rejects(x.commit.commit(client, approve(p)), /post-event rollback/);
  assert.equal(await getOrderModel(st.connection).countDocuments({ proposalId: p.id }), 0);
  assert.equal(await getReservationModel(st.connection).countDocuments({ proposalId: p.id }), 0);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 0);
  assert.deepEqual(await getBusinessModel(st.connection).findOne({ relayBusinessId: x.d.businessId }).lean(), before);
  st.transactions.appendEvent = event; await x.commit.commit(client, approve(p));
  const after = await getBusinessModel(st.connection).findOne({ relayBusinessId: x.d.businessId }).lean();
  assert.equal(after!.relayCommitFence, (before!.relayCommitFence ?? 0) + 1);
  const { relayCommitFence: _beforeFence, ...publicBefore } = before!;
  const { relayCommitFence: _afterFence, ...publicAfter } = after!;
  assert.deepEqual(publicAfter, publicBefore);
  assert.equal(await getActionEventModel(st.connection).countDocuments({ proposalId: p.id }), 1);
});
