import { BusinessDraftService } from '../../src/services/business-draft.service.js';
import { PublicationService } from '../../src/services/publication.service.js';
import { createRelayMemory } from './relay-memory.js';
import type { Principal } from '../../src/schemas/relay.schema.js';

export const owner: Principal = { role: 'owner', userId: 'owner_one' };
export const other: Principal = { role: 'owner', userId: 'owner_two' };
export const profile = (kind: 'restaurant' | 'hotel' | 'shop') => ({
  name: 'Owner business', address: '1 Main Street', description: 'Owner supplied description',
  contact: { email: 'owner@example.com' }, timezone: 'Europe/Paris', currency: 'EUR',
  openingHours: [{ day: 'monday' as const, intervals: [{ startTime: '09:00', endTime: '18:00' }] }],
  serviceHours: [{ id: 'service', label: 'Service', days: ['monday' as const], startTime: '09:00', endTime: '18:00' }],
  finalPriceDescription: 'All taxes included', policies: ['Pickup only'],
  categoryConfig: kind === 'restaurant' ? { kind, cuisine: 'French' } : { kind },
});
export function services(storage: Pick<ReturnType<typeof createRelayMemory>, 'catalog' | 'proposals' | 'transactions' | 'uow'>) {
  let id = 0;
  let now = new Date('2027-01-01T00:00:00Z');
  const clock = () => now;
  const ids = () => `relay_${++id}`;
  return { drafts: new BusinessDraftService(storage.catalog, clock, ids),
    publication: new PublicationService(storage.catalog, storage.proposals, storage.transactions, storage.uow, clock, ids),
    expire: () => { now = new Date('2027-01-01T00:16:00Z'); } };
}


export const offering = (kind: 'restaurant' | 'hotel' | 'shop') => kind === 'hotel' ? { kind: 'room_type' as const, id: 'room', active: true, name: 'Double', maxGuests: 2, nightlyRate: { amountMinor: 10000, currency: 'EUR' }, metadata: [] } : { kind: kind === 'shop' ? 'product' as const : 'menu_item' as const, id: 'item', active: true, name: 'Item', variants: [{ id: 'variant', name: 'Standard', unitPrice: { amountMinor: 1000, currency: 'EUR' }, metadata: [] }], metadata: [] };
