import { randomUUID } from 'node:crypto';
import type { CatalogRepository } from '../repositories/catalog.repository.js';
import type { ProposalRepository } from '../repositories/proposal.repository.js';
import type { TransactionRepository } from '../repositories/transaction.repository.js';
import type { UnitOfWork } from '../repositories/unit-of-work.js';
import { publicBusinessSchema, type BusinessDraft, type DraftPreview, type PublicBusiness } from '../schemas/catalog.schema.js';
import { approvalSchema, proposalRecordSchema, proposalViewSchema, type ApprovalInput, type CommitResult } from '../schemas/action.schema.js';
import type { Clock, Principal } from '../schemas/relay.schema.js';
import { RelayError } from '../utils/relay-error.js';
import { requireOwner } from './business-draft.service.js';

function missingFields(draft: BusinessDraft): DraftPreview['missingFields'] {
  const parsed = publicBusinessSchema.safeParse({ businessId: draft.businessId, category: draft.category, revision: draft.revision,
    profile: draft.profile, offerings: draft.offerings, availability: [], publishedAt: draft.updatedAt, updatedAt: draft.updatedAt });
  const missing = parsed.success ? [] : parsed.error.issues.slice(0, 50).map(issue => ({ path: issue.path.join('.'),
    question: `Please provide or correct ${issue.path.join('.')}: ${issue.message}`.slice(0, 280) }));
  for (const [index, input] of draft.inventoryEdits.entries()) {
    if (input.kind === 'restaurant_slot') continue;
    const ref = input.kind === 'room_night' ? draft.offerings.find(o => o.id === input.roomTypeId && o.kind === 'room_type')
      : draft.offerings.find(o => o.id === input.offeringId && o.kind !== 'room_type' && o.variants.some(v => v.id === input.variantId));
    if (!ref) missing.push({ path: `inventoryEdits.${index}`, question: 'Which offering and sellable variant does this inventory belong to?' });
  }
  return missing.slice(0, 50);
}

function assertNonOverlappingSlots(draft: BusinessDraft, live: PublicBusiness | null): void {
  const slots = new Map((live?.availability ?? []).flatMap(i => i.kind === 'restaurant_slot' ? [[i.slotId, i] as const] : []));
  for (const i of draft.inventoryEdits) if (i.kind === 'restaurant_slot') slots.set(i.id, { ...i, slotId: i.id, availableSeats: i.totalSeats, updatedAt: draft.updatedAt });
  const all = [...slots.values()];
  if (all.some((a, index) => all.slice(index + 1).some(b => a.slotDate === b.slotDate && a.startTime < b.endTime && b.startTime < a.endTime))) {
    throw new RelayError('VALIDATION_ERROR', 'Restaurant slots must not overlap.');
  }
}

export class PublicationService {
  constructor(private readonly catalog: CatalogRepository, private readonly proposals: ProposalRepository,
    private readonly transactions: Pick<TransactionRepository, "appendEvent">, private readonly uow: UnitOfWork,
    private readonly clock: Clock = () => new Date(), private readonly ids: () => string = randomUUID) {}

  async preview(owner: Principal, draftId: string): Promise<DraftPreview> {
    requireOwner(owner);
    const draft = await this.catalog.getDraft(owner.userId, draftId);
    if (!draft) throw new RelayError('NOT_FOUND', 'Owned draft not found.');
    const missing = missingFields(draft);
    if (missing.length) return { draft, missingFields: missing, proposal: null };
    assertNonOverlappingSlots(draft, await this.catalog.getPublished(draft.businessId));
    const proposal = proposalRecordSchema.parse({ id: this.ids(), principal: owner, revision: draft.revision, kind: 'publication',
      payload: { kind: 'publication', draftId, businessId: draft.businessId },
      summary: { kind: 'publication', businessId: draft.businessId, category: draft.category, revision: draft.revision, name: draft.profile.name },
      termsRevision: { businessRevision: draft.baseBusinessRevision, offeringRevisions: [], inventoryRevisions: [] },
      expiresAt: new Date(this.clock().getTime() + 15 * 60_000).toISOString(), state: 'pending', durableResultRef: null });
    await this.proposals.insert(proposal);
    const { principal: _principal, durableResultRef: _ref, ...view } = proposal;
    return { draft, missingFields: [], proposal: proposalViewSchema.parse(view) };
  }

  async commit(owner: Principal, approval: ApprovalInput): Promise<CommitResult> {
    requireOwner(owner);
    const parsed = approvalSchema.safeParse(approval);
    if (!parsed.success) throw new RelayError('APPROVAL_REQUIRED', 'Explicit approved:true and the reviewed proposal revision are required.');
    return this.uow.run(async tx => {
      const proposal = await this.proposals.get(parsed.data.proposalId, tx);
      if (!proposal) throw new RelayError('NOT_FOUND', 'Proposal not found.');
      if (proposal.principal.role !== owner.role || proposal.principal.userId !== owner.userId) throw new RelayError('FORBIDDEN', 'Proposal belongs to another principal.');
      if (proposal.kind !== 'publication') throw new RelayError('VALIDATION_ERROR', 'Expected a publication proposal.');
      const approvedRevision = proposal.state === 'committed' ? proposal.revision - 1 : proposal.revision;
      if (approvedRevision !== parsed.data.revision) throw new RelayError('STALE_REVISION', 'Approval revision does not match the proposal.');
      if (proposal.state === 'committed') {
        const result = await this.proposals.getCommittedResult(proposal.id, tx);
        if (!result || result.kind !== 'publication') throw new RelayError('NOT_FOUND', 'Committed publication result is missing.');
        return result;
      }
      if (this.clock().getTime() >= Date.parse(proposal.expiresAt)) throw new RelayError('PROPOSAL_EXPIRED', 'Preview again and approve the new proposal.');
      if (!await this.catalog.fenceDraft(owner.userId, proposal.payload.draftId, proposal.summary.revision, tx)) throw new RelayError('STALE_REVISION', 'Draft changed since preview.');
      const draft = await this.catalog.getDraft(owner.userId, proposal.payload.draftId, tx);
      if (!draft || draft.businessId !== proposal.payload.businessId || draft.baseBusinessRevision !== proposal.termsRevision.businessRevision) throw new RelayError('STALE_REVISION', 'Publication draft changed.');
      if (missingFields(draft).length) throw new RelayError('VALIDATION_ERROR', 'Draft is incomplete.');
      assertNonOverlappingSlots(draft, await this.catalog.getPublished(draft.businessId, tx));
      const published = await this.catalog.publish(draft, tx);
      const result: CommitResult = { kind: 'publication', ...published };
      if (!await this.proposals.markCommitted(proposal.id, proposal.revision, result, tx)) throw new RelayError('STALE_REVISION', 'Proposal changed.');
      await this.transactions.appendEvent(owner, proposal, result, tx);
      return result;
    });
  }
}
