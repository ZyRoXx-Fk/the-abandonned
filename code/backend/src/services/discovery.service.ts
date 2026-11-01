import type { CatalogRepository } from '../repositories/catalog.repository.js';
import type { TransactionRepository } from '../repositories/transaction.repository.js';
import { businessQuerySchema, type BusinessQuery, type BusinessPage, type PublicBusiness } from '../schemas/catalog.schema.js';
import type { ActionResult } from '../schemas/action.schema.js';
import { relayIdSchema, type Principal } from '../schemas/relay.schema.js';
import { RelayError } from '../utils/relay-error.js';
import { requireOwner } from './business-draft.service.js';

export class DiscoveryService {
  constructor(private readonly catalog: Pick<CatalogRepository, 'searchPublished' | 'getPublished' | 'listOwnerBusinesses'>,
    private readonly transactions: Pick<TransactionRepository, 'listOwnerActions'>) {}

  async search(query: BusinessQuery): Promise<BusinessPage> {
    return this.catalog.searchPublished(businessQuerySchema.parse(query));
  }

  async getBusiness(businessId: string): Promise<PublicBusiness> {
    const business = await this.catalog.getPublished(relayIdSchema.parse(businessId));
    if (!business) throw new RelayError('NOT_FOUND', 'Published business not found.');
    return business;
  }

  async listOwnerBusinesses(owner: Principal): Promise<PublicBusiness[]> {
    requireOwner(owner);
    return this.catalog.listOwnerBusinesses(owner.userId);
  }

  async listOwnerActions(owner: Principal, businessId: string, offset: number, limit: number): Promise<ActionResult[]> {
    requireOwner(owner);
    const page = businessQuerySchema.parse({ offset, limit });
    relayIdSchema.parse(businessId);
    const owned = await this.catalog.listOwnerBusinesses(owner.userId);
    if (!owned.some(b => b.businessId === businessId)) throw new RelayError('FORBIDDEN', 'Business is not owned by this principal.');
    return this.transactions.listOwnerActions(owner.userId, businessId, page.offset, page.limit);
  }
}
