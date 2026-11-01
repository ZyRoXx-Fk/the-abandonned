import type { FastifyInstance } from 'fastify';
import type { McpController } from '../controllers/mcp.controller.js';
import type { McpService } from '../services/mcp.service.js';
export async function mcpRoutes(app: FastifyInstance, options: { controller: McpController; service: McpService }): Promise<void> {
  for (const path of ['/mcp', '/sse', '/messages']) app.all(path, options.controller.handleRequest);
  app.get('/mcp/status', options.controller.getStatus);
  const timer = setInterval(() => { void options.service.cleanup(); }, 60000);
  timer.unref();
  app.addHook('preClose', async () => { clearInterval(timer); await options.service.close(); });
}
