import type { Clock, Principal } from '../../schemas/relay.schema.js';
import { Conflict, Forbidden, Unauthorized } from '../errors/http.error.js';
export interface ActiveMcpSession {
  readonly sessionId: string;
  principal: Principal | null;
  pairing: boolean;
  readonly ip: string;
  lastActiveAt: Date;
}
export const MCP_IDLE_MS = 30 * 60 * 1000;
export class McpSessionManager {
  private readonly sessions = new Map<string, ActiveMcpSession>();
  constructor(private readonly clock: Clock = () => new Date()) {}
  registerSession(sessionId: string, ip: string): void {
    if (this.sessions.has(sessionId)) throw new Conflict('Session already exists');
    this.sessions.set(sessionId, { sessionId, principal: null, pairing: false, ip, lastActiveAt: this.clock() });
  }
  getSession(sessionId: string): ActiveMcpSession | null {
    const session = this.sessions.get(sessionId);
    return session && this.clock().getTime() - session.lastActiveAt.getTime() < MCP_IDLE_MS ? session : null;
  }
  touch(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.lastActiveAt = this.clock(); return true;
  }
  beginPairing(sessionId: string): ActiveMcpSession {
    const session = this.getSession(sessionId);
    if (!session) throw new Unauthorized('Live session required');
    if (session.principal || session.pairing) throw new Conflict('Session already paired or pairing');
    session.pairing = true; return session;
  }
  bind(session: ActiveMcpSession, principal: Principal): void {
    if (this.getSession(session.sessionId) !== session || !session.pairing || session.principal) throw new Unauthorized('Live unpaired session required');
    session.principal = Object.freeze({ ...principal });
  }
  requirePrincipal(sessionId: string, role?: Principal['role']): Principal {
    const principal = this.getSession(sessionId)?.principal;
    if (!principal) throw new Unauthorized('Pair this session on the trusted website first');
    if (role && principal.role !== role) throw new Forbidden('Role not permitted');
    return { ...principal };
  }
  removeSession(sessionId: string): void { this.sessions.delete(sessionId); }
  getActiveCount(): number { return [...this.sessions.keys()].filter(id => this.getSession(id)).length; }
}
