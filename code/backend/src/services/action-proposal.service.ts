import { randomUUID } from 'node:crypto';
import type { CatalogRepository, InventoryRecord } from '../repositories/catalog.repository.js';
import { inventoryKeyForVariant, inventoryKeyForRestaurantSlot, inventoryKeyForRoomNight } from '../repositories/catalog.repository.js';
import type { ProposalRepository } from '../repositories/proposal.repository.js';
import { publicBusinessSchema, type PublicBusiness } from '../schemas/catalog.schema.js';
import { customerActionSchema, proposalRecordSchema, proposalViewSchema, type CustomerActionInput, type ActionSummary, type ProposalRecord, type ProposalView } from '../schemas/action.schema.js';
import { principalSchema, relayIdSchema, checkedMultiplyMinorUnits, checkedAddMinorUnits, type Clock, type Principal } from '../schemas/relay.schema.js';
import { enumerateNights } from '../utils/local-date.js';
import { RelayError } from '../utils/relay-error.js';

const pricedNotice = 'Human approval is required before confirmation. Demo only: payment is not collected; this is not a paid order or booking.';
const tableNotice = 'Human approval is required before confirmation. Free table booking; no payment is applicable (demo).';
function invalid(message: string): never { throw new RelayError('VALIDATION_ERROR', message); }
function unavailable(): never { throw new RelayError('UNAVAILABLE', 'Requested availability is unknown or insufficient.'); }
function parseInput(input: CustomerActionInput): CustomerActionInput {
  const parsed = customerActionSchema.safeParse(input);
  if (!parsed.success) invalid('Invalid customer action. Prices, identities and session fields are not accepted.');
  return parsed.data;
}
function stayNights(checkIn: string, checkOut: string): string[] {
  // Dates have already passed localDateSchema; count calendar days before allocating any arrays.
  const count = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
  if (count < 1 || count > 60) invalid('A stay must contain between 1 and 60 local nights.');
  return enumerateNights(checkIn, checkOut);
}
export function inventoryDemand(input: CustomerActionInput): Array<{ key: string; quantity: number }> {
  switch (input.kind) {
    case 'order': return input.items.map(i => ({ key: inventoryKeyForVariant(input.businessId, i.offeringId, i.variantId), quantity: i.quantity }));
    case 'restaurant_booking': return [{ key: inventoryKeyForRestaurantSlot(input.businessId, input.slotId), quantity: input.partySize }];
    case 'hotel_booking': return stayNights(input.checkIn, input.checkOut).map(n => ({ key: inventoryKeyForRoomNight(input.businessId, input.roomTypeId, n), quantity: 1 }));
  }
}

/** Pure current-catalog validation/pricing. Availability is an observation, never a reservation. */
export function priceAction(business: PublicBusiness, input: CustomerActionInput): ActionSummary {
  try {
    const action = parseInput(input);
    const parsed = publicBusinessSchema.safeParse(business);
    if (!parsed.success) invalid('Invalid published business terms.');
    const b = parsed.data;
    if (b.businessId !== action.businessId) invalid('Action must refer to the selected published business.');
    const common = { businessId: b.businessId, policies: b.profile.policies, paymentNotice: pricedNotice };
    if (action.kind === 'order') {
      if (b.category === 'hotel') invalid('This category does not support orders.');
      const seen = new Set<string>();
      const items = action.items.map(i => {
        const key = inventoryKeyForVariant(b.businessId, i.offeringId, i.variantId);
        // Reject duplicate keys, rather than comparing each demand independently with the same stock.
        if (seen.has(key)) invalid('Duplicate order lines are not accepted; combine quantities into one line.');
        seen.add(key);
        const o = b.offerings.find(o => o.id === i.offeringId);
        if (!o || o.kind !== (b.category === 'shop' ? 'product' : 'menu_item')) invalid('Unknown offering for this business/category.');
        if (!o.active) unavailable();
        const variant = o.variants.find(v => v.id === i.variantId);
        if (!variant) invalid('Unknown variant for this offering.');
        const stock = b.availability.find(a => a.kind === 'sellable_variant' && a.offeringId === i.offeringId && a.variantId === i.variantId);
        if (!stock || stock.kind !== 'sellable_variant' || stock.availableUnits < i.quantity) unavailable();
        return { ...i, name: variant.name, unitPrice: variant.unitPrice,
          lineTotal: { currency: b.profile.currency, amountMinor: checkedMultiplyMinorUnits(variant.unitPrice.amountMinor, i.quantity) } };
      });
      return { ...common, kind: 'order', items, pickupAt: action.pickupAt, chargeDescription: b.profile.finalPriceDescription,
        totalPrice: { currency: b.profile.currency, amountMinor: checkedAddMinorUnits(items.map(i => i.lineTotal.amountMinor)) } };
    }
    if (action.kind === 'restaurant_booking') {
      if (b.category !== 'restaurant') invalid('This category does not support table bookings.');
      const slot = b.availability.find(a => a.kind === 'restaurant_slot' && a.slotId === action.slotId);
      if (!slot || slot.kind !== 'restaurant_slot') unavailable();
      if (action.partySize < slot.minPartySize || action.partySize > slot.maxPartySize) invalid('Party size is outside the published slot limits.');
      if (slot.availableSeats < action.partySize) unavailable();
      const config = b.profile.categoryConfig;
      const policies = config.kind === 'restaurant' && config.reservationPolicy ? [...common.policies, config.reservationPolicy] : common.policies;
      return { ...common, policies, kind: 'restaurant_booking', slotId: slot.slotId, slotDate: slot.slotDate,
        startTime: slot.startTime, endTime: slot.endTime, partySize: action.partySize, paymentNotice: tableNotice };
    }
    if (b.category !== 'hotel') invalid('This category does not support hotel bookings.');
    const room = b.offerings.find(o => o.id === action.roomTypeId);
    if (!room || room.kind !== 'room_type') invalid('Unknown room type for this business.');
    if (!room.active) unavailable();
    if (action.guests > room.maxGuests) invalid('Guest count exceeds the room capacity.');
    const nights = stayNights(action.checkIn, action.checkOut);
    for (const night of nights) {
      const stock = b.availability.find(a => a.kind === 'room_night' && a.roomTypeId === room.id && a.localNight === night);
      if (!stock || stock.kind !== 'room_night' || stock.availableRooms < 1) unavailable();
    }
    return { ...common, kind: 'hotel_booking', roomTypeId: room.id, checkIn: action.checkIn, checkOut: action.checkOut,
      nights, guests: action.guests, nightlyRate: room.nightlyRate, chargeDescription: b.profile.finalPriceDescription,
      totalPrice: { currency: b.profile.currency, amountMinor: checkedMultiplyMinorUnits(room.nightlyRate.amountMinor, nights.length) } };
  } catch (error) {
    if (error instanceof RelayError) throw error;
    if (error instanceof RangeError) invalid(error.message);
    throw error;
  }
}

function localParts(instant: Date, timezone: string): { date: string; time: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}`, day: part('weekday').toLowerCase() };
}

/** Clock-free companion to priceAction: callers explicitly supply the captured current instant. */
export function validateActionTime(business: PublicBusiness, summary: ActionSummary, now: Date): void {
  const localNow = localParts(now, business.profile.timezone);
  if (summary.kind === 'order') {
    const pickup = new Date(summary.pickupAt);
    if (pickup.getTime() <= now.getTime()) invalid('Pickup must be in the future.');
    const local = localParts(pickup, business.profile.timezone);
    const opening = business.profile.openingHours.some(h => h.day === local.day && h.intervals.some(i => i.startTime <= local.time && local.time < i.endTime));
    const service = business.profile.serviceHours.some(h => h.days.some(day => day === local.day) && h.startTime <= local.time && local.time < h.endTime);
    if (!opening || !service) invalid('Pickup must be within local opening and service hours.');
  } else if (summary.kind === 'restaurant_booking') {
    if (`${summary.slotDate}T${summary.startTime}` <= `${localNow.date}T${localNow.time}`) invalid('Restaurant slot must start in the future.');
  } else if (summary.checkIn < localNow.date) invalid('Check-in cannot be in the local past.');
}

export function requireClient(client: Principal): void {
  const parsed = principalSchema.safeParse(client);
  if (!parsed.success) throw new RelayError('AUTH_REQUIRED', 'An authenticated client principal is required.');
  if (parsed.data.role !== 'client') throw new RelayError('FORBIDDEN', 'A client principal is required.');
}
function viewOf(record: ProposalRecord): ProposalView {
  const { principal: _principal, durableResultRef: _ref, ...view } = record;
  return proposalViewSchema.parse(view);
}
export function observedAvailability(rows: InventoryRecord[]): PublicBusiness['availability'] {
  return rows.map(i => i.kind === 'sellable_variant' ? { kind: i.kind, offeringId: i.offeringId, variantId: i.variantId, availableUnits: i.remainingUnits, updatedAt: i.updatedAt }
    : i.kind === 'room_night' ? { kind: i.kind, roomTypeId: i.roomTypeId, localNight: i.localNight, availableRooms: i.totalCapacity - i.allocatedCapacity, updatedAt: i.updatedAt }
      : { kind: i.kind, slotId: i.slotId, slotDate: i.slotDate, startTime: i.startTime, endTime: i.endTime, minPartySize: i.minPartySize, maxPartySize: i.maxPartySize, availableSeats: i.totalCapacity - i.allocatedCapacity, updatedAt: i.updatedAt });
}

export class ActionProposalService {
  constructor(private readonly catalog: CatalogRepository, private readonly proposals: ProposalRepository,
    private readonly clock: Clock = () => new Date(), private readonly ids: () => string = randomUUID) {}

  async prepare(client: Principal, input: CustomerActionInput): Promise<ProposalView> {
    requireClient(client);
    const action = parseInput(input);
    const now = this.clock();
    const business = await this.catalog.getPublished(action.businessId);
    if (!business) throw new RelayError('NOT_FOUND', 'Published business not found.');
    const demand = inventoryDemand(action);
    const rows = await this.catalog.getInventory(demand.map(d => d.key));
    // Do not infer inventory from capability flags or stale discovery projections.
    for (const d of demand) {
      const row = rows.find(i => i.key === d.key && i.businessId === action.businessId);
      if (!row || (row.kind === 'sellable_variant' ? row.remainingUnits : row.totalCapacity - row.allocatedCapacity) < d.quantity) unavailable();
    }
    const current = { ...business, availability: observedAvailability(rows) };
    const summary = priceAction(current, action);
    validateActionTime(current, summary, now);
    const proposal = proposalRecordSchema.parse({ id: this.ids(), principal: client, revision: 0, kind: action.kind,
      payload: action, summary, termsRevision: {
        // Publication is the authority for all prices/offerings/policies; no invented granular revisions.
        businessRevision: business.revision, offeringRevisions: [], inventoryRevisions: rows.map(i => ({ key: i.key, revision: i.revision })),
      }, expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), state: 'pending', durableResultRef: null });
    await this.proposals.insert(proposal);
    return viewOf(proposal);
  }

  async get(client: Principal, proposalId: string): Promise<ProposalView> {
    requireClient(client);
    if (!relayIdSchema.safeParse(proposalId).success) invalid('Invalid proposal ID.');
    const proposal = await this.proposals.get(proposalId);
    if (!proposal) throw new RelayError('NOT_FOUND', 'Proposal not found.');
    if (proposal.principal.role !== 'client' || proposal.principal.userId !== client.userId
      || !['order', 'restaurant_booking', 'hotel_booking', 'reservation_amendment'].includes(proposal.kind)) throw new RelayError('FORBIDDEN', 'Customer proposal access denied.');
    return viewOf(proposal);
  }
}
