import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRelayServer, type RelayDomainServices } from '../mcp/server-factory.js';
import { McpSessionManager } from '../utils/managers/mcp-session.manager.js';
import { LinkTokenService } from './link-token.service.js';
interface SessionTransport { transport: StreamableHTTPServerTransport; server: McpServer }
export class McpService {
  private readonly transports = new Map<string, SessionTransport>();
  private readonly pending = new Set<SessionTransport>();
  private closed = false;
  private readonly requestContext = new AsyncLocalStorage<ServerResponse>();
  constructor(private readonly sessions: McpSessionManager, private readonly pairing: LinkTokenService, private readonly domain: RelayDomainServices) {}
  async handleRequest(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    await this.cleanup();
    if (this.closed) { res.writeHead(503).end(); return; }
    const header = req.headers['mcp-session-id'];
    if (header !== undefined) {
      if (typeof header !== 'string' || !this.sessions.touch(header)) { res.writeHead(404).end(); return; }
      const entry = this.transports.get(header);
      if (!entry) { res.writeHead(404).end(); return; }
      res.once('finish', () => { if (res.statusCode >= 500) void this.remove(header); });
      if (req.method === 'GET') {
        res.once('close', () => {
          // SDK GET 200 is an accepted standalone SSE stream; rejected GETs are non-200.
          // SDK writeHead(headers) does not populate Node getHeader(), so use the status.
          if (res.headersSent && res.statusCode === 200) void this.remove(header);
        });
      }
      try { await this.requestContext.run(res, () => entry.transport.handleRequest(req, res, body)); }
      catch { await this.remove(header); if (!res.writableEnded) res.end(); }
      return;
    }
    if (req.method !== 'POST' || !isInitializeRequest(body)) { res.writeHead(400).end(); return; }
    let id: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: sessionId => {
        if (this.closed) throw new Error('Server is shutting down');
        id = sessionId;
        this.sessions.registerSession(sessionId, req.socket.remoteAddress || 'unknown');
        this.transports.set(sessionId, entry);
        this.pending.delete(entry);
      },
      onsessionclosed: async sessionId => { await this.remove(sessionId); },
    });
    const server = createRelayServer({ ...this.domain, pairing: this.pairing, sessions: this.sessions });
    const entry = { transport, server };
    this.pending.add(entry);
    res.once('finish', () => { if (id && res.statusCode >= 500) void this.remove(id); });
    try {
      await server.connect(transport);
      if (this.closed) throw new Error('Server is shutting down');
      // SDK owns onclose/onerror after connect; retain its handlers while removing our binding.
      const onclose = transport.onclose;
      transport.onclose = () => { onclose?.(); if (id) { this.sessions.removeSession(id); this.transports.delete(id); } this.pending.delete(entry); };
      const onerror = transport.onerror;
      transport.onerror = error => {
        onerror?.(error);
        const response = this.requestContext.getStore();
        // The SDK also reports ordinary HTTP validation errors through onerror before headers.
        // These are not transport failures. A 5xx finish or a post-header failure is terminal.
        if (id && (!response || response.headersSent)) void this.remove(id);
      };
      await this.requestContext.run(res, () => transport.handleRequest(req, res, body));
      if (!id) { this.pending.delete(entry); await server.close(); }
    } catch {
      this.pending.delete(entry);
      if (id) await this.remove(id); else await server.close();
      if (!res.writableEnded) { if (!res.headersSent) res.writeHead(500); res.end(); }
    }
  }
  private async remove(id: string): Promise<void> {
    this.sessions.removeSession(id);
    const entry = this.transports.get(id);
    this.transports.delete(id);
    if (entry) await entry.server.close();
  }
  async cleanup(): Promise<void> {
    for (const id of this.transports.keys()) if (!this.sessions.getSession(id)) await this.remove(id);
    this.pairing.cleanup();
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const id of this.transports.keys()) await this.remove(id);
    for (const entry of this.pending) await entry.server.close();
    this.pending.clear();
  }
  getStatus() { return { status: 'operational', activeSessions: this.sessions.getActiveCount() }; }
}
