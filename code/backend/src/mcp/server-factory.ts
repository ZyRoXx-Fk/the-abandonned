import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pairSessionSchema } from '../schemas/mcp.schema.js';
import type { LinkTokenService } from '../services/link-token.service.js';
import type { McpSessionManager } from '../utils/managers/mcp-session.manager.js';
export interface RelayServerDependencies {
  pairing: LinkTokenService;
  sessions: McpSessionManager;
}
export function createRelayServer(deps: RelayServerDependencies): McpServer {
  const server = new McpServer({ name: 'the-abandonned', version: '1.0.0' });
  server.registerResource('system-health', 'system://health', {}, async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify({ status: 'operational' }) }] }));
  server.registerTool('pair_session', {
    description: 'Pair this connection as owner or client with a one-use code from the trusted website. Never send passwords or bearer tokens. You will need to validate the final request before any future action.',
    inputSchema: pairSessionSchema,
  }, async (args, extra) => {
    try {
      // Also parse explicitly: do not rely on a host accepting the published JSON Schema.
      const input = pairSessionSchema.parse(args);
      if (!extra.sessionId) throw new Error('Live session required');
      const principal = await deps.pairing.consumeForSession(input.token, extra.sessionId);
      deps.sessions.requirePrincipal(extra.sessionId);
      return { content: [{ type: 'text', text: JSON.stringify({ paired: true, role: principal.role }) }] };
    } catch (error) {
      const message = error instanceof Error && error.message === 'Too many pairing failures' ? error.message : 'Pairing failed. Use a fresh code on a live unpaired connection.';
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });
  return server;
}
