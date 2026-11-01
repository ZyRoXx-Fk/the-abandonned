import { randomBytes, createHash } from 'node:crypto';
import type { PairingTokenRepository } from '../repositories/link-token.repository.js';
import { McpSessionManager } from '../utils/managers/mcp-session.manager.js';
import type { Clock, Principal } from '../schemas/relay.schema.js';
import { BadRequest } from '../utils/errors/http.error.js';
export class LinkTokenService {
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly tokens: PairingTokenRepository, private readonly sessions: McpSessionManager, private readonly clock: Clock = () => new Date()) {}
  async generateForPrincipal(principal: Principal): Promise<{ token: string; expiresAt: Date; principal: Principal }> {
    const token = 'TRUST-' + randomBytes(16).toString('hex');
    const expiresAt = new Date(this.clock().getTime() + 15 * 60000);
    await this.tokens.replace(this.hash(token), principal, expiresAt);
    return { token, expiresAt, principal: { ...principal } };
  }
  async consumeForSession(token: string, sessionId: string, expectedRole?: Principal['role']): Promise<Principal> {
    this.cleanup();
    const session = this.sessions.getSession(sessionId);
    if (!session) throw new BadRequest('Live session required');
    const keys = [`session:${sessionId}`, `ip:${session.ip}`];
    const now = this.clock().getTime();
    for (const [index, key] of keys.entries()) {
      const bucket = this.failures.get(key);
      if (bucket && bucket.count >= (index === 0 ? 10 : 30)) throw new BadRequest('Too many pairing failures');
    }
    // Reserve before I/O; simultaneous failures cannot overrun either budget.
    const reservations = keys.map(key => {
      let bucket = this.failures.get(key);
      if (!bucket) { bucket = { count: 0, until: now + 60000 }; this.failures.set(key, bucket); }
      bucket.count++;
      return bucket;
    });
    const result = await this.consume(token, sessionId, expectedRole);
    for (const bucket of reservations) bucket.count--;
    return result;
  }
  cleanup(): void {
    for (const [key, bucket] of this.failures) {
      if (bucket.until <= this.clock().getTime() || (key.startsWith('session:') && !this.sessions.getSession(key.slice(8)))) this.failures.delete(key);
    }
  }
  private async consume(token: string, sessionId: string, expectedRole?: Principal['role']): Promise<Principal> {
    // Synchronous reservation precedes all I/O: competing codes cannot switch this session.
    const session = this.sessions.beginPairing(sessionId);
    const hash = this.hash(token);
    let consumed = false;
    try {
      const principal = await this.tokens.consume(hash, this.clock());
      if (!principal) throw new BadRequest('Invalid or expired pairing code');
      consumed = true;
      if (expectedRole && principal.role !== expectedRole) throw new BadRequest('Role not permitted');
      this.sessions.bind(session, principal);
      return { ...principal };
    } catch (error) {
      // Disconnect/expiry during the database operation must not burn an otherwise usable code.
      if (consumed) await this.tokens.release(hash);
      throw error;
    } finally { session.pairing = false; }
  }
  private hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}
