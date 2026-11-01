import { randomUUID } from 'node:crypto';
import type { CatalogRepository } from '../repositories/catalog.repository.js';
import { inventoryKeyForInput } from '../repositories/catalog.repository.js';
import { businessDraftSchema, draftPatchSchema, type BusinessDraft, type DraftPatch, type OfferingInput, type InventoryInput } from '../schemas/catalog.schema.js';
import { businessCategorySchema, principalSchema, type BusinessCategory, type Principal, type Clock } from '../schemas/relay.schema.js';
import { RelayError } from '../utils/relay-error.js';

export function requireOwner(owner: Principal): void {
  principalSchema.parse(owner);
  if (owner.role !== 'owner') throw new RelayError('FORBIDDEN', 'An owner principal is required.');
}

export class BusinessDraftService {
  constructor(private readonly catalog: CatalogRepository, private readonly clock: Clock = () => new Date(), private readonly ids: () => string = randomUUID) {}

  async create(owner: Principal, category: BusinessCategory, businessId?: string): Promise<BusinessDraft> {
    requireOwner(owner); businessCategorySchema.parse(category);
    const existing = businessId ? (await this.catalog.listOwnerBusinesses(owner.userId)).find(b => b.businessId === businessId) : undefined;
    if (businessId && !existing) throw new RelayError('NOT_FOUND', 'Owned business not found.');
    if (existing && existing.category !== category) throw new RelayError('VALIDATION_ERROR', 'Business category cannot change.');
    const now = this.clock().toISOString();
    const draft = businessDraftSchema.parse({ id: this.ids(), businessId: businessId ?? this.ids(), ownerId: owner.userId, category,
      revision: 0, baseBusinessRevision: existing?.revision ?? 0, profile: existing?.profile ?? { categoryConfig: { kind: category } }, offerings: existing?.offerings ?? [],
      inventoryEdits: [], auditTrail: [], createdAt: now, updatedAt: now });
    await this.catalog.insertDraft(draft); return draft;
  }
  async list(owner: Principal, offset: number, limit: number): Promise<BusinessDraft[]> {
    requireOwner(owner); return this.catalog.listDrafts(owner.userId, offset, limit);
  }
  async get(owner: Principal, draftId: string): Promise<BusinessDraft> {
    requireOwner(owner);
    const draft = await this.catalog.getDraft(owner.userId, draftId);
    if (!draft) throw new RelayError('NOT_FOUND', 'Owned draft not found.');
    return draft;
  }
  async patch(owner: Principal, draftId: string, expectedRevision: number, patch: DraftPatch): Promise<BusinessDraft> {
    const current = await this.get(owner, draftId);
    const parsed = draftPatchSchema.parse(patch);
    if (current.revision !== expectedRevision) throw new RelayError('STALE_REVISION', 'Draft changed; resume the current revision.');
    function edit<T extends { id: string }>(values: T[], edits?: { upsert: T[]; removeIds: string[] }): T[] {
      const map = new Map(values.map(v => [v.id, v]));
      for (const id of edits?.removeIds ?? []) map.delete(id);
      for (const v of edits?.upsert ?? []) map.set(v.id, v);
      return [...map.values()];
    }
    const profile = { ...current.profile, ...parsed.profile };
    if (parsed.profile?.contact) profile.contact = { ...current.profile.contact, ...parsed.profile.contact };
    if (parsed.profile?.categoryConfig) profile.categoryConfig = { ...current.profile.categoryConfig, ...parsed.profile.categoryConfig };
    const next = businessDraftSchema.parse({ ...current, profile, offerings: edit(current.offerings, parsed.offeringEdits),
      inventoryEdits: edit(current.inventoryEdits, parsed.inventoryEdits), revision: current.revision + 1, updatedAt: this.clock().toISOString() });
    const keys = next.inventoryEdits.map(i => inventoryKeyForInput(next.businessId, i));
    if (new Set(keys).size !== keys.length || new Set(next.offerings.map(o => o.id)).size !== next.offerings.length) {
      throw new RelayError('VALIDATION_ERROR', 'Duplicate offering or inventory keys.');
    }
    if (!await this.catalog.replaceDraft(next, expectedRevision)) throw new RelayError('STALE_REVISION', 'Draft changed; resume the current revision.');
    return next;
  }
  putOffering(owner: Principal, draftId: string, expectedRevision: number, input: OfferingInput): Promise<BusinessDraft> {
    return this.patch(owner, draftId, expectedRevision, { offeringEdits: { upsert: [input], removeIds: [] } });
  }
  putInventory(owner: Principal, draftId: string, expectedRevision: number, input: InventoryInput): Promise<BusinessDraft> {
    return this.patch(owner, draftId, expectedRevision, { inventoryEdits: { upsert: [input], removeIds: [] } });
  }
}
