import { createHash, randomUUID } from "node:crypto";
import type { ClientSession, Connection } from "mongoose";
import { getActionEventModel } from "../models/action-event.model.js";
import { getBusinessModel } from "../models/business.model.js";
import { getOrderModel } from "../models/order.model.js";
import { getReservationModel } from "../models/reservation.model.js";
import {
  actionRecordSchema,
  actionResultSchema,
  commitResultSchema,
  proposalRecordSchema,
  type ActionRecord,
  type ActionResult,
  type ActionSummary,
  type AllocationChange,
  type CommitResult,
  type ProposalRecord,
} from "../schemas/action.schema.js";
import type { Principal } from "../schemas/relay.schema.js";
import { inventoryKeyForRestaurantSlot, inventoryKeyForRoomNight, inventoryKeyForVariant } from "./catalog.repository.js";
import { RelayError } from "../utils/relay-error.js";

export interface TransactionRepository {
  insertAction(principal: Principal, proposal: ProposalRecord, tx: ClientSession): Promise<ActionResult>;
  getCustomerAction(clientId: string, id: string, tx?: ClientSession): Promise<ActionResult | null>;
  getReservationRecord(clientId: string, id: string, tx?: ClientSession): Promise<ActionRecord | null>;
  listOwnerActions(ownerId: string, businessId: string, offset: number, limit: number): Promise<ActionResult[]>;
  amendReservation(clientId: string, id: string, expectedRevision: number, proposal: ProposalRecord, tx: ClientSession): Promise<ActionResult>;
  appendEvent(principal: Principal, proposal: ProposalRecord, result: CommitResult, tx: ClientSession): Promise<void>;
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

function createActionId(prefix: "ord" | "res"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function createReference(prefix: "ORD" | "RSV"): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function paymentStatusFor(kind: ActionResult["kind"]): ActionResult["paymentStatus"] {
  return kind === "restaurant_booking" ? "not_applicable" : "not_collected_demo";
}

function buildActionResultFromSummary(summary: ActionSummary, id: string, reference: string, revision: number): ActionResult {
  return actionResultSchema.parse({
    id,
    reference,
    kind: summary.kind,
    revision,
    status: "confirmed",
    paymentStatus: paymentStatusFor(summary.kind),
    summary,
  });
}

function buildActionResult(proposal: ProposalRecord, id: string, reference: string, revision: number): ActionResult {
  const parsed = proposalRecordSchema.parse(proposal);

  if (parsed.kind === "order" || parsed.kind === "restaurant_booking" || parsed.kind === "hotel_booking") {
    return buildActionResultFromSummary(parsed.summary, id, reference, revision);
  }

  throw new RelayError("VALIDATION_ERROR", "Only customer action proposals can create new action records.");
}

function mergeAllocations(changes: AllocationChange[]): AllocationChange[] {
  const merged = new Map<string, number>();
  for (const change of changes) {
    merged.set(change.key, (merged.get(change.key) ?? 0) + change.delta);
  }
  return [...merged.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([key, delta]) => ({ key, delta }));
}

function buildAllocations(proposal: ProposalRecord): AllocationChange[] {
  const parsed = proposalRecordSchema.parse(proposal);

  if (parsed.kind === "order") {
    return mergeAllocations(parsed.summary.items.map((item) => ({
      key: inventoryKeyForVariant(parsed.summary.businessId, item.offeringId, item.variantId),
      delta: item.quantity,
    })));
  }

  if (parsed.kind === "restaurant_booking") {
    return [{
      key: inventoryKeyForRestaurantSlot(parsed.summary.businessId, parsed.summary.slotId),
      delta: parsed.summary.partySize,
    }];
  }

  if (parsed.kind === "hotel_booking") {
    return parsed.summary.nights.map((night) => ({
      key: inventoryKeyForRoomNight(parsed.summary.businessId, parsed.summary.roomTypeId, night),
      delta: 1,
    }));
  }

  throw new RelayError("VALIDATION_ERROR", "Only customer action proposals can allocate inventory.");
}

function buildAmendedResult(existing: ActionResult, proposal: ProposalRecord, revision: number): ActionResult {
  const parsed = proposalRecordSchema.parse(proposal);
  if (parsed.kind !== "reservation_amendment") {
    throw new RelayError("VALIDATION_ERROR", "Reservation amendment proposal expected.");
  }

  if (existing.kind === "order") {
    throw new RelayError("VALIDATION_ERROR", "Orders cannot be amended as reservations.");
  }
  if (existing.kind !== parsed.summary.summary.kind) {
    throw new RelayError("VALIDATION_ERROR", "Reservation category cannot change during amendment.");
  }

  if (existing.kind === "restaurant_booking") {
    const amendmentSummary = parsed.summary.summary;
    if (amendmentSummary.kind !== "restaurant_booking") {
      throw new RelayError("VALIDATION_ERROR", "Reservation category cannot change during amendment.");
    }
    if (existing.summary.businessId !== amendmentSummary.businessId) {
      throw new RelayError("VALIDATION_ERROR", "Restaurant amendment businessId must match the persisted reservation.");
    }

    return buildActionResultFromSummary({
      kind: "restaurant_booking",
      businessId: amendmentSummary.businessId,
      slotId: amendmentSummary.slotId,
      slotDate: amendmentSummary.slotDate,
      startTime: amendmentSummary.startTime,
      endTime: amendmentSummary.endTime,
      partySize: amendmentSummary.partySize,
      policies: amendmentSummary.policies,
      paymentNotice: amendmentSummary.paymentNotice,
    }, existing.id, existing.reference, revision);
  }

  if (existing.kind !== "hotel_booking") {
    throw new RelayError("VALIDATION_ERROR", "Only reservation actions can be amended.");
  }

  const amendmentSummary = parsed.summary.summary;
  if (amendmentSummary.kind !== "hotel_booking") {
    throw new RelayError("VALIDATION_ERROR", "Reservation category cannot change during amendment.");
  }

  const existingSummary = existing.summary;
  if (existingSummary.kind !== "hotel_booking") {
    throw new RelayError("VALIDATION_ERROR", "Only hotel reservations can reach this amendment branch.");
  }
  if (existingSummary.businessId !== amendmentSummary.businessId) {
    throw new RelayError("VALIDATION_ERROR", "Hotel amendment businessId must match the persisted reservation.");
  }
  if (existingSummary.roomTypeId !== amendmentSummary.roomTypeId) {
    throw new RelayError("VALIDATION_ERROR", "Hotel amendment roomTypeId is immutable in phase 1.");
  }

  return buildActionResultFromSummary({
    kind: "hotel_booking",
    businessId: amendmentSummary.businessId,
    roomTypeId: amendmentSummary.roomTypeId,
    checkIn: amendmentSummary.checkIn,
    checkOut: amendmentSummary.checkOut,
    nights: amendmentSummary.nights,
    guests: amendmentSummary.guests,
    nightlyRate: amendmentSummary.nightlyRate,
    totalPrice: amendmentSummary.totalPrice,
    chargeDescription: amendmentSummary.chargeDescription,
    policies: amendmentSummary.policies,
    paymentNotice: amendmentSummary.paymentNotice,
  }, existing.id, existing.reference, revision);
}

function buildAmendmentAllocations(result: ActionResult): AllocationChange[] {
  const summary = result.summary;

  if (summary.kind === "restaurant_booking") {
    return [{
      key: inventoryKeyForRestaurantSlot(summary.businessId, summary.slotId),
      delta: summary.partySize,
    }];
  }

  if (summary.kind === "hotel_booking") {
    return summary.nights.map((night: string) => ({
      key: inventoryKeyForRoomNight(summary.businessId, summary.roomTypeId, night),
      delta: 1,
    }));
  }

  throw new RelayError("VALIDATION_ERROR", "Only reservation actions can be amended.");
}

function durableRefFor(result: CommitResult): string {
  if (result.kind === "publication") {
    return `pub_${createHash("sha256").update(`${result.businessId}|${result.revision}`).digest("hex").slice(0, 24)}`;
  }
  return result.id;
}

export class MongoTransactionRepository implements TransactionRepository {
  private readonly businesses;

  private readonly orders;

  private readonly reservations;

  private readonly events;

  constructor(private readonly connection: Connection) {
    this.businesses = getBusinessModel(connection);
    this.orders = getOrderModel(connection);
    this.reservations = getReservationModel(connection);
    this.events = getActionEventModel(connection);
  }

  private async lookupOwnerId(businessId: string, tx: ClientSession): Promise<string> {
    const business = await this.businesses.findOne({ relayBusinessId: businessId }).session(tx).lean();
    const ownerId = business?.relayOwnerId;
    if (!ownerId) {
      throw new RelayError("NOT_FOUND", `Published business not found: ${businessId}`);
    }
    return ownerId;
  }

  async insertAction(principal: Principal, proposal: ProposalRecord, tx: ClientSession): Promise<ActionResult> {
    const parsed = proposalRecordSchema.parse(proposal);
    if (parsed.kind !== "order" && parsed.kind !== "restaurant_booking" && parsed.kind !== "hotel_booking") {
      throw new RelayError("VALIDATION_ERROR", "insertAction only accepts customer action proposals.");
    }

    const ownerId = await this.lookupOwnerId(parsed.summary.businessId, tx);
    const id = createActionId(parsed.kind === "order" ? "ord" : "res");
    const reference = createReference(parsed.kind === "order" ? "ORD" : "RSV");
    const result = buildActionResult(parsed, id, reference, 0);
    const allocations = buildAllocations(parsed);
    const timestamp = new Date().toISOString();

    if (parsed.kind === "order") {
      await this.orders.create([{
        _id: result.id,
        reference: result.reference,
        ownerId,
        clientId: principal.userId,
        businessId: parsed.summary.businessId,
        proposalId: parsed.id,
        revision: result.revision,
        result,
        allocations,
        createdAt: timestamp,
        updatedAt: timestamp,
      }], { session: tx });
      return result;
    }

    await this.reservations.create([{
      _id: result.id,
      reference: result.reference,
      ownerId,
      clientId: principal.userId,
      businessId: parsed.summary.businessId,
      proposalId: parsed.id,
      revision: result.revision,
      kind: result.kind,
      result,
      allocations,
      createdAt: timestamp,
      updatedAt: timestamp,
    }], { session: tx });
    return result;
  }

  async getCustomerAction(clientId: string, id: string, tx?: ClientSession): Promise<ActionResult | null> {
    const order = await this.orders.findOne({ _id: id, clientId }).session(tx ?? null).lean();
    const reservation = await this.reservations.findOne({ _id: id, clientId }).session(tx ?? null).lean();

    const result = order?.result ?? reservation?.result;
    return result ? actionResultSchema.parse(result) : null;
  }

  async getReservationRecord(clientId: string, id: string, tx?: ClientSession): Promise<ActionRecord | null> {
    const document = await this.reservations.findOne({ _id: id, clientId }).session(tx ?? null).lean();
    if (!document) {
      return null;
    }

    return actionRecordSchema.parse({
      clientId: document.clientId,
      businessId: document.businessId,
      proposalId: document.proposalId,
      result: document.result,
      allocations: document.allocations,
    });
  }

  async listOwnerActions(ownerId: string, businessId: string, offset: number, limit: number): Promise<ActionResult[]> {
    const boundedOffset = boundOffset(offset);
    const boundedLimit = boundLimit(limit);
    const fetchSize = boundedOffset + boundedLimit;
    const [orders, reservations] = await Promise.all([
      this.orders.find({ ownerId, businessId }).select("result createdAt -_id").sort({ createdAt: -1, _id: -1 }).limit(fetchSize).lean(),
      this.reservations.find({ ownerId, businessId }).select("result createdAt -_id").sort({ createdAt: -1, _id: -1 }).limit(fetchSize).lean(),
    ]);

    return [...orders.map((document) => ({ createdAt: document.createdAt, result: document.result })), ...reservations.map((document) => ({ createdAt: document.createdAt, result: document.result }))]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(boundedOffset, boundedOffset + boundedLimit)
      .map((entry) => actionResultSchema.parse(entry.result));
  }

  async amendReservation(clientId: string, id: string, expectedRevision: number, proposal: ProposalRecord, tx: ClientSession): Promise<ActionResult> {
    const existing = await this.reservations.findOne({ _id: id, clientId }).session(tx).lean();
    if (!existing) {
      throw new RelayError("NOT_FOUND", `Reservation not found: ${id}`);
    }

    const existingResult = actionResultSchema.parse(existing.result);
    const result = buildAmendedResult(existingResult, proposal, expectedRevision + 1);
    const allocations = buildAmendmentAllocations(result);
    const updateResult = await this.reservations.updateOne(
      { _id: id, clientId, revision: expectedRevision },
      {
        $set: {
          proposalId: proposal.id,
          revision: result.revision,
          kind: result.kind,
          result,
          allocations,
          updatedAt: new Date().toISOString(),
        },
      },
      { session: tx },
    );

    if (updateResult.modifiedCount !== 1) {
      throw new RelayError("STALE_REVISION", `Reservation revision mismatch for ${id}`);
    }

    return result;
  }

  async appendEvent(principal: Principal, proposal: ProposalRecord, result: CommitResult, tx: ClientSession): Promise<void> {
    const parsedProposal = proposalRecordSchema.parse(proposal);
    const parsedResult = commitResultSchema.parse(result);
    const businessId = parsedResult.kind === "publication" ? parsedResult.businessId : parsedResult.summary.businessId;

    await this.events.create([{
      principal,
      proposalId: parsedProposal.id,
      proposalKind: parsedProposal.kind,
      businessId,
      resultRef: durableRefFor(parsedResult),
      result: parsedResult,
      payload: parsedProposal.payload,
      summary: parsedProposal.summary,
      createdAt: new Date().toISOString(),
    }], { session: tx });
  }
}
