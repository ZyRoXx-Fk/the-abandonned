import mongoose, { Schema, type Connection, type Model } from 'mongoose';
import type { Principal } from '../schemas/relay.schema.js';

export interface ILinkToken {
  /** SHA-256 digest only. The existing token index is retained; legacy plaintext codes cannot pair. */
  token: string;
  role: Principal['role'];
  userId: string;
  isUsed: boolean;
  expiresAt: Date;
}
const linkTokenSchema = new Schema<ILinkToken>({
  token: { type: String, required: true, unique: true },
  role: { type: String, enum: ['owner', 'client'], required: true },
  userId: { type: String, required: true },
  isUsed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { versionKey: false });
// Legacy documents have no role/userId and are not eligible for pairing.
linkTokenSchema.index({ role: 1, userId: 1 }, { unique: true, partialFilterExpression: { role: { $type: 'string' }, userId: { $type: 'string' } } });
export function getLinkTokenModel(connection: Connection = mongoose.connection): Model<ILinkToken> {
  return connection.models.LinkToken as Model<ILinkToken> || connection.model<ILinkToken>('LinkToken', linkTokenSchema, 'link_tokens');
}
