import type { FastifyRequest, FastifyReply } from 'fastify';
import { McpService } from '../services/mcp.service.js';
export class McpController {
  constructor(private readonly service: McpService) {}
  handleRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.hijack();
    await this.service.handleRequest(request.raw, reply.raw, request.body);
  };
  getStatus = async (_request: FastifyRequest, reply: FastifyReply) => reply.send(this.service.getStatus());
}
