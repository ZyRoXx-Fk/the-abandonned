import { McpSessionInfo } from "../../schemas/mcp.schema.js";

export interface ActiveMcpSession {
  sessionId: string;
  ownerId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

export class McpSessionManager {
  private readonly sessions = new Map<string, ActiveMcpSession>();

  registerSession(sessionId: string): ActiveMcpSession {
    const session: ActiveMcpSession = {
      sessionId,
      ownerId: null,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): ActiveMcpSession | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = new Date();
      return session;
    }
    return null;
  }

  setSessionOwner(sessionId: string, ownerId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.ownerId = ownerId;
    session.lastActiveAt = new Date();
    return true;
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  getAllSessions(): McpSessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      ownerId: s.ownerId,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    }));
  }
}

export const mcpSessionManager = new McpSessionManager();

