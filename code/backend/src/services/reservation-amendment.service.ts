import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type { CatalogRepository } from '../repositories/catalog.repository.js';
import type { ProposalRepository } from '../repositories/proposal.repository.js';
import type { TransactionRepository } from '../repositories/transaction.repository.js';
import type { Principal, Clock } from '../schemas/relay.schema.js';
import { amendmentSchema, proposalRecordSchema, proposalViewSchema, type AmendmentInput, type ProposalView, type CustomerActionInput, type AllocationChange } from '../schemas/action.schema.js';
import { RelayError } from '../utils/relay-error.js';
import { inventoryDemand, observedAvailability, priceAction, requireClient, validateActionTime } from './action-proposal.service.js';

type ReservationReader = Pick<TransactionRepository, 'getReservationRecord'>;

/** Old allocations are persisted authority; credit only matching, currently known rows. */
export async function resolveAmendment(catalog: CatalogRepository, transactions: ReservationReader, client: Principal,
  input: AmendmentInput, now: Date, tx?: ClientSession, expectedBusinessRevision?: number) {
  const record = await transactions.getReservationRecord(client.userId, input.reservationId, tx);
  if (!record) throw new RelayError('NOT_FOUND', 'Reservation not found.');
  if (record.result.revision !== input.expectedReservationRevision) throw new RelayError('STALE_REVISION', 'Reservation revision changed.');
  const old = record.result.summary;
  let action: CustomerActionInput;
  if (input.kind === 'restaurant_booking' && old.kind === 'restaurant_booking') {
    action = { kind: input.kind, businessId: record.businessId, slotId: input.slotId, partySize: input.partySize };
  } else if (input.kind === 'hotel_booking' && old.kind === 'hotel_booking') {
    action = { kind: input.kind, businessId: record.businessId, roomTypeId: old.roomTypeId, checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests };
  } else throw new RelayError('VALIDATION_ERROR', 'Reservation category cannot change.');
  const business = await catalog.getPublished(record.businessId, tx);
  if (!business || (expectedBusinessRevision !== undefined && business.revision !== expectedBusinessRevision)) {
    throw new RelayError(expectedBusinessRevision === undefined ? 'NOT_FOUND' : 'TERMS_CHANGED', 'Published terms changed or are no longer available.');
  }
  const demand = inventoryDemand(action);
  const rows = (await catalog.getInventory(demand.map(d => d.key), tx)).filter(r => r.businessId === record.businessId);
  const oldAmounts = new Map<string, number>();
  for (const a of record.allocations) oldAmounts.set(a.key, (oldAmounts.get(a.key) ?? 0) + a.delta);
  const credited = rows.map(row => row.kind === 'sellable_variant' ? row : { ...row, allocatedCapacity: row.allocatedCapacity - (oldAmounts.get(row.key) ?? 0) });
  const summary = priceAction({ ...business, availability: observedAvailability(credited) }, action);
  validateActionTime(business, summary, now);
  const net = new Map<string, number>();
  for (const a of record.allocations) net.set(a.key, (net.get(a.key) ?? 0) - a.delta);
  for (const d of demand) net.set(d.key, (net.get(d.key) ?? 0) + d.quantity);
  const changes: AllocationChange[] = [...net].filter(([, delta]) => delta !== 0).map(([key, delta]) => ({ key, delta }));
  return { business, rows, summary, changes };
}

export class ReservationAmendmentService {
  constructor(private readonly catalog: CatalogRepository, private readonly proposals: ProposalRepository,
    private readonly transactions: ReservationReader, private readonly clock: Clock = () => new Date()) {}

  async prepare(client: Principal, input: AmendmentInput): Promise<ProposalView> {
    requireClient(client);
    const parsed = amendmentSchema.safeParse(input);
    if (!parsed.success) throw new RelayError('VALIDATION_ERROR', 'Invalid reservation amendment.');
    const now = this.clock();
    const { business, rows, summary } = await resolveAmendment(this.catalog, this.transactions, client, parsed.data, now);
    const record = proposalRecordSchema.parse({ id: `prop_${randomUUID().replace(/-/g, '')}`, principal: client, revision: 0,
      kind: 'reservation_amendment', payload: { kind: 'reservation_amendment', amendment: parsed.data },
      summary: { kind: 'reservation_amendment', summary: { ...summary, reservationId: parsed.data.reservationId, expectedReservationRevision: parsed.data.expectedReservationRevision } },
      termsRevision: { businessRevision: business.revision, offeringRevisions: [], inventoryRevisions: rows.map(r => ({ key: r.key, revision: r.revision })) },
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), state: 'pending', durableResultRef: null });
    await this.proposals.insert(record);
    return proposalViewSchema.parse({ payload: record.payload, id: record.id, revision: record.revision, kind: record.kind, summary: record.summary, termsRevision: record.termsRevision, expiresAt: record.expiresAt, state: record.state });
  }
}
