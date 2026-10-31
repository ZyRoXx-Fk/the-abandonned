import { FastifyRequest, FastifyReply } from "fastify";
import { AuthTokenPayload } from "../services/auth.service.js";
import { Unauthorized } from "../utils/errors/http.error.js";
import { TokenManager } from "../utils/managers/token.manager.js";
import { SESSION_COOKIE, isAllowedOrigin } from "../config/auth.js";

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  const cookieToken = request.cookies?.[SESSION_COOKIE];
  const token = authHeader ? bearerToken : cookieToken;

  if (!token) {
    const error = new Unauthorized("Missing or invalid Authorization header");
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  if (!authHeader && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !isAllowedOrigin(request)) {
    return reply.status(403).send({ error: "Origin not allowed", code: "ORIGIN_NOT_ALLOWED" });
  }

  try {
    const payload: AuthTokenPayload = await TokenManager.verifyToken<AuthTokenPayload>(token);
    (request as any).user = payload;
  } catch (err) {
    const error = new Unauthorized("Invalid or expired token");
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }
}
