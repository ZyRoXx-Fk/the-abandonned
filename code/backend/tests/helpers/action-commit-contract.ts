import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionCommitService } from '../../src/services/action-commit.service.js';
import { ActionProposalService } from '../../src/services/action-proposal.service.js';
import { owner, services, offering } from './publication-fixtures.js';
import { seed } from './publication-contract.js';
import { inventoryKeyForInput } from '../../src/repositories/catalog.repository.js';
import type { CatalogRepository } from '../../src/repositories/catalog.repository.js';
import type { ProposalRepository } from '../../src/repositories/proposal.repository.js';
import type { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import type { UnitOfWork } from '../../src/repositories/unit-of-work.js';
import type { CustomerActionInput, ProposalView } from '../../src/schemas/action.schema.js';
import { RelayError } from '../../src/utils/relay-error.js';
import type { BusinessCategory } from '../../src/schemas/relay.schema.js';

export type CommitStorage = { catalog: CatalogRepository; proposals: ProposalRepository; transactions: Pick<TransactionRepository, 'insertAction' | 'getCustomerAction' | 'appendEvent' | 'listOwnerActions'>; uow: UnitOfWork; close?: () => Promise<void> };
export const client = { role: 'client' as const, userId: 'client_one' };
export const foreign = { role: 'client' as const, userId: 'client_two' };
export const approve = (p: ProposalView) => ({ proposalId: p.id, revision: p.revision, approved: true as const });
export async function setup(storage: CommitStorage, category: BusinessCategory = 'shop') {
  const s = services(storage); const { d, inputs } = await seed(s, category);
  const pub = (await s.publication.preview(owner, d.id)).proposal!;
  await s.publication.commit(owner, approve(pub));
  let now = new Date('2027-01-01T00:00:00Z');
  const clock = () => now;
  const prepare = new ActionProposalService(storage.catalog, storage.proposals, clock);
  const commit = new ActionCommitService(storage.catalog, storage.proposals, storage.transactions, storage.uow, clock);
  const input: CustomerActionInput = category === 'hotel' ? { kind: 'hotel_booking', businessId: d.businessId, roomTypeId: 'room', checkIn: '2027-01-02', checkOut: '2027-01-04', guests: 2 }
    : category === 'restaurant' ? { kind: 'restaurant_booking', businessId: d.businessId, slotId: 'slot', partySize: 1 }
      : { kind: 'order', businessId: d.businessId, items: [{ offeringId: 'item', variantId: 'variant', quantity: 1 }], pickupAt: '2027-01-04T09:00:00Z' };
  return { s, d, inputs, input, prepare, commit, expire: () => { now = new Date('2027-01-01T00:16:00Z'); } };
}
export function actionCommitContracts(label: string, build: () => Promise<CommitStorage>, synchronize?: (storage: CommitStorage) => void) {
  for (const category of ['shop', 'restaurant', 'hotel'] as const) test(`${label}: ${category} last unit/seat/night race, durable retry, unchanged public terms`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await setup(st, category);
    // Reduce every demanded resource to one, without changing published terms.
    const keys = x.inputs.filter(i => category === 'hotel' || (category === 'shop' ? i.kind === 'sellable_variant' && i.variantId === 'variant' : i.kind === 'restaurant_slot')).map(i => inventoryKeyForInput(x.d.businessId, i));
    const rows = await st.catalog.getInventory(keys);
    await st.uow.run(async tx => { for (const row of rows) await st.catalog.applyAllocations([{ key: row.key, delta: (row.kind === 'sellable_variant' ? row.remainingUnits : row.totalCapacity - row.allocatedCapacity) - 1 }], tx); });
    const p = await x.prepare.prepare(client, x.input); const q = await x.prepare.prepare(foreign, x.input);
    const before = await st.catalog.getPublished(x.d.businessId);
    synchronize?.(st);
    const results = await Promise.allSettled([x.commit.commit(client, approve(p)), x.commit.commit(foreign, approve(q))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'UNAVAILABLE').length, 1);
    const winner = results[0]!.status === 'fulfilled' ? { p, principal: client, result: results[0]!.value } : { p: q, principal: foreign, result: (results[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof x.commit.commit>>>).value };
    assert.equal(winner.result.paymentStatus, category === 'restaurant' ? 'not_applicable' : 'not_collected_demo');
    x.expire(); assert.deepEqual(await x.commit.commit(winner.principal, approve(winner.p)), winner.result);
    assert.deepEqual(await x.commit.getAction(winner.principal, winner.result.id), winner.result);
    await assert.rejects(x.commit.getAction({ ...client, userId: 'intruder' }, winner.result.id), { code: 'NOT_FOUND' });
    const after = (await st.catalog.getPublished(x.d.businessId))!;
    assert.equal(after.revision, before!.revision); assert.equal(after.updatedAt, before!.updatedAt);
    assert.equal((await st.transactions.listOwnerActions(owner.userId, x.d.businessId, 0, 50)).length, 1);
    assert.ok((await st.catalog.getInventory(keys)).every(r => (r.kind === 'sellable_variant' ? r.remainingUnits : r.totalCapacity - r.allocatedCapacity) === 0));
  });
  test(`${label}: approval, principal, kind and original revision checked before durable return; same proposal concurrent approval`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await setup(st); const p = await x.prepare.prepare(client, x.input);
    const before = await st.catalog.getInventory(x.inputs.map(i => inventoryKeyForInput(x.d.businessId, i)));
    await assert.rejects(x.commit.commit(client, { ...approve(p), approved: false } as never), { code: 'APPROVAL_REQUIRED' });
    await assert.rejects(x.commit.commit(foreign, approve(p)), { code: 'FORBIDDEN' });
    await assert.rejects(x.commit.commit(owner, approve(p)), { code: 'FORBIDDEN' });
    await assert.rejects(x.commit.commit(client, { ...approve(p), revision: 9 }), { code: 'STALE_REVISION' });
    assert.deepEqual(await st.catalog.getInventory(before.map(r => r.key)), before);
    synchronize?.(st);
    const [a, b] = await Promise.all([x.commit.commit(client, approve(p)), x.commit.commit(client, approve(p))]); assert.deepEqual(a, b);
    await assert.rejects(x.commit.commit(foreign, approve(p)), { code: 'FORBIDDEN' });
    await assert.rejects(x.commit.commit(client, { ...approve(p), revision: p.revision + 1 }), { code: 'STALE_REVISION' });
    const stored = (await st.proposals.get(p.id))!;
    const get = st.proposals.get.bind(st.proposals);
    st.proposals.get = async (...args) => args[0] === p.id ? { ...stored, kind: 'publication' } as never : get(...args);
    await assert.rejects(x.commit.commit(client, approve(p)), { code: 'VALIDATION_ERROR' }); st.proposals.get = get;
    x.expire(); assert.deepEqual(await x.commit.commit(client, approve(p)), a);
    const pending = await x.prepare.prepare(client, x.input); x.expire();
    // Explicit expired proposal via a clock beyond the new expiry.
    const expired = new ActionCommitService(st.catalog, st.proposals, st.transactions, st.uow, () => new Date('2027-01-01T01:00:00Z'));
    await assert.rejects(expired.commit(client, approve(pending)), { code: 'PROPOSAL_EXPIRED' });
    assert.equal((await st.transactions.listOwnerActions(owner.userId, x.d.businessId, 0, 50)).length, 1);
  });
  for (const failure of ['insertAction', 'appendEvent'] as const) test(`${label}: ${failure} failure rolls action, event, allocations and proposal back`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await setup(st); const p = await x.prepare.prepare(client, x.input);
    const before = await st.catalog.getInventory(x.inputs.map(i => inventoryKeyForInput(x.d.businessId, i)));
    const insert = st.transactions.insertAction.bind(st.transactions);
    const event = st.transactions.appendEvent.bind(st.transactions);
    if (failure === 'insertAction') st.transactions.insertAction = async (...args) => { await insert(...args); throw new Error('forced write failure'); };
    else st.transactions.appendEvent = async (...args) => { await event(...args); throw new Error('forced write failure'); };
    await assert.rejects(x.commit.commit(client, approve(p)), /forced write failure/);
    assert.deepEqual(await st.catalog.getInventory(before.map(r => r.key)), before);
    assert.equal((await st.proposals.get(p.id))!.state, 'pending');
    assert.equal((await st.transactions.listOwnerActions(owner.userId, x.d.businessId, 0, 50)).length, 0);
    st.transactions.insertAction = insert; st.transactions.appendEvent = event;
    await x.commit.commit(client, approve(p));
  });
  test(`${label}: final hotel night conditional write failure rolls earlier night back`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await setup(st, 'hotel'); const p = await x.prepare.prepare(client, x.input);
    const keys = x.inputs.map(i => inventoryKeyForInput(x.d.businessId, i)); const before = await st.catalog.getInventory(keys);
    const apply = st.catalog.applyAllocations.bind(st.catalog);
    st.catalog.applyAllocations = async (changes, tx) => {
      // Exhaust the final night inside this transaction, after the service availability read.
      await apply([{ key: keys[1]!, delta: 3 }], tx); await apply(changes, tx);
    };
    await assert.rejects(x.commit.commit(client, approve(p)), { code: 'UNAVAILABLE' });
    assert.deepEqual(await st.catalog.getInventory(keys), before);
    assert.equal((await st.proposals.get(p.id))!.state, 'pending');
    assert.equal((await st.transactions.listOwnerActions(owner.userId, x.d.businessId, 0, 50)).length, 0);
  });
  for (const withdraw of [false, true]) test(`${label}: changed ${withdraw ? 'active offering' : 'price/policy'} requires fresh approval; historic result survives withdrawal`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await setup(st); const historic = await x.prepare.prepare(client, x.input);
    const result = await x.commit.commit(client, approve(historic)); const p = await x.prepare.prepare(client, x.input);
    let edit = await x.s.drafts.create(owner, 'shop', x.d.businessId); const o = offering('shop');
    if (o.kind !== 'room_type') o.variants[0]!.unitPrice.amountMinor = 2000;
    edit = await x.s.drafts.putOffering(owner, edit.id, edit.revision, { ...o, active: !withdraw });
    edit = await x.s.drafts.patch(owner, edit.id, edit.revision, { profile: { policies: ['Changed owner policy'] } });
    const pub = (await x.s.publication.preview(owner, edit.id)).proposal!; await x.s.publication.commit(owner, approve(pub));
    const before = await st.catalog.getInventory(x.inputs.map(i => inventoryKeyForInput(x.d.businessId, i)));
    await assert.rejects(x.commit.commit(client, approve(p)), (error: unknown) => {
      assert.ok(error instanceof RelayError);
      const details = error.details as { nextAction: string; replacementProposal: ProposalView | null; corrections: unknown[] };
      assert.equal(error.code, 'TERMS_CHANGED'); assert.equal(details.nextAction, 'review_and_approve');
      if (withdraw) { assert.equal(details.replacementProposal, null); assert.ok(details.corrections.length); }
      else { assert.notEqual(details.replacementProposal!.id, p.id); assert.equal(details.replacementProposal!.summary.kind === 'order' && details.replacementProposal!.summary.totalPrice.amountMinor, 2000); }
      return true;
    });
    assert.deepEqual(await st.catalog.getInventory(before.map(r => r.key)), before);
    assert.equal((await st.proposals.get(p.id))!.state, 'pending');
    x.expire(); assert.deepEqual(await x.commit.commit(client, approve(historic)), result);
    if (withdraw) await assert.rejects(x.prepare.prepare(client, x.input), { code: 'UNAVAILABLE' });
  });
}
