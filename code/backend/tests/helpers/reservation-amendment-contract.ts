import { inventoryKeyForRoomNight } from '../../src/repositories/catalog.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AmendmentInput } from '../../src/schemas/action.schema.js';
import { ActionCommitService } from '../../src/services/action-commit.service.js';
import { ReservationAmendmentService } from '../../src/services/reservation-amendment.service.js';
import { setup, approve, client, type CommitStorage } from './action-commit-contract.js';
import { owner, offering } from './publication-fixtures.js';
import { RelayError } from '../../src/utils/relay-error.js';

export async function booked(st: CommitStorage, category: 'restaurant' | 'hotel' = 'restaurant') {
  const x = await setup(st, category);
  const initial = x.input.kind === 'restaurant_booking' ? { ...x.input, partySize: 2 } : x.input;
  const original = await x.commit.commit(client, approve(await x.prepare.prepare(client, initial))); 
  const amendments = new ReservationAmendmentService(st.catalog, st.proposals, st.transactions, () => new Date('2027-01-01T00:00:00Z'));
  const input: AmendmentInput = category === 'restaurant'
    ? { kind: 'restaurant_booking', reservationId: original.id, expectedReservationRevision: 0, slotId: 'slot', partySize: 3 }
    : { kind: 'hotel_booking', reservationId: original.id, expectedReservationRevision: 0, checkIn: '2027-01-02', checkOut: '2027-01-03', guests: 1 };
  return { ...x, original, amendments, amendment: input };
}
export function amendmentContracts(label: string, build: () => Promise<CommitStorage>, synchronize?: (st: CommitStorage) => void) {
  test(`${label}: table 2→3→2 consumes/releases only net seats; retries return historical result`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st);
    const p = await x.amendments.prepare(client, x.amendment); const before = await st.catalog.getInventory(p.termsRevision.inventoryRevisions.map(r => r.key));
    assert.equal(before[0]!.kind !== 'sellable_variant' && before[0]!.allocatedCapacity, 2);
    const revised = await x.commit.commit(client, approve(p)); assert.equal(revised.id, x.original.id); assert.equal(revised.reference, x.original.reference); assert.equal(revised.revision, 1);
    const p2 = await x.amendments.prepare(client, { ...x.amendment, kind: 'restaurant_booking', slotId: 'slot', partySize: 2, expectedReservationRevision: 1 });
    await x.commit.commit(client, approve(p2)); x.expire(); assert.deepEqual(await x.commit.commit(client, approve(p)), revised);
    const rows = await st.catalog.getInventory(before.map(r => r.key)); assert.equal(rows[0]!.kind !== 'sellable_variant' && rows[0]!.allocatedCapacity, 2);
    await assert.rejects(x.commit.commit({ role: 'client', userId: 'foreign' }, approve(p)), { code: 'FORBIDDEN' });
    await assert.rejects(x.commit.commit(client, { ...approve(p), revision: 1 }), { code: 'STALE_REVISION' });
  });
  test(`${label}: no extra capacity and post-event failure leave original and inventory untouched`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st); const p = await x.amendments.prepare(client, x.amendment);
    const key = p.termsRevision.inventoryRevisions[0]!.key;
    await st.uow.run(tx => st.catalog.applyAllocations([{ key, delta: 8 }], tx));
    const before = await st.catalog.getInventory([key]); await assert.rejects(x.commit.commit(client, approve(p)), { code: 'UNAVAILABLE' });
    assert.deepEqual(await x.commit.getAction(client, x.original.id), x.original); assert.deepEqual(await st.catalog.getInventory([key]), before);
    await st.uow.run(tx => st.catalog.applyAllocations([{ key, delta: -8 }], tx)); const restored = await st.catalog.getInventory([key]);
    const append = st.transactions.appendEvent.bind(st.transactions); st.transactions.appendEvent = async (...args) => { await append(...args); throw new Error('amendment post-event rollback'); };
    await assert.rejects(x.commit.commit(client, approve(p)), /amendment post-event rollback/);
    assert.deepEqual(await st.catalog.getInventory([key]), restored); assert.deepEqual(await x.commit.getAction(client, x.original.id), x.original); assert.equal((await st.proposals.get(p.id))!.state, 'pending');
  });
  test(`${label}: concurrent proposals cannot overwrite same reservation revision`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st);
    const a = await x.amendments.prepare(client, x.amendment); const b = await x.amendments.prepare(client, x.amendment); synchronize?.(st);
    const results = await Promise.allSettled([x.commit.commit(client, approve(a)), x.commit.commit(client, approve(b))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); const rejected = results.find(r => r.status === 'rejected'); assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof RelayError); assert.equal(rejected.reason.code, 'STALE_REVISION');
    const rows = await st.catalog.getInventory(a.termsRevision.inventoryRevisions.map(r => r.key)); assert.equal(rows[0]!.kind !== 'sellable_variant' && rows[0]!.allocatedCapacity, 3);
  });
  test(`${label}: hotel overlap once and guest-only amendment needs no second room`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st, 'hotel');
    let edit = await x.s.drafts.create(owner, 'hotel', x.d.businessId);
    const old = (await st.catalog.getPublished(x.d.businessId))!.availability;
    for (const a of old) if (a.kind === 'room_night') {
      const rows = await st.catalog.getInventory([inventoryKeyForRoomNight(x.d.businessId, 'room', a.localNight)]);
      edit = await x.s.drafts.putInventory(owner, edit.id, edit.revision, { kind: 'room_night', id: 'edit_night', roomTypeId: 'room', localNight: a.localNight, totalRooms: 1, metadata: [], expectedRevision: rows[0]!.revision });
    }
    edit = await x.s.drafts.putInventory(owner, edit.id, edit.revision, { kind: 'room_night', id: 'edit_night', roomTypeId: 'room', localNight: '2027-01-04', totalRooms: 1, metadata: [] });
    await x.s.publication.commit(owner, approve((await x.s.publication.preview(owner, edit.id)).proposal!));
    const guest = await x.amendments.prepare(client, { ...x.amendment, kind: 'hotel_booking', checkIn: '2027-01-02', checkOut: '2027-01-04', guests: 1 });
    const before = await st.catalog.getInventory(guest.termsRevision.inventoryRevisions.map(r => r.key)); await x.commit.commit(client, approve(guest)); assert.deepEqual(await st.catalog.getInventory(before.map(r => r.key)), before);
    const shifted = await x.amendments.prepare(client, { ...x.amendment, kind: 'hotel_booking', checkIn: '2027-01-03', checkOut: '2027-01-05', guests: 2, expectedReservationRevision: 1 });
    const result = await x.commit.commit(client, approve(shifted)); assert.equal(result.revision, 2);
    const rows = await st.catalog.getInventory([inventoryKeyForRoomNight(x.d.businessId, 'room', '2027-01-02'), inventoryKeyForRoomNight(x.d.businessId, 'room', '2027-01-03'), inventoryKeyForRoomNight(x.d.businessId, 'room', '2027-01-04')]);
    assert.deepEqual(rows.map(r => r.kind !== 'sellable_variant' && r.allocatedCapacity), [0, 1, 1]);
  });
  test(`${label}: new slot snapshots use current slot times and release old allocations`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st);
    let edit = await x.s.drafts.create(owner, 'restaurant', x.d.businessId);
    edit = await x.s.drafts.putInventory(owner, edit.id, edit.revision, { kind: 'restaurant_slot', id: 'later', slotDate: '2027-01-03', startTime: '19:00', endTime: '21:00', totalSeats: 3, minPartySize: 1, maxPartySize: 3, metadata: [] });
    await x.s.publication.commit(owner, approve((await x.s.publication.preview(owner, edit.id)).proposal!));
    const p = await x.amendments.prepare(client, { ...x.amendment, kind: 'restaurant_booking', slotId: 'later', partySize: 3 });
    const result = await x.commit.commit(client, approve(p)); assert.equal(result.summary.kind, 'restaurant_booking');
    if (result.summary.kind !== 'restaurant_booking') throw new Error('table expected');
    assert.equal(result.summary.slotDate, '2027-01-03'); assert.equal(result.summary.startTime, '19:00'); assert.equal(result.summary.endTime, '21:00');
    const record = await st.transactions.getReservationRecord(client.userId, result.id); assert.equal(record!.allocations.length, 1);
    const rows = await st.catalog.getInventory(record!.allocations.map(a => a.key)); assert.equal(rows[0]!.kind !== 'sellable_variant' && rows[0]!.allocatedCapacity, 3);
  });
  test(`${label}: pending current time is revalidated even within proposal expiry`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st);
    let now = new Date('2027-01-02T16:55:00Z');
    const prepare = new ReservationAmendmentService(st.catalog, st.proposals, st.transactions, () => now);
    const commit = new ActionCommitService(st.catalog, st.proposals, st.transactions, st.uow, () => now);
    const p = await prepare.prepare(client, x.amendment); now = new Date('2027-01-02T17:01:00Z');
    await assert.rejects(commit.commit(client, approve(p)), { code: 'VALIDATION_ERROR' });
    assert.deepEqual(await x.commit.getAction(client, x.original.id), x.original);
    await assert.rejects(prepare.prepare(client, x.amendment), { code: 'VALIDATION_ERROR' });
  });
  test(`${label}: invalid intent, foreign principal, elapsed times, withdrawal and changed price`, async t => {
    const st = await build(); t.after(() => st.close?.()); const x = await booked(st, 'hotel');
    await assert.rejects(x.amendments.prepare({ role: 'client', userId: 'foreign' }, x.amendment), { code: 'NOT_FOUND' });
    for (const patch of [{ checkIn: '2027-02-30' }, { guests: 3 }, { checkOut: '2027-01-02' }]) await assert.rejects(x.amendments.prepare(client, { ...x.amendment, ...patch }), { code: 'VALIDATION_ERROR' });
    const p = await x.amendments.prepare(client, x.amendment); let edit = await x.s.drafts.create(owner, 'hotel', x.d.businessId); const room = offering('hotel'); assert.equal(room.kind, 'room_type'); if (room.kind !== 'room_type') throw new Error('room expected'); room.nightlyRate.amountMinor = 12000;
    edit = await x.s.drafts.putOffering(owner, edit.id, edit.revision, room); await x.s.publication.commit(owner, approve((await x.s.publication.preview(owner, edit.id)).proposal!));
    await assert.rejects(x.commit.commit(client, approve(p)), (e: unknown) => { assert.ok(e instanceof RelayError); assert.equal(e.code, 'TERMS_CHANGED'); assert.ok((e.details as {replacementProposal: unknown}).replacementProposal); return true; });
    const fresh = await x.amendments.prepare(client, x.amendment); edit = await x.s.drafts.create(owner, 'hotel', x.d.businessId); room.active = false; edit = await x.s.drafts.putOffering(owner, edit.id, edit.revision, room); await x.s.publication.commit(owner, approve((await x.s.publication.preview(owner, edit.id)).proposal!));
    await assert.rejects(x.commit.commit(client, approve(fresh)), (e: unknown) => { assert.ok(e instanceof RelayError); assert.equal(e.code, 'TERMS_CHANGED'); assert.equal((e.details as { replacementProposal: unknown }).replacementProposal, null); return true; });
    assert.deepEqual(await x.commit.getAction(client, x.original.id), x.original);
    const timed = new ReservationAmendmentService(st.catalog, st.proposals, st.transactions, () => new Date('2027-02-01T00:00:00Z'));
    await assert.rejects(timed.prepare(client, x.amendment));
  });
}
