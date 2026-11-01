import type { Connection } from 'mongoose';
import { getLinkTokenModel } from '../models/link-token.model.js';
import type { Principal } from '../schemas/relay.schema.js';
export interface PairingTokenRepository {
  replace(tokenHash: string, principal: Principal, expiresAt: Date): Promise<void>;
  consume(tokenHash: string, now: Date): Promise<Principal | null>;
  release(tokenHash: string): Promise<void>;
}
export class LinkTokenRepository implements PairingTokenRepository {
  private readonly model;
  constructor(connection?: Connection) { this.model = getLinkTokenModel(connection); }
  async replace(tokenHash: string, principal: Principal, expiresAt: Date): Promise<void> {
    await this.model.init();
    const filter = { role: principal.role, userId: principal.userId };
    const update = { $set: { token: tokenHash, expiresAt, isUsed: false } };
    try {
      await this.model.updateOne(filter, update, { upsert: true });
    } catch (error) {
      // Concurrent first issuance can lose the unique-index upsert race. Replace the winning row.
      if ((error as { code?: number }).code !== 11000) throw error;
      await this.model.updateOne(filter, update);
    }
  }
  async consume(tokenHash: string, now: Date): Promise<Principal | null> {
    await this.model.init();
    const record = await this.model.findOneAndUpdate({
      token: tokenHash, isUsed: false, expiresAt: { $gt: now }, role: { $in: ['owner', 'client'] }, userId: { $type: 'string' },
    }, { $set: { isUsed: true } }, { returnDocument: 'after' }).lean();
    return record ? { role: record.role, userId: record.userId } : null;
  }
  async release(tokenHash: string): Promise<void> {
    // A replacement has a different digest, so it cannot be resurrected by a disconnected attempt.
    await this.model.updateOne({ token: tokenHash, isUsed: true }, { $set: { isUsed: false } });
  }
}
