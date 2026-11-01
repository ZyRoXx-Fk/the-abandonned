import type { FastifyRequest, FastifyReply } from 'fastify';
import { LinkTokenService } from '../services/link-token.service.js';
import { ApiError } from '../utils/errors/http.error.js';
import type { AuthTokenPayload } from '../services/auth.service.js';
export class LinkTokenController {
  constructor(private readonly service: LinkTokenService) {}
  generateLinkToken = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthTokenPayload }).user;
    if (!user || !['owner', 'client'].includes(user.role)) return reply.status(401).send({ error: 'Authentication required' });
    try {
      return reply.status(201).send(await this.service.generateForPrincipal({ role: user.role, userId: user.userId }));
    } catch (error) {
      return reply.status(error instanceof ApiError ? error.statusCode : 500).send({ error: 'Unable to generate pairing code' });
    }
  };
}
