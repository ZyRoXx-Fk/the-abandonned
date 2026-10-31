import { FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { linkTokenService, LinkTokenService } from "../services/link-token.service.js";
import { verifyLinkTokenSchema } from "../schemas/link-token.schema.js";
import { ApiError, Unauthorized, Forbidden } from "../utils/errors/http.error.js";
import { AuthTokenPayload } from "../services/auth.service.js";

export class LinkTokenController {
  constructor(private readonly service: LinkTokenService = linkTokenService) {}

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

  generateLinkToken = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user as AuthTokenPayload;
      if (!user) {
        throw new Unauthorized("Unauthorized");
      }

      if (user.role !== "owner") {
        throw new Forbidden("Only restaurant owners can generate ChatGPT pairing tokens");
      }

      const result = await this.service.generateLinkToken(user.userId);
      return reply.status(201).send(result);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  verifyLinkToken = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = verifyLinkTokenSchema.parse(request.body);
      const result = await this.service.validateAndConsume(validatedData.token);
      return reply.status(200).send({
        valid: true,
        ...result,
      });
    } catch (error) {
      return this.handleError(error, reply);
    }
  };
}

export const linkTokenController = new LinkTokenController();
