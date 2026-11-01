import mongoose from 'mongoose';
import type { CatalogRepository, InventoryRecord } from '../../src/repositories/catalog.repository.js';
import { inventoryKeyForInput } from '../../src/repositories/catalog.repository.js';
import type { ProposalRepository } from '../../src/repositories/proposal.repository.js';
import type { TransactionRepository } from '../../src/repositories/transaction.repository.js';
import type { UnitOfWork } from '../../src/repositories/unit-of-work.js';
import { businessDraftSchema, publicBusinessSchema, businessPageSchema, businessQuerySchema, type BusinessDraft, type PublicBusiness } from '../../src/schemas/catalog.schema.js';
import { commitResultSchema, proposalRecordSchema, type ProposalRecord, type CommitResult } from '../../src/schemas/action.schema.js';
import { RelayError } from '../../src/utils/relay-error.js';

// Serialized, snapshot/rollback transactions; deliberately not evidence of Mongo concurrency.
type MemoryAction = { ownerId: string; businessId: string; createdAt: string; result: import('../../src/schemas/action.schema.js').ActionResult };
export function createRelayMemory(initialActions: MemoryAction[] = []) {
  let drafts = new Map<string, BusinessDraft>();
  let businesses = new Map<string, { ownerId: string; value: PublicBusiness }>();
  let inventory = new Map<string, InventoryRecord>();
  let proposals = new Map<string, ProposalRecord>();
  let results = new Map<string, CommitResult>();
  let events: unknown[] = [];
  const actions = structuredClone(initialActions);
  const copy = structuredClone;
  let tail: Promise<unknown> = Promise.resolve();
  const tx = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017').startSession();
  const uow: UnitOfWork = {
    async assertSupported() {},
    async run(work) {
      const run = tail.then(async () => {
        const snapshot = copy({ drafts, businesses, inventory, proposals, results, events });
        try { return await work(tx); }
        catch (e) { ({ drafts, businesses, inventory, proposals, results, events } = snapshot); throw e; }
      });
      tail = run.catch(() => undefined); return run;
    },
  };
  const catalog: CatalogRepository = {
    async getDraft(ownerId, id) { const d = drafts.get(id); return d?.ownerId === ownerId ? copy(d) : null; },
    async listDrafts(ownerId, offset, limit) { return copy([...drafts.values()].filter(d => d.ownerId === ownerId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(Math.max(0, offset), Math.max(0, offset) + Math.min(50, limit > 0 ? limit : 10))); },
    async insertDraft(draft) { if (drafts.has(draft.id)) throw new Error('Duplicate draft'); drafts.set(draft.id, businessDraftSchema.parse(draft)); },
    async replaceDraft(draft, expected) { const d = drafts.get(draft.id); if (!d || d.ownerId !== draft.ownerId || d.revision !== expected) return false; drafts.set(draft.id, businessDraftSchema.parse(draft)); return true; },
    async fenceDraft(ownerId, id, expected) { const d = drafts.get(id); return d?.ownerId === ownerId && d.revision === expected; },
    async getPublished(id) { return copy(businesses.get(id)?.value ?? null); },
    async searchPublished(query) {
      const q = businessQuerySchema.parse(query);
      const items = [...businesses.values()].map(b => b.value).filter(b => (!q.category || b.category === q.category)
        && (!q.text || [b.profile.name, b.profile.description].some(v => v.toLowerCase().includes(q.text!.toLowerCase())))
        && (!q.addressText || b.profile.address.toLowerCase().includes(q.addressText.toLowerCase()))
        && q.amenities.every(a => b.profile.categoryConfig.amenities.includes(a)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.businessId.localeCompare(b.businessId));
      return businessPageSchema.parse({ items: items.slice(q.offset, q.offset + q.limit).map(b => ({
        businessId: b.businessId, category: b.category, name: b.profile.name, address: b.profile.address,
        description: b.profile.description, currency: b.profile.currency, timezone: b.profile.timezone,
        amenities: b.profile.categoryConfig.amenities, revision: b.revision, publishedAt: b.publishedAt, updatedAt: b.updatedAt,
      })), offset: q.offset, limit: q.limit, total: items.length });
    },
    async listOwnerBusinesses(ownerId) { return copy([...businesses.values()].filter(b => b.ownerId === ownerId).map(b => b.value)); },
    async getInventory(keys) { return copy(keys.flatMap(k => inventory.has(k) ? [inventory.get(k)!] : [])); },
    async applyAllocations(changes) {
      const merged = new Map<string, number>();
      for (const { key, delta } of changes) merged.set(key, (merged.get(key) ?? 0) + delta);
      for (const [key, delta] of merged) {
        if (delta === 0) continue;
        const row = inventory.get(key); if (!row) throw new RelayError('UNAVAILABLE', 'Unknown inventory');
        if (row.kind === 'sellable_variant') { if (row.remainingUnits < delta) throw new RelayError('UNAVAILABLE', 'Insufficient stock'); row.remainingUnits -= delta; }
        else { if (row.allocatedCapacity + delta < 0 || row.allocatedCapacity + delta > row.totalCapacity) throw new RelayError('UNAVAILABLE', 'Insufficient capacity'); row.allocatedCapacity += delta; }
        if (delta) row.revision++;
      }
      refresh();
    },
    async publish(draft, _tx) {
      const d = businessDraftSchema.parse(draft); const previous = businesses.get(d.businessId);
      if (previous && previous.ownerId !== d.ownerId) throw new RelayError('FORBIDDEN', 'Business owner mismatch');
      if ((previous?.value.revision ?? 0) !== d.baseBusinessRevision) throw new RelayError('STALE_REVISION', 'Business changed');
      for (const input of d.inventoryEdits) {
        const key = inventoryKeyForInput(d.businessId, input); const old = inventory.get(key);
        if (old ? input.expectedRevision !== old.revision : input.expectedRevision !== undefined) throw new RelayError('STALE_REVISION', 'Inventory changed');
        const offering = input.kind === 'sellable_variant' ? d.offerings.find(o => o.id === input.offeringId && o.kind !== 'room_type' && o.variants.some(v => v.id === input.variantId)) : input.kind === 'room_night' ? d.offerings.find(o => o.id === input.roomTypeId && o.kind === 'room_type') : true;
        if (!offering) throw new RelayError('VALIDATION_ERROR', 'Unknown offering');
        const base = { key, businessId: d.businessId, revision: old ? old.revision + 1 : 0, metadata: input.metadata, updatedAt: d.updatedAt };
        if (input.kind === 'sellable_variant') inventory.set(key, { ...base, kind: input.kind, offeringId: input.offeringId, variantId: input.variantId, remainingUnits: input.remainingUnits });
        else {
          const allocatedCapacity = old && old.kind !== 'sellable_variant' ? old.allocatedCapacity : 0;
          const totalCapacity = input.kind === 'restaurant_slot' ? input.totalSeats : input.totalRooms;
          if (allocatedCapacity > totalCapacity) throw new RelayError('UNAVAILABLE', 'Capacity below allocations');
          inventory.set(key, input.kind === 'restaurant_slot' ? { ...base, kind: input.kind, slotId: input.id, slotDate: input.slotDate, startTime: input.startTime, endTime: input.endTime, minPartySize: input.minPartySize, maxPartySize: input.maxPartySize, allocatedCapacity, totalCapacity } : { ...base, kind: input.kind, roomTypeId: input.roomTypeId, localNight: input.localNight, allocatedCapacity, totalCapacity });
        }
        const next = inventory.get(key)!;
        const content = (row: InventoryRecord) => JSON.stringify(Object.entries(row).filter(([k]) => k !== 'revision' && k !== 'updatedAt').sort(([a], [b]) => a.localeCompare(b)));
        if (old && content(old) === content(next)) next.revision = old.revision;
      }
      const revision = d.baseBusinessRevision + 1;
      const value = publicBusinessSchema.parse({ businessId: d.businessId, category: d.category, profile: d.profile, offerings: d.offerings, availability: availability(d.businessId), revision, publishedAt: previous?.value.publishedAt ?? d.updatedAt, updatedAt: d.updatedAt });
      businesses.set(d.businessId, { ownerId: d.ownerId, value }); return { businessId: d.businessId, revision };
    },
  };
  function availability(id: string): PublicBusiness['availability'] {
    return [...inventory.values()].filter(i => i.businessId === id).map(i => i.kind === 'sellable_variant' ? { kind: i.kind, offeringId: i.offeringId, variantId: i.variantId, availableUnits: i.remainingUnits, updatedAt: i.updatedAt } : i.kind === 'room_night' ? { kind: i.kind, roomTypeId: i.roomTypeId, localNight: i.localNight, availableRooms: i.totalCapacity - i.allocatedCapacity, updatedAt: i.updatedAt } : { kind: i.kind, slotId: i.slotId, slotDate: i.slotDate, startTime: i.startTime, endTime: i.endTime, minPartySize: i.minPartySize, maxPartySize: i.maxPartySize, availableSeats: i.totalCapacity - i.allocatedCapacity, updatedAt: i.updatedAt });
  }
  function refresh() { for (const { value } of businesses.values()) value.availability = availability(value.businessId); }
  const proposalPort: ProposalRepository = {
    async insert(p) { if (proposals.has(p.id)) throw new Error('Duplicate proposal'); proposals.set(p.id, proposalRecordSchema.parse(p)); },
    async get(id) { return copy(proposals.get(id) ?? null); },
    async getCommittedResult(id) { return copy(results.get(id) ?? null); },
    async markCommitted(id, revision, result) { const p = proposals.get(id); if (!p || p.revision !== revision || p.state !== 'pending') return false; p.state = 'committed'; p.revision++; p.durableResultRef = `result_${id}`; results.set(id, commitResultSchema.parse(result)); return true; },
  };
  const transactions: Pick<TransactionRepository, "appendEvent" | "listOwnerActions"> = {
    async listOwnerActions(ownerId, businessId, offset, limit) {
      return actions.filter(a => a.ownerId === ownerId && a.businessId === businessId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.result.id.localeCompare(a.result.id))
        .slice(offset, offset + limit).map(a => structuredClone(a.result));
    },
    async appendEvent(principal, proposal, result) { events.push(copy({ principal, proposal, result })); },
  };
  return { catalog, proposals: proposalPort, transactions, uow,
    inspect: () => copy({ inventory: [...inventory.values()], proposals: [...proposals.values()], actions, events, results: [...results.values()] }) };
}
