import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpSessionManager } from '../../src/utils/managers/mcp-session.manager.js';
import { LinkTokenService } from '../../src/services/link-token.service.js';
import { McpService } from '../../src/services/mcp.service.js';
import { McpController } from '../../src/controllers/mcp.controller.js';
import { LinkTokenController } from '../../src/controllers/link-token.controller.js';
import { mcpRoutes } from '../../src/routes/mcp.routes.js';
import { linkTokenRoutes } from '../../src/routes/link-token.routes.js';
import type { PairingTokenRepository } from '../../src/repositories/link-token.repository.js';
import type { Principal, Clock } from '../../src/schemas/relay.schema.js';

export class MemoryTokens implements PairingTokenRepository {
  records = new Map<string, { token: string; principal: Principal; expiresAt: Date; isUsed: boolean }>();
  async replace(token: string, principal: Principal, expiresAt: Date) {
    this.records.set(`${principal.role}:${principal.userId}`, { token, principal, expiresAt, isUsed: false });
  }
  async consume(token: string, now: Date) {
    const record = [...this.records.values()].find(r => r.token === token && !r.isUsed && r.expiresAt > now);
    if (!record) return null;
    record.isUsed = true;
    return record.principal;
  }
  async release(token: string) {
    const record = [...this.records.values()].find(r => r.token === token);
    if (record) record.isUsed = false;
  }
}
export async function buildMcpTestApp(clock: Clock = () => new Date()) {
  const { default: Fastify } = await import('fastify');
  const cookie = (await import('@fastify/cookie')).default;
  const rateLimit = (await import('@fastify/rate-limit')).default;
  const http = Fastify({ logger: false, trustProxy: false });
  await http.register(cookie);
  await http.register(rateLimit, { global: false });
  const sessions = new McpSessionManager(clock);
  const tokens = new MemoryTokens();
  const pairing = new LinkTokenService(tokens, sessions, clock);
  const service = new McpService(sessions, pairing);
  await http.register(linkTokenRoutes, { prefix: '/api/auth/link-token', controller: new LinkTokenController(pairing) });
  await http.register(mcpRoutes, { controller: new McpController(service), service });
  await http.listen({ port: 0, host: '127.0.0.1' });
  const base = http.listeningOrigin;
  const clients: Client[] = [];
  return { app: http, sessions, tokens, pairing, service, base,
    async connect(path = '/mcp') {
      const client = new Client({ name: 'test', version: '1.0' });
      let notifyOpen!: () => void;
      const opened = new Promise<void>(resolve => { notifyOpen = resolve; });
      const transport = new StreamableHTTPClientTransport(new URL(path, base), {
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (init?.method === 'GET' && response.status === 200) notifyOpen();
          return response;
        },
      });
      clients.push(client);
      await client.connect(transport);
      await opened;
      return { client, transport };
    },
    async close() { for (const c of clients) await c.close(); await http.close(); },
  };
}
