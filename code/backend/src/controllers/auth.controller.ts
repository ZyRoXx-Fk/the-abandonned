import { FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import {
  registerOwnerSchema,
  registerClientSchema,
  loginSchema,
  updateClientPreferencesSchema,
} from "../schemas/auth.schema.js";
import { authService, AuthService, AuthTokenPayload, AuthResult, UserRole } from "../services/auth.service.js";
import { ApiError, Unauthorized, Forbidden } from "../utils/errors/http.error.js";
import { SESSION_COOKIE, sessionCookieOptions } from "../config/auth.js";

export class AuthController {
  constructor(private readonly service: AuthService = authService) {}

  private handleZodError(error: ZodError, reply: FastifyReply) {
    return reply.status(400).send({
      error: "Validation error",
      code: "VALIDATION_ERROR",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  private handleError(error: unknown, reply: FastifyReply) {
    if (error instanceof ZodError) {
      return this.handleZodError(error, reply);
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.statusCode === 409 ? "EMAIL_EXISTS" : error.statusCode === 401 ? "INVALID_CREDENTIALS" : "REQUEST_FAILED",
      });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return reply.status(409).send({ error: "Email already registered", code: "EMAIL_EXISTS" });
    }
    reply.log.error({ err: error }, "Authentication request failed");
    return reply.status(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }

  private sendSession(result: AuthResult, reply: FastifyReply, status: number) {
    reply.setCookie(SESSION_COOKIE, result.token, sessionCookieOptions());
    return reply.status(status).send(result);
  }

  registerOwner = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = registerOwnerSchema.parse(request.body);
      const result = await this.service.registerOwner(validatedData);
      return this.sendSession(result, reply, 201);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  registerClient = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedData = registerClientSchema.parse(request.body);
      const result = await this.service.registerClient(validatedData);
      return this.sendSession(result, reply, 201);
    } catch (error) {
      return this.handleError(error, reply);
    }
  };

  private async loginForRole(request: FastifyRequest, reply: FastifyReply, role?: UserRole) {
    try {
      const validatedData = loginSchema.parse(request.body);
      const result = await this.service.login(validatedData, role);
      return this.sendSession(result, reply, 200);
    } catch (error) {
      return this.handleError(error, reply);
    }
  }

  login = (request: FastifyRequest, reply: FastifyReply) => this.loginForRole(request, reply);
  loginOwner = (request: FastifyRequest, reply: FastifyReply) => this.loginForRole(request, reply, "owner");
  loginClient = (request: FastifyRequest, reply: FastifyReply) => this.loginForRole(request, reply, "client");

  logout = async (_request: FastifyRequest, reply: FastifyReply) => {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions();
    reply.clearCookie(SESSION_COOKIE, options);
    return reply.status(204).send();
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
