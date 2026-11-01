import type { FastifyInstance } from 'fastify';
import { LinkTokenController } from '../controllers/link-token.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { protectAuthOrigin } from '../config/auth.js';
export async function linkTokenRoutes(app: FastifyInstance, options: { controller: LinkTokenController }): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return protectAuthOrigin(request, reply);
  });
  app.post('/', { preHandler: [authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: request => request.raw.socket.remoteAddress || 'unknown' } } }, options.controller.generateLinkToken);
  // Public consumption is intentionally gone: identity can only bind to the active live MCP transport.
  app.post('/verify', async (_request, reply) => reply.status(410).send({ error: 'Public pairing verification is disabled. Use pair_session on your active MCP connection.' }));
}
