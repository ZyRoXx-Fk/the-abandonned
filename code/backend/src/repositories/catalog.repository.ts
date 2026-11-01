import { createHash } from "node:crypto";
import { Types, type ClientSession, type Connection } from "mongoose";
import { getBusinessDraftModel } from "../models/business-draft.model.js";
import { getBusinessModel } from "../models/business.model.js";
import { getInventoryModel, type InventoryDocument } from "../models/inventory.model.js";
import { getOfferingModel, type OfferingDocument } from "../models/offering.model.js";
import {
  businessDraftSchema,
  businessPageSchema,
  businessQuerySchema,
  publicBusinessSchema,
  type BusinessDraft,
  type BusinessProfile,
  type BusinessPage,
  type BusinessQuery,
  type InventoryInput,
  type OfferingInput,
  type PublicBusiness,
} from "../schemas/catalog.schema.js";
import type { AllocationChange } from "../schemas/action.schema.js";
import { relayIdSchema, type Principal } from "../schemas/relay.schema.js";
import { RelayError } from "../utils/relay-error.js";

export type InventoryRecord =
  | {
      key: string;
      businessId: string;
      kind: "sellable_variant";
      offeringId: string;
      variantId: string;
      revision: number;
      remainingUnits: number;
      metadata: { key: string; value: string }[];
      updatedAt: string;
    }
  | {
      key: string;
      businessId: string;
      kind: "restaurant_slot";
      slotId: string;
      slotDate: string;
      startTime: string;
      endTime: string;
      revision: number;
      totalCapacity: number;
      allocatedCapacity: number;
      minPartySize: number;
      maxPartySize: number;
      metadata: { key: string; value: string }[];
      updatedAt: string;
    }
  | {
      key: string;
      businessId: string;
      kind: "room_night";
      roomTypeId: string;
      localNight: string;
      revision: number;
      totalCapacity: number;
      allocatedCapacity: number;
      metadata: { key: string; value: string }[];
      updatedAt: string;
    };

export interface CatalogRepository {
  getDraft(ownerId: string, draftId: string, tx?: ClientSession): Promise<BusinessDraft | null>;
  listDrafts(ownerId: string, offset: number, limit: number): Promise<BusinessDraft[]>;
  insertDraft(draft: BusinessDraft): Promise<void>;
  replaceDraft(draft: BusinessDraft, expectedRevision: number): Promise<boolean>;
  // A write in the publishing transaction, not a snapshot-only revision check.
  fencePublished(businessId: string, expectedRevision: number, tx: ClientSession): Promise<boolean>;
  fenceDraft(ownerId: string, draftId: string, expectedRevision: number, tx: ClientSession): Promise<boolean>;
  getPublished(businessId: string, tx?: ClientSession): Promise<PublicBusiness | null>;
  searchPublished(query: BusinessQuery): Promise<BusinessPage>;
  listOwnerBusinesses(ownerId: string): Promise<PublicBusiness[]>;
  publish(draft: BusinessDraft, tx: ClientSession): Promise<{ businessId: string; revision: number }>;
  getInventory(keys: string[], tx?: ClientSession): Promise<InventoryRecord[]>;
  applyAllocations(changes: AllocationChange[], tx: ClientSession): Promise<void>;
}

function hashRelayId(prefix: string, raw: string): string {
  return relayIdSchema.parse(`${prefix}_${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`);
}

function ownerObjectIdForRelayOwner(ownerId: string): Types.ObjectId {
  return new Types.ObjectId(createHash("sha256").update(ownerId).digest("hex").slice(0, 24));
}

export function inventoryKeyForVariant(businessId: string, offeringId: string, variantId: string): string {
  return hashRelayId("invv", `${businessId}|sellable_variant|${offeringId}|${variantId}`);
}

export function inventoryKeyForRestaurantSlot(businessId: string, slotId: string): string {
  return hashRelayId("invs", `${businessId}|restaurant_slot|${slotId}`);
}

export function inventoryKeyForRoomNight(businessId: string, roomTypeId: string, localNight: string): string {
  return hashRelayId("invn", `${businessId}|room_night|${roomTypeId}|${localNight}`);
}

export function inventoryKeyForInput(businessId: string, input: InventoryInput): string {
  if (input.kind === "sellable_variant") {
    return inventoryKeyForVariant(businessId, input.offeringId, input.variantId);
  }
  if (input.kind === "restaurant_slot") {
    return inventoryKeyForRestaurantSlot(businessId, input.id);
  }
  return inventoryKeyForRoomNight(businessId, input.roomTypeId, input.localNight);
}

function boundOffset(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function boundLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return 10;
  }
  return Math.min(value, 50);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function parseDraft(document: {
  _id: string;
  businessId: string;
  ownerId: string;
  category: string;
  revision: number;
  baseBusinessRevision?: number;
  profile: unknown;
  offerings: unknown[];
  inventoryEdits: unknown[];
  auditTrail: unknown[];
  createdAt: string;
  updatedAt: string;
}): BusinessDraft {
  return businessDraftSchema.parse({
    id: document._id,
    businessId: document.businessId,
    ownerId: document.ownerId,
    category: document.category,
    revision: document.revision,
    baseBusinessRevision: document.baseBusinessRevision,
    profile: document.profile,
    offerings: document.offerings,
    inventoryEdits: document.inventoryEdits,
    auditTrail: document.auditTrail,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
}

function parseInventoryRecord(document: InventoryDocument): InventoryRecord {
  if (document.kind === "sellable_variant") {
    return {
      key: document._id,
      businessId: document.businessId,
      kind: "sellable_variant",
      offeringId: document.offeringId ?? "",
      variantId: document.variantId ?? "",
      revision: document.revision,
      remainingUnits: document.remainingUnits ?? 0,
      metadata: document.metadata as { key: string; value: string }[],
      updatedAt: document.updatedAt,
    };
  }

  if (document.kind === "restaurant_slot") {
    return {
      key: document._id,
      businessId: document.businessId,
      kind: "restaurant_slot",
      slotId: document.slotId ?? "",
      slotDate: document.slotDate ?? "",
      startTime: document.startTime ?? "",
      endTime: document.endTime ?? "",
      revision: document.revision,
      totalCapacity: document.totalCapacity ?? 0,
      allocatedCapacity: document.allocatedCapacity ?? 0,
      minPartySize: document.minPartySize ?? 1,
      maxPartySize: document.maxPartySize ?? 1,
      metadata: document.metadata as { key: string; value: string }[],
      updatedAt: document.updatedAt,
    };
  }

  return {
    key: document._id,
    businessId: document.businessId,
    kind: "room_night",
    roomTypeId: document.roomTypeId ?? "",
    localNight: document.localNight ?? "",
    revision: document.revision,
    totalCapacity: document.totalCapacity ?? 0,
    allocatedCapacity: document.allocatedCapacity ?? 0,
    metadata: document.metadata as { key: string; value: string }[],
    updatedAt: document.updatedAt,
  };
}

function buildAvailability(records: InventoryDocument[]): PublicBusiness["availability"] {
  return records.flatMap<PublicBusiness['availability'][number]>(record => {
    if (!record.published) return [];
    if (record.kind === 'sellable_variant') {
      if (record.remainingUnits == null || !record.offeringId || !record.variantId) return [];
      return [{ kind: record.kind, offeringId: record.offeringId, variantId: record.variantId,
        availableUnits: record.remainingUnits, updatedAt: record.updatedAt }];
    }
    if (record.totalCapacity == null || record.allocatedCapacity == null) return [];
    const available = record.totalCapacity - record.allocatedCapacity;
    if (record.kind === 'restaurant_slot') {
      if (!record.slotId || !record.slotDate || !record.startTime || !record.endTime || record.minPartySize == null || record.maxPartySize == null) return [];
      return [{ kind: record.kind, slotId: record.slotId, slotDate: record.slotDate, startTime: record.startTime,
        endTime: record.endTime, availableSeats: available, minPartySize: record.minPartySize,
        maxPartySize: record.maxPartySize, updatedAt: record.updatedAt }];
    }
    if (record.kind !== 'room_night' || !record.roomTypeId || !record.localNight) return [];
    return [{ kind: record.kind, roomTypeId: record.roomTypeId, localNight: record.localNight,
      availableRooms: available, updatedAt: record.updatedAt }];
  }).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function assertOwnerScope(principal: Principal, ownerId: string): void {
  if (principal.role !== "owner" || principal.userId !== ownerId) {
    throw new RelayError("FORBIDDEN", "Private business drafts are scoped to the owning principal.");
  }
}

function assertOfferingRefs(draft: BusinessDraft): Map<string, OfferingInput> {
  const offeringById = new Map<string, OfferingInput>();

  for (const offering of draft.offerings) {
    offeringById.set(offering.id, offering);
  }

  for (const inventory of draft.inventoryEdits) {
    if (inventory.kind === "sellable_variant") {
      const offering = offeringById.get(inventory.offeringId);
      if (!offering || (offering.kind !== "menu_item" && offering.kind !== "product")) {
        throw new RelayError("VALIDATION_ERROR", `Published inventory references an unknown offering: ${inventory.offeringId}`);
      }
      const hasVariant = offering.variants.some((variant) => variant.id === inventory.variantId);
      if (!hasVariant) {
        throw new RelayError("VALIDATION_ERROR", `Published inventory references an unknown variant: ${inventory.variantId}`);
      }
    }

    if (inventory.kind === "room_night") {
      const offering = offeringById.get(inventory.roomTypeId);
      if (!offering || offering.kind !== "room_type") {
        throw new RelayError("VALIDATION_ERROR", `Published inventory references an unknown room type: ${inventory.roomTypeId}`);
      }
    }
  }

  return offeringById;
}

// Only these published fields may cross the public read boundary.
const publishedBusinessFields = 'relayBusinessId relayCategory relayRevision relayProfile relayPublishedAt relayUpdatedAt -_id';
const publishedBusinessFilter = {
  relayBusinessId: { $type: 'string' as const }, relayRevision: { $gte: 1 },
  relayCategory: { $in: ['restaurant', 'hotel', 'shop'] as const },
  relayPublishedAt: { $type: 'string' as const }, relayProfile: { $type: 'object' as const },
};

function projectProfile(p: BusinessProfile): BusinessProfile {
  const c = p.categoryConfig;
  const range = (r: { startTime: string; endTime: string } | undefined) => r ? { startTime: r.startTime, endTime: r.endTime } : undefined;
  return {
    name: p.name, address: p.address, description: p.description,
    contact: { ...(p.contact.email !== undefined ? { email: p.contact.email } : {}), ...(p.contact.phone !== undefined ? { phone: p.contact.phone } : {}), ...(p.contact.websiteUrl !== undefined ? { websiteUrl: p.contact.websiteUrl } : {}) },
    timezone: p.timezone, currency: p.currency, finalPriceDescription: p.finalPriceDescription, policies: p.policies,
    openingHours: p.openingHours.map(h => ({ day: h.day, intervals: h.intervals.map(i => ({ startTime: i.startTime, endTime: i.endTime })) })),
    serviceHours: p.serviceHours.map(h => ({ id: h.id, label: h.label, days: h.days, startTime: h.startTime, endTime: h.endTime })),
    categoryConfig: c.kind === 'restaurant' ? { kind: c.kind, cuisine: c.cuisine, amenities: c.amenities, ...(c.reservationPolicy !== undefined ? { reservationPolicy: c.reservationPolicy } : {}) }
      : c.kind === 'hotel' ? { kind: c.kind, amenities: c.amenities, ...(c.checkInWindow ? { checkInWindow: range(c.checkInWindow) } : {}), ...(c.checkOutWindow ? { checkOutWindow: range(c.checkOutWindow) } : {}) }
      : { kind: c.kind, amenities: c.amenities, ...(c.pickupNotes !== undefined ? { pickupNotes: c.pickupNotes } : {}) },
  };
}

function projectOffering(o: OfferingInput): OfferingInput {
  const metadata = (entries: { key: string; value: string }[]) => entries.map(e => ({ key: e.key, value: e.value }));
  const money = (m: { amountMinor: number; currency: string }) => ({ amountMinor: m.amountMinor, currency: m.currency });
  const common = { id: o.id, active: o.active, name: o.name, ...(o.description !== undefined ? { description: o.description } : {}), metadata: metadata(o.metadata) };
  return o.kind === 'room_type' ? { ...common, kind: o.kind, maxGuests: o.maxGuests, nightlyRate: money(o.nightlyRate) }
    : { ...common, kind: o.kind, variants: o.variants.map(v => ({ id: v.id, name: v.name, ...(v.description !== undefined ? { description: v.description } : {}), unitPrice: money(v.unitPrice), metadata: metadata(v.metadata) })) };
}

function toPublicBusiness(document: {
  relayBusinessId?: string;
  relayCategory?: string;
  relayRevision?: number;
  relayProfile?: unknown;
  relayPublishedAt?: string;
  relayUpdatedAt?: string;
}, offerings: OfferingDocument[], inventory: InventoryDocument[]): PublicBusiness {
  return publicBusinessSchema.parse({
    businessId: document.relayBusinessId,
    category: document.relayCategory,
    revision: document.relayRevision,
    profile: projectProfile(document.relayProfile as BusinessProfile),
    offerings: offerings.filter((entry) => entry.published).map((entry) => projectOffering(entry.payload as OfferingInput)),
    availability: buildAvailability(inventory),
    publishedAt: document.relayPublishedAt,
    updatedAt: document.relayUpdatedAt,
  });
}

export class MongoCatalogRepository implements CatalogRepository {
  private readonly drafts;

  private readonly businesses;

  private readonly offerings;

  private readonly inventory;

  constructor(private readonly connection: Connection) {
    this.drafts = getBusinessDraftModel(connection);
    this.businesses = getBusinessModel(connection);
    this.offerings = getOfferingModel(connection);
    this.inventory = getInventoryModel(connection);
  }

  async getDraft(ownerId: string, draftId: string, tx?: ClientSession): Promise<BusinessDraft | null> {
    const document = await this.drafts.findOne({ _id: draftId, ownerId }).session(tx ?? null).lean();
    return document ? parseDraft(document) : null;
  }

  async listDrafts(ownerId: string, offset: number, limit: number): Promise<BusinessDraft[]> {
    const documents = await this.drafts.find({ ownerId })
      .sort({ updatedAt: -1, _id: 1 })
      .skip(boundOffset(offset))
      .limit(boundLimit(limit))
      .lean();

    return documents.map((document) => parseDraft(document));
  }

  async insertDraft(draft: BusinessDraft): Promise<void> {
    const parsed = businessDraftSchema.parse(draft);
    await this.drafts.create({
      _id: parsed.id,
      businessId: parsed.businessId,
      ownerId: parsed.ownerId,
      category: parsed.category,
      revision: parsed.revision,
      baseBusinessRevision: parsed.baseBusinessRevision,
      profile: parsed.profile,
      offerings: parsed.offerings,
      inventoryEdits: parsed.inventoryEdits,
      auditTrail: parsed.auditTrail,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    });
  }

  async replaceDraft(draft: BusinessDraft, expectedRevision: number): Promise<boolean> {
    const parsed = businessDraftSchema.parse(draft);
    const result = await this.drafts.updateOne(
      { _id: parsed.id, ownerId: parsed.ownerId, revision: expectedRevision },
      {
        $set: {
          businessId: parsed.businessId,
          category: parsed.category,
          revision: parsed.revision,
          baseBusinessRevision: parsed.baseBusinessRevision,
          profile: parsed.profile,
          offerings: parsed.offerings,
          inventoryEdits: parsed.inventoryEdits,
          auditTrail: parsed.auditTrail,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        },
      },
    );

    return result.modifiedCount === 1;
  }

  async fencePublished(businessId: string, expectedRevision: number, tx: ClientSession): Promise<boolean> {
    // An actual write shares publication's document lock without changing public terms/freshness.
    const result = await this.businesses.updateOne(
      { ...publishedBusinessFilter, relayBusinessId: businessId, relayRevision: expectedRevision },
      { $inc: { relayCommitFence: 1 } }, { session: tx, timestamps: false },
    );
    return result.modifiedCount === 1;
  }

  async fenceDraft(ownerId: string, draftId: string, expectedRevision: number, tx: ClientSession): Promise<boolean> {
    const result = await this.drafts.updateOne(
      { _id: draftId, ownerId, revision: expectedRevision },
      { $inc: { publicationFence: 1 } }, { session: tx },
    );
    return result.modifiedCount === 1;
  }

  async getPublished(businessId: string, tx?: ClientSession): Promise<PublicBusiness | null> {
    const business = await this.businesses.findOne({ ...publishedBusinessFilter, relayBusinessId: businessId }).select(publishedBusinessFields).session(tx ?? null).lean();
    if (!business?.relayBusinessId) {
      return null;
    }

    const offerings = await this.offerings.find({ businessId, published: true }).select("payload published -_id").sort({ offeringId: 1 }).session(tx ?? null).lean();
    const inventory = await this.inventory.find({ businessId, published: true }).select("kind offeringId variantId remainingUnits slotId slotDate startTime endTime totalCapacity allocatedCapacity minPartySize maxPartySize roomTypeId localNight updatedAt published -_id").sort({ _id: 1 }).session(tx ?? null).lean();

    return toPublicBusiness(business, offerings, inventory);
  }

  async searchPublished(query: BusinessQuery): Promise<BusinessPage> {
    const parsed = businessQuerySchema.parse(query);
    const filter: Record<string, unknown> = {
      ...publishedBusinessFilter,
    };

    if (parsed.category) {
      filter.relayCategory = parsed.category;
    }

    if (parsed.text) {
      const pattern = new RegExp(escapeRegex(parsed.text), "i");
      filter.$or = [{ "relayProfile.name": pattern }, { "relayProfile.description": pattern }];
    }

    if (parsed.addressText) {
      filter["relayProfile.address"] = new RegExp(escapeRegex(parsed.addressText), "i");
    }

    if (parsed.amenities.length > 0) {
      filter["relayProfile.categoryConfig.amenities"] = { $all: parsed.amenities };
    }

    const [total, documents] = await Promise.all([
      this.businesses.countDocuments(filter),
      this.businesses.find(filter).select(publishedBusinessFields)
        .sort({ relayUpdatedAt: -1, relayBusinessId: 1 })
        .skip(parsed.offset)
        .limit(parsed.limit)
        .lean(),
    ]);

    return businessPageSchema.parse({
      items: documents.map((document) => ({
        businessId: document.relayBusinessId,
        category: document.relayCategory,
        name: (document.relayProfile as { name?: string } | undefined)?.name,
        address: (document.relayProfile as { address?: string } | undefined)?.address,
        description: (document.relayProfile as { description?: string } | undefined)?.description,
        currency: (document.relayProfile as { currency?: string } | undefined)?.currency,
        timezone: (document.relayProfile as { timezone?: string } | undefined)?.timezone,
        amenities: ((document.relayProfile as { categoryConfig?: { amenities?: string[] } } | undefined)?.categoryConfig?.amenities ?? []),
        revision: document.relayRevision,
        publishedAt: document.relayPublishedAt,
        updatedAt: document.relayUpdatedAt,
      })),
      offset: parsed.offset,
      limit: parsed.limit,
      total,
    });
  }

  async listOwnerBusinesses(ownerId: string): Promise<PublicBusiness[]> {
    const documents = await this.businesses.find({ ...publishedBusinessFilter, relayOwnerId: ownerId }).select("relayBusinessId -_id")
      .sort({ relayUpdatedAt: -1, relayBusinessId: 1 })
      .lean();

    const businesses = await Promise.all(documents.map(async (document) => this.getPublished(document.relayBusinessId ?? "")));
    return businesses.filter((business): business is PublicBusiness => business !== null);
  }

  async publish(draft: BusinessDraft, tx: ClientSession): Promise<{ businessId: string; revision: number }> {
    const parsedDraft = businessDraftSchema.parse(draft);
    assertOfferingRefs(parsedDraft);

    const existingBusiness = await this.businesses.findOne({ relayBusinessId: parsedDraft.businessId }).session(tx).lean();
    if (existingBusiness && existingBusiness.relayOwnerId !== parsedDraft.ownerId) {
      throw new RelayError("FORBIDDEN", "Business belongs to another owner.");
    }
    if ((existingBusiness?.relayRevision ?? 0) !== parsedDraft.baseBusinessRevision) {
      throw new RelayError("STALE_REVISION", "Business changed since this draft was created.");
    }
    const publicationRevision = parsedDraft.baseBusinessRevision + 1;
    const existingOfferingDocs = await this.offerings.find({ businessId: parsedDraft.businessId }).session(tx).lean();
    const existingInventoryDocs = await this.inventory.find({ businessId: parsedDraft.businessId }).session(tx).lean();

    const existingOfferings = new Map(existingOfferingDocs.map((document) => [document.offeringId, document]));
    const existingInventory = new Map(existingInventoryDocs.map((document) => [document._id, document]));
    const nowUpdatedAt = parsedDraft.updatedAt;

    for (const offering of parsedDraft.offerings) {
      const existing = existingOfferings.get(offering.id);
      const changed = !existing || stableStringify(existing.payload) !== stableStringify(offering) || !existing.published;
      const revision = existing ? (changed ? existing.revision + 1 : existing.revision) : 0;

      await this.offerings.updateOne(
        { businessId: parsedDraft.businessId, offeringId: offering.id },
        {
          $set: {
            category: parsedDraft.category,
            payload: offering,
            published: true,
            revision,
            updatedAt: nowUpdatedAt,
          },
        },
        { upsert: true, session: tx },
      );
    }

    for (const offering of existingOfferingDocs) {
      if (!parsedDraft.offerings.some((entry) => entry.id === offering.offeringId) && offering.published) {
        await this.offerings.updateOne(
          { businessId: offering.businessId, offeringId: offering.offeringId },
          { $set: { published: false, updatedAt: nowUpdatedAt } },
          { session: tx },
        );
      }
    }

    for (const inventory of parsedDraft.inventoryEdits) {
      const key = inventoryKeyForInput(parsedDraft.businessId, inventory);
      const existing = existingInventory.get(key);
      if ((existing && inventory.expectedRevision !== existing.revision)
        || (!existing && inventory.expectedRevision !== undefined)) {
        throw new RelayError("STALE_REVISION", `Inventory revision mismatch for ${key}`);
      }

      if (inventory.kind === "sellable_variant") {
        const changed = !existing
          || existing.kind !== inventory.kind
          || existing.offeringId !== inventory.offeringId
          || existing.variantId !== inventory.variantId
          || (existing.remainingUnits ?? 0) !== inventory.remainingUnits
          || stableStringify(existing.metadata) !== stableStringify(inventory.metadata)
          || !existing.published;
        const revision = existing ? (changed ? existing.revision + 1 : existing.revision) : 0;
        await this.inventory.updateOne(
          { _id: key },
          {
            $set: {
              businessId: parsedDraft.businessId,
              sourceInventoryId: inventory.id,
              kind: inventory.kind,
              offeringId: inventory.offeringId,
              variantId: inventory.variantId,
              revision,
              published: true,
              remainingUnits: inventory.remainingUnits,
              metadata: inventory.metadata,
              updatedAt: nowUpdatedAt,
            },
            $unset: {
              slotId: 1,
              slotDate: 1,
              startTime: 1,
              endTime: 1,
              roomTypeId: 1,
              localNight: 1,
              totalCapacity: 1,
              allocatedCapacity: 1,
              minPartySize: 1,
              maxPartySize: 1,
            },
          },
          { upsert: true, session: tx },
        );
        continue;
      }

      if (inventory.kind === "restaurant_slot") {
        const allocatedCapacity = existing?.kind === inventory.kind ? (existing.allocatedCapacity ?? 0) : 0;
        if (inventory.totalSeats < allocatedCapacity) {
          throw new RelayError("UNAVAILABLE", `Slot ${inventory.id} cannot reduce below existing allocations.`);
        }
        const changed = !existing
          || existing.kind !== inventory.kind
          || existing.slotId !== inventory.id
          || existing.slotDate !== inventory.slotDate
          || existing.startTime !== inventory.startTime
          || existing.endTime !== inventory.endTime
          || (existing.totalCapacity ?? 0) !== inventory.totalSeats
          || (existing.minPartySize ?? 0) !== inventory.minPartySize
          || (existing.maxPartySize ?? 0) !== inventory.maxPartySize
          || stableStringify(existing.metadata) !== stableStringify(inventory.metadata)
          || !existing.published;
        const revision = existing ? (changed ? existing.revision + 1 : existing.revision) : 0;
        await this.inventory.updateOne(
          { _id: key },
          {
            $set: {
              businessId: parsedDraft.businessId,
              sourceInventoryId: inventory.id,
              kind: inventory.kind,
              slotId: inventory.id,
              slotDate: inventory.slotDate,
              startTime: inventory.startTime,
              endTime: inventory.endTime,
              revision,
              published: true,
              totalCapacity: inventory.totalSeats,
              allocatedCapacity,
              minPartySize: inventory.minPartySize,
              maxPartySize: inventory.maxPartySize,
              metadata: inventory.metadata,
              updatedAt: nowUpdatedAt,
            },
            $unset: {
              offeringId: 1,
              variantId: 1,
              roomTypeId: 1,
              localNight: 1,
              remainingUnits: 1,
            },
          },
          { upsert: true, session: tx },
        );
        continue;
      }

      const allocatedCapacity = existing?.kind === inventory.kind ? (existing.allocatedCapacity ?? 0) : 0;
      if (inventory.totalRooms < allocatedCapacity) {
        throw new RelayError("UNAVAILABLE", `Room night ${inventory.id} cannot reduce below existing allocations.`);
      }
      const changed = !existing
        || existing.kind !== inventory.kind
        || existing.roomTypeId !== inventory.roomTypeId
        || existing.localNight !== inventory.localNight
        || (existing.totalCapacity ?? 0) !== inventory.totalRooms
        || stableStringify(existing.metadata) !== stableStringify(inventory.metadata)
        || !existing.published;
      const revision = existing ? (changed ? existing.revision + 1 : existing.revision) : 0;
      await this.inventory.updateOne(
        { _id: key },
        {
          $set: {
            businessId: parsedDraft.businessId,
            sourceInventoryId: inventory.id,
            kind: inventory.kind,
            roomTypeId: inventory.roomTypeId,
            localNight: inventory.localNight,
            revision,
            published: true,
            totalCapacity: inventory.totalRooms,
            allocatedCapacity,
            metadata: inventory.metadata,
            updatedAt: nowUpdatedAt,
          },
          $unset: {
            offeringId: 1,
            variantId: 1,
            slotId: 1,
            slotDate: 1,
            startTime: 1,
            endTime: 1,
            remainingUnits: 1,
            minPartySize: 1,
            maxPartySize: 1,
          },
        },
        { upsert: true, session: tx },
      );
    }

    // inventoryEdits is a delta: omitted rows retain live stock and allocations.
    const publishedOfferingDocs = await this.offerings.find({ businessId: parsedDraft.businessId, published: true }).session(tx).lean();
    const publishedInventoryDocs = await this.inventory.find({ businessId: parsedDraft.businessId, published: true }).session(tx).lean();
    const publishedAt = existingBusiness?.relayPublishedAt ?? nowUpdatedAt;
    const publicBusiness = toPublicBusiness({
      relayBusinessId: parsedDraft.businessId,
      relayCategory: parsedDraft.category,
      relayRevision: publicationRevision,
      relayProfile: parsedDraft.profile,
      relayPublishedAt: publishedAt,
      relayUpdatedAt: nowUpdatedAt,
    }, publishedOfferingDocs, publishedInventoryDocs);

    await this.businesses.updateOne(
      { relayBusinessId: parsedDraft.businessId },
      {
        $set: {
          relayBusinessId: publicBusiness.businessId,
          relayOwnerId: parsedDraft.ownerId,
          relayCategory: publicBusiness.category,
          relayRevision: publicBusiness.revision,
          relayProfile: publicBusiness.profile,
          relayPublishedAt: publicBusiness.publishedAt,
          relayUpdatedAt: publicBusiness.updatedAt,
          ownerId: existingBusiness?.ownerId ?? ownerObjectIdForRelayOwner(parsedDraft.ownerId),
          name: publicBusiness.profile.name,
          trustStatus: existingBusiness?.trustStatus ?? "pending",
          mcpProfile: {
            category: publicBusiness.category,
            cuisine: publicBusiness.profile.categoryConfig.kind === "restaurant"
              ? publicBusiness.profile.categoryConfig.cuisine
              : "relay",
            address: publicBusiness.profile.address,
            baseCapacity: 1,
            amenities: publicBusiness.profile.categoryConfig.amenities,
          },
        },
      },
      { upsert: true, session: tx },
    );

    return { businessId: publicBusiness.businessId, revision: publicBusiness.revision };
  }

  async getInventory(keys: string[], tx?: ClientSession): Promise<InventoryRecord[]> {
    if (keys.length === 0) {
      return [];
    }
    const documents = await this.inventory.find({ _id: { $in: keys } }).session(tx ?? null).lean();
    const byKey = new Map(documents.map((document) => [document._id, parseInventoryRecord(document)]));
    return keys.flatMap((key) => {
      const record = byKey.get(key);
      return record ? [record] : [];
    });
  }

  async applyAllocations(changes: AllocationChange[], tx: ClientSession): Promise<void> {
    const merged = new Map<string, number>();
    for (const change of changes) {
      merged.set(change.key, (merged.get(change.key) ?? 0) + change.delta);
    }

    for (const [key, delta] of merged.entries()) {
      if (delta === 0) {
        continue;
      }

      const current = await this.inventory.findById(key).session(tx).lean();
      if (!current) {
        throw new RelayError("UNAVAILABLE", `Inventory key not found: ${key}`);
      }

      if (current.kind === "sellable_variant") {
        const filter = delta > 0
          ? { _id: key, remainingUnits: { $gte: delta } }
          : { _id: key };
        const result = await this.inventory.updateOne(
          filter,
          { $inc: { remainingUnits: -delta, revision: 1 } },
          { session: tx },
        );
        if (result.modifiedCount !== 1) {
          throw new RelayError("UNAVAILABLE", `Inventory unavailable for ${key}`);
        }
        continue;
      }

      if (current.kind === "restaurant_slot" || current.kind === "room_night") {
        const filter = delta > 0
          ? {
              _id: key,
              $expr: {
                $gte: [
                  { $subtract: ["$totalCapacity", "$allocatedCapacity"] },
                  delta,
                ],
              },
            }
          : { _id: key, allocatedCapacity: { $gte: Math.abs(delta) } };
        const result = await this.inventory.updateOne(
          filter,
          { $inc: { allocatedCapacity: delta, revision: 1 } },
          { session: tx },
        );
        if (result.modifiedCount !== 1) {
          throw new RelayError("UNAVAILABLE", `Inventory unavailable for ${key}`);
        }
      }
    }
  }
}
