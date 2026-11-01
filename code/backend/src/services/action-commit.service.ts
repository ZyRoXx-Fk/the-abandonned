import { isDeepStrictEqual } from 'node:util';
import type { CatalogRepository } from '../repositories/catalog.repository.js';
import type { ProposalRepository } from '../repositories/proposal.repository.js';
import type { TransactionRepository } from '../repositories/transaction.repository.js';
import type { UnitOfWork } from '../repositories/unit-of-work.js';
import type { Principal, Clock } from '../schemas/relay.schema.js';
import { relayIdSchema } from '../schemas/relay.schema.js';
import { approvalSchema, type ApprovalInput, type ActionResult, type CustomerActionInput, type AmendmentInput } from '../schemas/action.schema.js';
import { RelayError } from '../utils/relay-error.js';
import { ActionProposalService, inventoryDemand, observedAvailability, priceAction, requireClient, validateActionTime } from './action-proposal.service.js';
import { ReservationAmendmentService, resolveAmendment } from './reservation-amendment.service.js';

type ActionTransactions = Pick<TransactionRepository, 'insertAction' | 'getCustomerAction' | 'appendEvent' | 'getReservationRecord' | 'amendReservation'>;
export class ActionCommitService {
  constructor(private readonly catalog: CatalogRepository, private readonly proposals: ProposalRepository,
    private readonly transactions: ActionTransactions, private readonly uow: UnitOfWork,
    private readonly clock: Clock = () => new Date()) {}

  async commit(client: Principal, approval: ApprovalInput): Promise<ActionResult> {
    requireClient(client);
    const parsed = approvalSchema.safeParse(approval);
    if (!parsed.success) throw new RelayError('APPROVAL_REQUIRED', 'Explicit approved:true and the reviewed proposal revision are required.');
    // Retained only from the authorized pending proposal; never accept caller-supplied intent here.
    let changedIntent: CustomerActionInput | AmendmentInput | undefined;
    let changedAmendment = false;
    const run = () => this.uow.run(async tx => {
      const proposal = await this.proposals.get(parsed.data.proposalId, tx);
      if (!proposal) throw new RelayError('NOT_FOUND', 'Proposal not found.');
      if (proposal.principal.role !== client.role || proposal.principal.userId !== client.userId) throw new RelayError('FORBIDDEN', 'Proposal belongs to another principal.');
      if (proposal.kind !== 'order' && proposal.kind !== 'restaurant_booking' && proposal.kind !== 'hotel_booking' && proposal.kind !== 'reservation_amendment') throw new RelayError('VALIDATION_ERROR', 'Expected a customer action proposal.');
      const approvedRevision = proposal.state === 'committed' ? proposal.revision - 1 : proposal.revision;
      if (approvedRevision !== parsed.data.revision) throw new RelayError('STALE_REVISION', 'Approval revision does not match the proposal.');
      if (proposal.state === 'committed') {
        const result = await this.proposals.getCommittedResult(proposal.id, tx);
        if (!result || result.kind === 'publication' || (proposal.kind === 'reservation_amendment' ? result.kind !== proposal.payload.amendment.kind : result.kind !== proposal.kind)) throw new RelayError('NOT_FOUND', 'Committed action result is missing.');
        return result;
      }
      const now = this.clock();
      if (now.getTime() >= Date.parse(proposal.expiresAt)) throw new RelayError('PROPOSAL_EXPIRED', 'Prepare again and approve the new proposal.');
      if (proposal.kind === 'reservation_amendment') {
        try {
          const current = await resolveAmendment(this.catalog, this.transactions, client, proposal.payload.amendment, now, tx, proposal.termsRevision.businessRevision);
          const expected = { kind: 'reservation_amendment', summary: { ...current.summary,
            reservationId: proposal.payload.amendment.reservationId, expectedReservationRevision: proposal.payload.amendment.expectedReservationRevision } };
          if (!isDeepStrictEqual(expected, proposal.summary)) throw new RelayError('TERMS_CHANGED', 'Amendment terms changed.');
          if (!await this.catalog.fencePublished(current.business.businessId, current.business.revision, tx)) throw new RelayError('TERMS_CHANGED', 'Published terms changed.');
          await this.catalog.applyAllocations(current.changes, tx);
          const result = await this.transactions.amendReservation(client.userId, proposal.payload.amendment.reservationId,
            proposal.payload.amendment.expectedReservationRevision, proposal, tx);
          if (!await this.proposals.markCommitted(proposal.id, proposal.revision, result, tx)) throw new RelayError('STALE_REVISION', 'Proposal changed.');
          await this.transactions.appendEvent(client, proposal, result, tx);
          return result;
        } catch (error) {
          if (error instanceof RelayError && error.code === 'TERMS_CHANGED') { changedIntent = proposal.payload.amendment; changedAmendment = true; }
          throw error;
        }
      }
      const business = await this.catalog.getPublished(proposal.payload.businessId, tx);
      const termsChanged = (): never => {
        changedIntent = proposal.payload;
        throw new RelayError('TERMS_CHANGED', 'Published terms changed. Review and approve a fresh proposal.');
      };
      if (!business || business.revision !== proposal.termsRevision.businessRevision) termsChanged();
      // Inventory revision changes caused solely by consumption are not changed agreed terms.
      const demand = inventoryDemand(proposal.payload);
      const rows = await this.catalog.getInventory(demand.map(d => d.key), tx);
      const current = { ...business!, availability: observedAvailability(rows.filter(r => r.businessId === business!.businessId)) };
      const summary = priceAction(current, proposal.payload);
      if (!isDeepStrictEqual(summary, proposal.summary)) termsChanged();
      validateActionTime(current, summary, now);
      if (!await this.catalog.fencePublished(business!.businessId, business!.revision, tx)) termsChanged();
      await this.catalog.applyAllocations(demand.map(d => ({ key: d.key, delta: d.quantity })), tx);
      const result = await this.transactions.insertAction(client, proposal, tx);
      if (!await this.proposals.markCommitted(proposal.id, proposal.revision, result, tx)) throw new RelayError('STALE_REVISION', 'Proposal changed.');
      await this.transactions.appendEvent(client, proposal, result, tx);
      return result;
    });
    try {
      try { return await run(); }
      catch (error) {
        // A unique proposal collision may follow a concurrent winner. Re-enter the same
        // authorization/revision checks before reading only this principal's durable result.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) return await run();
        throw error;
      }
    } catch (error) {
      if (!(error instanceof RelayError) || error.code !== 'TERMS_CHANGED' || !changedIntent) throw error;
      const prepare = new ActionProposalService(this.catalog, this.proposals, this.clock);
      try {
        const replacementProposal = changedAmendment
          ? await new ReservationAmendmentService(this.catalog, this.proposals, this.transactions, this.clock).prepare(client, changedIntent as AmendmentInput)
          : await prepare.prepare(client, changedIntent as CustomerActionInput);
        throw new RelayError('TERMS_CHANGED', error.message, { nextAction: 'review_and_approve', replacementProposal, corrections: [] });
      } catch (replacementError) {
        if (!(replacementError instanceof RelayError) || replacementError.code === 'TERMS_CHANGED') throw replacementError;
        throw new RelayError('TERMS_CHANGED', error.message, { nextAction: 'review_and_approve', replacementProposal: null,
          corrections: [{ code: replacementError.code, message: replacementError.message, action: 'Select currently published offerings, future service times and sufficient availability, then prepare a new request.' }] });
      }
    }
  }

  async getAction(client: Principal, id: string): Promise<ActionResult> {
    requireClient(client);
    if (!relayIdSchema.safeParse(id).success) throw new RelayError('VALIDATION_ERROR', 'Invalid action ID.');
    const result = await this.transactions.getCustomerAction(client.userId, id);
    if (!result) throw new RelayError('NOT_FOUND', 'Customer action not found.');
    return result;
  }
}
