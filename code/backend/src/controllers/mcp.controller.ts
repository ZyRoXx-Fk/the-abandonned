import { FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { mcpService, McpService } from "../services/mcp.service.js";
import { ApiError } from "../utils/errors/http.error.js";

export class McpController {
  constructor(private readonly service: McpService = mcpService) {}

  private handleZodError(error: ZodError, reply: FastifyReply) {
    return reply.status(400).send({
      error: "Validation error",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  private handleError(error: any, reply: FastifyReply) {
    if (error instanceof ZodError) {
      return this.handleZodError(error, reply);
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }
    const status = error.statusCode || 500;
    return reply.status(status).send({
      error: error.message || "Internal server error",
    });
  }

  handleRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.hijack();
      await this.service.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error(error, "Error processing MCP request");
    }
  };

  getStatus = async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = this.service.getStatus();
    return reply.status(200).send(status);
  };
}

export const mcpController = new McpController();

