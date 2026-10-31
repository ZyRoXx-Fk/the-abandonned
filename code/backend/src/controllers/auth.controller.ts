import { FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import {
  registerOwnerSchema,
  registerClientSchema,
  loginSchema,
  updateClientPreferencesSchema,
} from "../schemas/auth.schema.js";
import { authService, AuthService, AuthTokenPayload } from "../services/auth.service.js";
import { ApiError, Unauthorized, Forbidden } from "../utils/errors/http.error.js";

export class AuthController {
  constructor(private readonly service: AuthService = authService) {}

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

  registerOwner = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = registerOwnerSchema.parse(request.body);
      const result = await this.service.registerOwner(validatedData);
      return reply.status(201).send(result);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  registerClient = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = registerClientSchema.parse(request.body);
      const result = await this.service.registerClient(validatedData);
      return reply.status(201).send(result);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  login = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = loginSchema.parse(request.body);
      const result = await this.service.login(validatedData);
      return reply.status(200).send(result);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  getMe = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user as AuthTokenPayload;
      if (!user) {
        throw new Unauthorized("Unauthorized");
      }

      const profile = await this.service.getProfile(user.userId, user.role);
      return reply.status(200).send(profile);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  updateClientPreferences = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user as AuthTokenPayload;
      if (!user) {
        throw new Unauthorized("Unauthorized");
      }

      if (user.role !== "client") {
        throw new Forbidden("Only client accounts have search preferences");
      }

      const validatedData = updateClientPreferencesSchema.parse(request.body);
      const result = await this.service.updateClientPreferences(user.userId, validatedData);
      return reply.status(200).send(result);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };
}

export const authController = new AuthController();
